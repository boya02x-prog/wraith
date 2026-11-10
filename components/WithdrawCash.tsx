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
import { Check, LoaderCircle } from "lucide-react";
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
      setPhase("done"); setQuote(null); setAmount(""); void cash.reload();
      window.dispatchEvent(new Event("wraith:trade-recorded"));
    } catch (e) {
      setPhase("error");
      setMsg(friendlyError(e, src.kind === "solana" ? "SOL" : chainOf(src.chain)?.native, src.chainName));
    }
  };

  const busy = phase === "approving" || phase === "sending" || phase === "bridging";
  const explorer = tx ? (txChain === "solana" ? `https://solscan.io/tx/${tx}` : `${chainOf(txChain)?.explorer}/tx/${tx}`) : "";

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
        <button type="button" className="wd-btn" onClick={() => { setPhase("idle"); setTx(""); setRecipient(""); setSent(null); onDone?.(); }}>Done</button>
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

  return (
    <div className="wd-form">
      <div className="wd-balance"><span>Cash balance</span><b>{loaded ? fmt(total) : "—"}</b></div>

      <label className="wd-label">Send to network</label>
      <div className="ewt-dd wd-dd" ref={ddRef}>
        <button type="button" className="ewt-dd-btn" aria-haspopup="listbox" aria-expanded={ddOpen} onClick={() => setDdOpen((o) => !o)} disabled={busy}>
          <ChainLogo chain={dest.key} size={22} />
          <span className="ewt-dd-name">{dest.name}</span>
          <span className="ewt-dd-tok"><CashLogo symbol={dest.symbol} size={14} />{dest.symbol}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {ddOpen && (
          <ul className="ewt-dd-list" role="listbox" aria-label="Destination network">
            {DEPOSIT_CHAINS.map((c) => (
              <li key={c.key}>
                <button type="button" role="option" aria-selected={c.key === destKey} className={c.key === destKey ? "on" : ""} onClick={() => { setDestKey(c.key); setRecipient(""); setMsg(""); setPhase("idle"); setDdOpen(false); }}>
                  <ChainLogo chain={c.key} size={20} />
                  <span className="ewt-dd-name">{c.name}</span>
                  <span className="ewt-dd-tok"><CashLogo symbol={c.symbol} size={14} />{c.symbol}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="wd-label">Amount</label>
      <div className="wd-amount">
        <span>$</span>
        <input type="text" inputMode="decimal" placeholder="0.00" value={amount} disabled={busy}
          onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setMsg(""); if (phase === "error") setPhase("idle"); }} />
        <button type="button" className="wd-max" disabled={busy} onClick={() => setAmount(String(maxUsd))}>MAX</button>
      </div>
      <div className="wd-pcts">
        {[25, 50, 75].map((p) => (
          <button key={p} type="button" disabled={busy} onClick={() => setAmount((Math.floor(maxUsd * p / 100 * 100) / 100).toFixed(2))}>{p}%</button>
        ))}
      </div>

      {sources.length > 1 && (
        <>
          <label className="wd-label">Pay from</label>
          <select value={pick} disabled={busy} onChange={(e) => { setPick(e.target.value); setMsg(""); }} className="wd-input wd-select">
            <option value="">Best route (automatic)</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.chainName} · {s.symbol} · {fmt(s.balance)}</option>)}
          </select>
        </>
      )}

      <label className="wd-label">Recipient address</label>
      <input type="text" className="wd-input" placeholder={`${dest.name} wallet address`} value={recipient} disabled={busy}
        onChange={(e) => { setRecipient(e.target.value); setMsg(""); if (phase === "error") setPhase("idle"); }} spellCheck={false} autoComplete="off" />

      {src && amtOk && rcpOk && (
        <div className="wd-summary">
          {direct
            ? <>Direct {src.symbol} transfer on {src.chainName}. No bridge, no swap.</>
            : phase === "quoting" ? "Finding the best route…"
            : quote && receive !== null ? <>They receive about <b>{receive.toLocaleString("en-US", { maximumFractionDigits: 2 })} {quote.action.toToken.symbol}</b><span>fee ≈ {fmt(feeUsd)}{eta ? ` · ~${eta} min` : ""} · from {src.chainName}</span></>
            : null}
        </div>
      )}

      {(msg || (blocked && amount && phase !== "quoting")) && <p className="wd-error">{msg || blocked}</p>}
      <button type="button" className="wd-btn" disabled={busy || !!blocked || (!direct && !quote)} onClick={() => void run()}>
        {phase === "approving" ? <><LoaderCircle size={15} className="animate-spin" /> Approving…</>
          : phase === "sending" ? <><LoaderCircle size={15} className="animate-spin" /> Confirm in wallet…</>
          : phase === "bridging" ? <><LoaderCircle size={15} className="animate-spin" /> Arriving on {dest.name}…</>
          : phase === "quoting" ? <><LoaderCircle size={15} className="animate-spin" /> Finding route…</>
          : amtOk ? `Send ${fmt(amt)}` : "Enter amount"}
      </button>
      <p className="wd-note">Transfers are irreversible. Check the address is on {dest.name}.</p>
    </div>
  );
}
