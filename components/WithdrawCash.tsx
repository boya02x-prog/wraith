"use client";
// Withdraw CASH (stablecoins) to any supported network. Your balance is one pool of dollars across chains:
//   same chain + same token  -> plain transfer (no bridge)
//   anything else            -> one LI.FI route (swap / bridge) straight to the recipient
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSignAndSendTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, formatUnits, http, isAddress, parseAbi, parseUnits } from "viem";
import { ArrowLeft, Check, ChevronDown, ClipboardPaste, Delete, LoaderCircle } from "lucide-react";
import ChainLogo from "@/components/ChainLogo";
import CashLogo from "@/components/CashLogo";
import { ARC_USDC_ERC20, CASH_TOKENS, DEPOSIT_CHAINS, VIEM_CHAINS, lifiSource, rpcFor } from "@/lib/cashTokens";
import { execEvmRoute, friendlyError, lifiQuote, NATIVE_ADDR, SOLANA_LIFI_ID, waitForRoute, withGasFallback, type LifiQuote } from "@/lib/lifi";
import { useEnsureGas, useSponsoredSend } from "@/lib/useSponsoredSend";
import { useCashSources } from "@/lib/useCashSources";
import { chainOf } from "@/lib/chains";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MIN_SOL_FEE = 5_000_000; // 0.005 SOL covers fee + a new token account for the recipient
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);

const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

type Phase = "idle" | "quoting" | "approving" | "sending" | "bridging" | "done" | "error";
type Step = "amount" | "to" | "review";
// the last few addresses a withdrawal went to, per network, kept on this device only (a shortcut, nothing is sent anywhere)
const RECENT_KEY = "wraith_wd_recent_v1";
const readRecent = (chain: string): string[] => { try { const v = (JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") as Record<string, string[]>)[chain]; return Array.isArray(v) ? v.slice(0, 3) : []; } catch { return []; } };
const pushRecent = (chain: string, addr: string) => { try { const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") as Record<string, string[]>; all[chain] = [addr, ...(all[chain] ?? []).filter((a) => a !== addr)].slice(0, 3); localStorage.setItem(RECENT_KEY, JSON.stringify(all)); } catch { /* storage blocked */ } };
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;
const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WithdrawCash({ onDone }: { onDone?: () => void }) {
  const { wallets } = useWallets();
  const { wallets: solWallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { connection } = useConnection();
  const sponsoredSend = useSponsoredSend();
  const ensureGas = useEnsureGas();
  const { user } = usePrivy();
  void user;
  const cash = useCashSources();
  const { sources, loaded, evmAddress, solAddress, total } = cash;

  const [destKey, setDestKey] = useState("solana");
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState(""); // "" = auto
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [quote, setQuote] = useState<LifiQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [tx, setTx] = useState("");
  const [txChain, setTxChain] = useState("solana");
  const [sent, setSent] = useState<{ usd: number; name: string; symbol: string; to: string } | null>(null);
  const [step, setStep] = useState<Step>("amount");
  const [recent, setRecent] = useState<string[]>([]);
  const qSeq = useRef(0);

  useEffect(() => {
    if (!ddOpen) return;
    const close = (e: MouseEvent) => { if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [ddOpen]);

  const dest = DEPOSIT_CHAINS.find((c) => c.key === destKey) ?? DEPOSIT_CHAINS[0];
  const destToken = CASH_TOKENS.find((c) => c.chain === destKey && c.symbol === dest.symbol) ?? CASH_TOKENS.find((c) => c.chain === destKey)!;
  const destIsSol = destKey === "solana";
  const rcp = recipient.trim();
  const rcpOk = useMemo(() => {
    if (!rcp) return false;
    if (destIsSol) { try { new PublicKey(rcp); return rcp.length >= 32; } catch { return false; } }
    return isAddress(rcp);
  }, [rcp, destIsSol]);

  const amt = Number(amount);
  const amtOk = Number.isFinite(amt) && amt > 0;
  const largest = sources.reduce<typeof sources[number] | null>((b, s) => (!b || s.balance > b.balance ? s : b), null);

  // which balance pays: user pick, else prefer same chain/token (plain transfer), else same chain, else any that covers it
  const src = useMemo(() => {
    if (pick) return sources.find((s) => s.id === pick) ?? null;
    if (!amtOk) return largest;
    const ok = sources.filter((s) => s.balance + 1e-9 >= amt);
    return ok.find((s) => s.chain === destKey && s.symbol === dest.symbol) ?? ok.find((s) => s.chain === destKey) ?? ok[0] ?? null;
  }, [pick, sources, amt, amtOk, largest, destKey, dest.symbol]);

  const direct = !!src && src.chain === destKey && src.symbol === dest.symbol;
  const reserve = src?.native ? 0.05 : 0;
  const maxUsd = Math.floor(Math.max(0, (src?.balance ?? 0) - reserve) * 1e6) / 1e6;

  const req = useMemo(() => {
    if (!src || !amtOk || !rcpOk || direct || amt > src.balance + 1e-9) return null;
    const sol = src.kind === "solana";
    const from = sol ? solAddress : evmAddress;
    if (!from) return null;
    const ls = lifiSource(src);
    return {
      fromKey: src.chain, sol, native: ls.native, fromToken: ls.token,
      fromId: sol ? SOLANA_LIFI_ID : VIEM_CHAINS[src.chain].id,
      toId: destIsSol ? SOLANA_LIFI_ID : VIEM_CHAINS[destKey].id,
      toToken: destToken.native ? ARC_USDC_ERC20 : destToken.address,
      fromRaw: parseUnits(amt.toFixed(Math.min(ls.decimals, 6)), ls.decimals), from,
    };
  }, [src, amtOk, amt, rcpOk, direct, solAddress, evmAddress, destIsSol, destKey, destToken]);

  useEffect(() => {
    setQuote(null);
    if (!req) { setPhase((p) => (p === "quoting" ? "idle" : p)); return; }
    const seq = ++qSeq.current;
    const t = setTimeout(async () => {
      setPhase("quoting"); setMsg("");
      try {
        const q = await lifiQuote({ fromChain: req.fromId, toChain: req.toId, fromToken: req.fromToken, toToken: req.toToken, fromAmount: req.fromRaw.toString(), fromAddress: req.from, toAddress: rcp });
        if (seq !== qSeq.current) return;
        setQuote(q); setPhase("idle");
      } catch (e) { if (seq === qSeq.current) { setPhase("error"); setMsg(e instanceof Error ? e.message : "Quote failed. Try again."); } }
    }, 500);
    return () => clearTimeout(t);
  }, [req, rcp]);

  const feeUsd = quote ? [...(quote.estimate.gasCosts ?? []), ...(quote.estimate.feeCosts ?? [])].reduce((s, c) => s + Number(c.amountUSD ?? 0), 0) : 0;
  const receive = quote ? Number(formatUnits(BigInt(quote.estimate.toAmountMin), quote.action.toToken.decimals)) : null;
  const eta = quote?.estimate.executionDuration ? Math.max(1, Math.round(quote.estimate.executionDuration / 60)) : null;

  // gas check BEFORE asking the wallet to sign, so the error says exactly what is missing
  const gasProblem = async (): Promise<string> => {
    if (!src) return "";
    if (src.kind === "solana") {
      const lamports = solAddress ? await connection.getBalance(new PublicKey(solAddress), "confirmed").catch(() => null) : null;
      if (lamports !== null && lamports < MIN_SOL_FEE) return `Network fees on Solana are paid in SOL. You have ${(lamports / 1e9).toFixed(4)} SOL, keep about 0.005 SOL in this wallet (or pay from another network below).`;
      return "";
    }
    return ""; // EVM: Wraith sponsors gas first, then falls back to the wallet's own gas
  };

  const run = async () => {
    if (!src || !amtOk || !rcpOk) return;
    try {
      setMsg(""); setTx("");
      if (amt > src.balance + 1e-9) throw new Error(`Only ${fmt(src.balance)} ${src.symbol} on ${src.chainName}.`);
      setPhase("sending");
      const gp = await gasProblem();
      if (gp) { setPhase("error"); setMsg(gp); return; }
      let hash = "";
      const raw = parseUnits(amt.toFixed(Math.min(src.decimals, 6)), src.decimals);

      if (direct && src.kind === "solana") {
        const sw = solWallets.find((w) => w.address === solAddress);
        if (!sw || !solAddress) throw new Error("Solana wallet not ready yet. Try again in a moment.");
        const owner = new PublicKey(solAddress), to = new PublicKey(rcp), mint = new PublicKey(src.address);
        const from = ata(owner, mint), toAta = ata(to, mint);
        const data = Buffer.alloc(10); data[0] = 12; data.writeBigUInt64LE(raw, 1); data[9] = src.decimals;
        const ixs = [
          new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]), keys: [
            { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: toAta, isSigner: false, isWritable: true },
            { pubkey: to, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          ] }),
          new TransactionInstruction({ programId: TOKEN_PROGRAM, data, keys: [
            { pubkey: from, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: toAta, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false },
          ] }),
        ];
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const t = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(...ixs);
        const r = await signAndSendTransaction({ transaction: t.serialize({ requireAllSignatures: false, verifySignatures: false }), wallet: sw, chain: "solana:mainnet" });
        hash = bs58.encode(r.signature);
        const c = await connection.confirmTransaction({ signature: hash, blockhash, lastValidBlockHeight }, "confirmed");
        if (c.value.err) throw new Error("Transaction failed on-chain.");
      } else if (direct) {
        const chain = VIEM_CHAINS[src.chain];
        const wallet = wallets.find((w) => w.address.toLowerCase() === evmAddress?.toLowerCase()) ?? wallets.find((w) => w.walletClientType === "privy");
        if (!wallet || !evmAddress) throw new Error("Wallet not ready yet. Try again in a moment.");
        const pc = createPublicClient({ chain, transport: http(rpcFor(chain) ?? undefined) });
        const selfPaid = async () => {
          await ensureGas(src.chain, evmAddress);
          await wallet.switchChain(chain.id);
          const provider = await wallet.getEthereumProvider();
          const wc = createWalletClient({ account: evmAddress as `0x${string}`, chain, transport: custom(provider as Parameters<typeof custom>[0]) });
          return src.native
            ? await wc.sendTransaction({ to: rcp as `0x${string}`, value: raw })
            : await wc.writeContract({ address: src.address as `0x${string}`, abi: ERC20, functionName: "transfer", args: [rcp as `0x${string}`, raw] });
        };
        const sponsored = () => sponsoredSend(src.native
          ? { to: rcp as `0x${string}`, value: raw, chainId: chain.id }
          : { to: src.address as `0x${string}`, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [rcp as `0x${string}`, raw] }), chainId: chain.id });
        hash = await withGasFallback(sponsored, selfPaid);
        await pc.waitForTransactionReceipt({ hash: hash as `0x${string}` });
      } else {
        if (!quote || !req) throw new Error("No route yet. Wait for the quote and try again.");
        if (req.sol) {
          const sw = solWallets.find((w) => w.address === req.from);
          if (!sw) throw new Error("Solana wallet not ready yet. Try again in a moment.");
          const vt = VersionedTransaction.deserialize(Buffer.from(quote.transactionRequest.data, "base64"));
          const r = await signAndSendTransaction({ transaction: vt.serialize(), wallet: sw, chain: "solana:mainnet" });
          hash = bs58.encode(r.signature);
        } else {
          const wallet = wallets.find((w) => w.address.toLowerCase() === evmAddress?.toLowerCase()) ?? wallets.find((w) => w.walletClientType === "privy");
          if (!wallet || !evmAddress) throw new Error("Wallet not ready yet. Try again in a moment.");
          const o = { wallet, account: evmAddress as `0x${string}`, chain: VIEM_CHAINS[req.fromKey], quote, fromToken: req.fromToken, native: req.native, fromRaw: req.fromRaw, onPhase: (p: "approving" | "sending") => setPhase(p) };
          hash = await withGasFallback(() => execEvmRoute({ ...o, send: sponsoredSend }), async () => { await ensureGas(req.fromKey, evmAddress); return execEvmRoute(o); });
        }
        setTx(hash); setTxChain(req.fromKey);
        if (req.fromId !== req.toId) { setPhase("bridging"); await waitForRoute(hash, req.fromId, req.toId); }
      }
      setTx(hash); setTxChain(src.chain);
      setSent({ usd: amt, name: dest.name, symbol: dest.symbol, to: rcp });
      pushRecent(destKey, rcp);
      setPhase("done"); setQuote(null); setAmount(""); void cash.reload();
      window.dispatchEvent(new Event("wraith:trade-recorded"));
    } catch (e) {
      setPhase("error");
      setMsg(friendlyError(e, src.kind === "solana" ? "SOL" : chainOf(src.chain)?.native, src.chainName));
    }
  };

  const busy = phase === "approving" || phase === "sending" || phase === "bridging";
  const explorer = tx ? (txChain === "solana" ? `https://solscan.io/tx/${tx}` : `${chainOf(txChain)?.explorer}/tx/${tx}`) : "";

  const press = (k: (typeof KEYS)[number]) => {
    setMsg(""); if (phase === "error") setPhase("idle");
    setAmount((cur) => {
      if (k === "back") return cur.slice(0, -1);
      if (k === ".") return cur.includes(".") ? cur : (cur || "0") + ".";
      const next = (cur === "0" ? "" : cur) + k;
      const [whole, dec = ""] = next.split(".");
      return dec.length > 2 || whole.length > 9 ? cur : next;
    });
  };
  // the typed keys of a computer keyboard drive the amount too (only while the amount step is showing and no text box has focus)
  useEffect(() => {
    if (step !== "amount") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); press(e.key as (typeof KEYS)[number]); }
      else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, phase]);

  if (phase === "done" && sent) {
    const short = `${sent.to.slice(0, 6)}…${sent.to.slice(-6)}`;
    return (
      <div className="wd-done">
        <div className="wd-check"><Check size={30} strokeWidth={3} /></div>
        <div className="wd-done-amt">{fmt(sent.usd)}</div>
        <div className="wd-done-sub">{sent.symbol} sent on {sent.name}</div>
        <div className="wd-card">
          <div><span>To</span><b>{short}</b></div>
          <div><span>Network</span><b><ChainLogo chain={destKey} size={16} /> {sent.name}</b></div>
          <div><span>Status</span><b className="wd-ok">{destKey === txChain ? "Confirmed" : "Arriving in a few minutes"}</b></div>
        </div>
        {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" className="wd-link">View transaction ↗</a>}
        <button type="button" className="wd-btn" onClick={() => { setPhase("idle"); setTx(""); setRecipient(""); setSent(null); setStep("amount"); onDone?.(); }}>Done</button>
      </div>
    );
  }

  let blocked = "";
  if (!loaded) blocked = "Loading your cash…";
  else if (sources.length === 0) blocked = "No cash to withdraw yet. Deposit USDC first.";
  else if (!amtOk) blocked = "Enter an amount";
  else if (!src) blocked = largest ? `Largest single balance is ${fmt(largest.balance)} on ${largest.chainName}. Withdraw up to that.` : "No cash available.";
  else if (amt > src.balance + 1e-9) blocked = `Only ${fmt(src.balance)} ${src.symbol} on ${src.chainName}.`;
  else if (!rcpOk) blocked = rcp ? `Not a valid ${dest.name} address` : `Paste a ${dest.name} address`;

  const amountReady = loaded && sources.length > 0 && amtOk && !!src && amt <= src.balance + 1e-9;
  const paste = async () => { try { const t = (await navigator.clipboard.readText()).trim(); if (t) { setRecipient(t); setMsg(""); if (phase === "error") setPhase("idle"); } } catch { setMsg("Paste is blocked here. Long-press the box and paste."); } };
  const goTo = () => { setRecent(readRecent(destKey)); setStep("to"); };
  const shortAddr = rcp.length > 14 ? `${rcp.slice(0, 6)}…${rcp.slice(-6)}` : rcp;

  return (
    <div className="wd2">
      {step !== "amount" && (
        <button type="button" className="wd2-back" disabled={busy} onClick={() => setStep(step === "review" ? "to" : "amount")}><ArrowLeft size={18} /> Back</button>
      )}

      {step === "amount" && (
        <>
          <div className="wd2-top"><span>Withdraw cash</span><b>Available {loaded ? fmt(total) : "—"}</b></div>
          <div className="wd2-amt" aria-live="polite"><span className="sign">$</span><b className={amount ? "" : "ph"}>{amount || "0"}</b></div>
          {amtOk && src && amt > src.balance + 1e-9
            ? <p className="wd2-sub bad">{blocked}</p>
            : <p className="wd2-sub">{src ? <>From <b>{src.chainName}</b> · {src.symbol}, up to {fmt(maxUsd)}</> : "Enter how much to send"}</p>}
          <div className="wd2-chips">
            {[25, 50, 75].map((p) => <button key={p} type="button" disabled={busy} onClick={() => setAmount((Math.floor(maxUsd * p / 100 * 100) / 100).toFixed(2))}>{p}%</button>)}
            <button type="button" disabled={busy} onClick={() => setAmount(String(maxUsd))}>Max</button>
          </div>

          <div className="wd2-netwrap" ref={ddRef}>
            <button type="button" className="wd2-net" aria-haspopup="listbox" aria-expanded={ddOpen} onClick={() => setDdOpen((o) => !o)} disabled={busy}>
              <ChainLogo chain={dest.key} size={26} />
              <span className="t"><small>Send to network</small><b>{dest.name}</b></span>
              <span className="tok"><CashLogo symbol={dest.symbol} size={15} />{dest.symbol}</span>
              <ChevronDown size={18} aria-hidden="true" />
            </button>
            {ddOpen && (
              <ul className="wd2-netlist" role="listbox" aria-label="Destination network">
                {DEPOSIT_CHAINS.map((c) => (
                  <li key={c.key}>
                    <button type="button" role="option" aria-selected={c.key === destKey} className={c.key === destKey ? "on" : ""} onClick={() => { setDestKey(c.key); setRecipient(""); setMsg(""); setPhase("idle"); setDdOpen(false); }}>
                      <ChainLogo chain={c.key} size={22} />
                      <span className="n">{c.name}</span>
                      <span className="tok"><CashLogo symbol={c.symbol} size={14} />{c.symbol}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="wd2-keys" role="group" aria-label="Amount">
            {KEYS.map((k) => (
              <button key={k} type="button" disabled={busy} aria-label={k === "back" ? "Delete" : k} onClick={() => press(k)}>{k === "back" ? <Delete size={22} /> : k}</button>
            ))}
          </div>
          {msg && <p className="wd-error">{msg}</p>}
          <button type="button" className="wd2-cta" disabled={!amountReady} onClick={goTo}>{loaded && sources.length === 0 ? "No cash to withdraw yet" : amountReady ? `Next · ${fmt(amt)}` : "Enter an amount"}</button>
        </>
      )}

      {step === "to" && (
        <>
          <h3 className="wd2-h">Where to?</h3>
          <p className="wd2-lead">Sending <b>{fmt(amt)}</b> on <b>{dest.name}</b>.</p>
          <div className={`wd2-addr${rcp ? (rcpOk ? " ok" : " bad") : ""}`}>
            <input type="text" placeholder={`${dest.name} wallet address`} value={recipient} onChange={(e) => { setRecipient(e.target.value); setMsg(""); if (phase === "error") setPhase("idle"); }} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" aria-label={`${dest.name} wallet address`} />
            <button type="button" onClick={() => void paste()}><ClipboardPaste size={16} /> Paste</button>
          </div>
          {rcp && <p className={`wd2-valid ${rcpOk ? "ok" : "bad"}`}>{rcpOk ? <><Check size={14} strokeWidth={3} /> Looks like a valid {dest.name} address</> : `Not a valid ${dest.name} address`}</p>}
          {recent.length > 0 && (
            <div className="wd2-recent">
              <small>Recent</small>
              {recent.map((a) => <button key={a} type="button" onClick={() => setRecipient(a)}><span>{a.slice(0, 8)}…{a.slice(-8)}</span></button>)}
            </div>
          )}
          <div className="wd2-warn">Only send to a <b>{dest.name}</b> address. A transfer cannot be undone, and money sent to the wrong network is usually lost.</div>
          {msg && <p className="wd-error">{msg}</p>}
          <button type="button" className="wd2-cta" disabled={!rcpOk} onClick={() => setStep("review")}>Review</button>
        </>
      )}

      {step === "review" && (
        <>
          <h3 className="wd2-h">Review</h3>
          <div className="wd2-big"><span>You send</span><b>{fmt(amt)}</b></div>
          <div className="wd2-rows">
            <div><span>To</span><b className="mono">{shortAddr}</b></div>
            <div><span>Network</span><b><ChainLogo chain={destKey} size={16} /> {dest.name}</b></div>
            <div><span>From</span><b>{src ? `${src.chainName} · ${src.symbol}` : "—"}</b></div>
            <div><span>They receive</span><b>{direct ? `${fmt(amt)} ${src?.symbol ?? ""}` : phase === "quoting" ? "Finding the best route…" : quote && receive !== null ? `about ${receive.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${quote.action.toToken.symbol}` : "—"}</b></div>
            <div><span>Network fee</span><b>{direct ? "Tiny (paid by the network)" : quote ? `about ${fmt(feeUsd)}${eta ? ` · ~${eta} min` : ""}` : "—"}</b></div>
          </div>
          {sources.length > 1 && (
            <label className="wd2-from">
              <small>Pay from</small>
              <select value={pick} disabled={busy} onChange={(e) => { setPick(e.target.value); setMsg(""); }} className="wd-input wd-select">
                <option value="">Best route (automatic)</option>
                {sources.map((x) => <option key={x.id} value={x.id}>{x.chainName} · {x.symbol} · {fmt(x.balance)}</option>)}
              </select>
            </label>
          )}
          {(msg || (blocked && phase !== "quoting" && blocked !== "Enter an amount")) && <p className="wd-error">{msg || blocked}</p>}
          <button type="button" className="wd2-cta go" disabled={busy || !!blocked || (!direct && !quote)} onClick={() => void run()}>
            {phase === "approving" ? <><LoaderCircle size={16} className="animate-spin" /> Approving…</>
              : phase === "sending" ? <><LoaderCircle size={16} className="animate-spin" /> Confirm in wallet…</>
              : phase === "bridging" ? <><LoaderCircle size={16} className="animate-spin" /> Arriving on {dest.name}…</>
              : phase === "quoting" ? <><LoaderCircle size={16} className="animate-spin" /> Finding route…</>
              : `Confirm and send ${fmt(amt)}`}
          </button>
          <p className="wd2-fine">Transfers are irreversible. Check the address is on {dest.name}.</p>
        </>
      )}
    </div>
  );
}
