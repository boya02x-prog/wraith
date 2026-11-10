"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { Droplets, FlaskConical, LoaderCircle, Copy } from "lucide-react";
import { useToast } from "@/components/Toast";
import { ataOf, TOKEN_PROGRAM_ID, transferCheckedIx } from "@/lib/splLite";
import { DEVNET_RPC_PUBLIC } from "@/lib/publicRpc";

const DEVNET_RPC = DEVNET_RPC_PUBLIC;

interface TestToken { symbol: string; name: string; mint: string; priceSol: number; decimals: number; treasuryAta: string }
interface Sandbox { tokens: TestToken[]; treasury: string; error: string | null }

const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "0");
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export default function TestnetLab() {
  const { user, authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { push } = useToast();
  const conn = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);

  const account = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy");
  const address = account?.type === "wallet" ? account.address : null;
  const wallet = address ? wallets.find((w) => w.address === address) : undefined;
  const owner = useMemo(() => (address ? new PublicKey(address) : null), [address]);

  const [box, setBox] = useState<Sandbox | null>(null);
  const [sol, setSol] = useState<number | null>(null);
  const [bal, setBal] = useState<Record<string, bigint>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/devnet/tokens", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Sandbox) => { if (alive) setBox(d); })
      .catch(() => { if (alive) setBox({ tokens: [], treasury: "", error: "Devnet sandbox unavailable right now." }); });
    return () => { alive = false; };
  }, [reload]);

  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      const [lamports, accs] = await Promise.all([
        conn.getBalance(owner),
        conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      ]);
      setSol(lamports / 1e9);
      const next: Record<string, bigint> = {};
      for (const a of accs.value) {
        const info = a.account.data.parsed.info as { mint: string; tokenAmount: { amount: string } };
        next[info.mint] = (next[info.mint] ?? BigInt(0)) + BigInt(info.tokenAmount.amount);
      }
      setBal(next);
    } catch (e) {
      console.warn("[testnet balances]", e);
    }
  }, [conn, owner]);

  useEffect(() => {
    void refresh();
    const t = visibleInterval(() => void refresh(), 6000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const sendSigned = async (ixs: ConstructorParameters<typeof TransactionMessage>[0]["instructions"]) => {
    if (!owner || !wallet) throw new Error("Wallet not ready");
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const res = await signTransaction({ transaction: tx.serialize(), wallet, chain: "solana:devnet" });
    const sig = await conn.sendRawTransaction(res.signedTransaction, { skipPreflight: false });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  };

  const settle = async (side: "buy" | "sell", mint: string, signature: string) => {
    const r = await fetch("/api/devnet/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side, mint, signature }),
    });
    const d = (await r.json()) as { error?: string; tokens?: number; sol?: number; signature?: string };
    if (!r.ok) throw new Error(d.error || "Settlement failed.");
    return d;
  };

  const buy = async (t: TestToken) => {
    if (!owner || busyKey) return;
    const amt = Number(amounts[t.mint] ?? "0.1");
    if (!(amt > 0)) { push("Enter a SOL amount.", "warning"); return; }
    if (sol !== null && amt + 0.01 > sol) { push("Not enough devnet SOL. Use the faucet.", "warning"); return; }
    setBusyKey(`buy:${t.mint}`);
    try {
      if (!box?.treasury) throw new Error("Sandbox not ready.");
      const sig = await sendSigned([SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(box.treasury), lamports: Math.round(amt * 1e9) })]);
      const d = await settle("buy", t.mint, sig);
      push(`Bought ${fmt(d.tokens ?? 0, 2)} ${t.symbol}`, "success", { actionLabel: "VIEW TX", onAction: () => window.open(explorer(sig), "_blank", "noopener,noreferrer"), timeoutMs: 7000 });
      await refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : "Buy failed.", "warning");
    } finally { setBusyKey(null); }
  };

  const sell = async (t: TestToken) => {
    if (!owner || busyKey) return;
    const raw = bal[t.mint] ?? BigInt(0);
    if (raw <= BigInt(0)) { push(`No ${t.symbol} to sell.`, "warning"); return; }
    setBusyKey(`sell:${t.mint}`);
    try {
      const mint = new PublicKey(t.mint);
      const sig = await sendSigned([transferCheckedIx(ataOf(owner, mint), mint, new PublicKey(t.treasuryAta), owner, raw, t.decimals)]);
      const d = await settle("sell", t.mint, sig);
      push(`Sold ${t.symbol} for ${fmt(d.sol ?? 0, 4)} SOL`, "success", { actionLabel: "VIEW TX", onAction: () => window.open(explorer(sig), "_blank", "noopener,noreferrer"), timeoutMs: 7000 });
      await refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : "Sell failed.", "warning");
    } finally { setBusyKey(null); }
  };

  const faucet = async () => {
    setFaucetBusy(true);
    try {
      const r = await fetch("/api/devnet/airdrop", { method: "POST" });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) push(d.error || "Faucet failed.", "warning");
      else { push("Devnet SOL received.", "success"); await refresh(); }
    } catch {
      push("Faucet failed.", "warning");
    } finally { setFaucetBusy(false); }
  };

  const fundSandbox = async () => {
    if (!owner || !box?.treasury || busyKey) return;
    if (sol !== null && sol < 1.05) { push("You need at least ~1.05 devnet SOL to fund the sandbox.", "warning"); return; }
    setBusyKey("fund");
    try {
      await sendSigned([SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(box.treasury), lamports: 1e9 })]);
      push("Sandbox funded. Creating test tokens…", "success");
      await refresh();
      setBox(null);
      setReload((n) => n + 1);
    } catch (e) {
      push(e instanceof Error ? e.message : "Funding failed.", "warning");
    } finally { setBusyKey(null); }
  };

  // Withdraw check: send devnet SOL out of the Wraith wallet, then confirm the balance really dropped by amount + fee.
  const [wTo, setWTo] = useState("");
  const [wAmt, setWAmt] = useState("0.01");
  const [wRes, setWRes] = useState<string | null>(null);
  const [depSeen, setDepSeen] = useState<string | null>(null);
  const [lastSol, setLastSol] = useState<number | null>(null);
  useEffect(() => {
    // Deposit check: any increase in the devnet balance (faucet or an outside transfer) is reported as received.
    if (sol !== null && lastSol !== null && sol > lastSol + 1e-9) setDepSeen(`+${fmt(sol - lastSol, 6)} SOL arrived`);
    if (sol !== null) setLastSol(sol);
  }, [sol]); // eslint-disable-line react-hooks/exhaustive-deps

  const withdraw = async () => {
    if (!owner || busyKey) return;
    let to: PublicKey;
    try { to = new PublicKey(wTo.trim()); } catch { push("Not a valid Solana address.", "warning"); return; }
    const amt = Number(wAmt);
    if (!(amt > 0)) { push("Enter a SOL amount.", "warning"); return; }
    if (sol !== null && amt + 0.001 > sol) { push("Not enough devnet SOL for amount + fee.", "warning"); return; }
    setBusyKey("withdraw"); setWRes(null);
    try {
      const before = await conn.getBalance(owner, "confirmed");
      const sig = await sendSigned([SystemProgram.transfer({ fromPubkey: owner, toPubkey: to, lamports: Math.round(amt * 1e9) })]);
      const after = await conn.getBalance(owner, "confirmed");
      const spent = (before - after) / 1e9;
      const ok = Math.abs(spent - amt) < 0.001;
      setWRes(`${ok ? "PASS" : "CHECK"}: balance dropped ${fmt(spent, 6)} SOL (sent ${fmt(amt, 6)} + fee). ${explorer(sig)}`);
      push(ok ? "Withdraw works" : "Sent, but the balance change looks off", ok ? "success" : "warning", { actionLabel: "VIEW TX", onAction: () => window.open(explorer(sig), "_blank", "noopener,noreferrer"), timeoutMs: 7000 });
      await refresh();
    } catch (e) {
      setWRes(`FAIL: ${e instanceof Error ? e.message : "Withdraw failed."}`);
    } finally { setBusyKey(null); }
  };

  const copy = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); push("Address copied", "success"); } catch { /* ignore */ }
  };


  return (
    <section className="tn">
      <header className="tn-head">
        <div>
          <h2><FlaskConical size={18} /> Testnet lab</h2>
          <p>Real transactions on Solana devnet, signed by your Wraith wallet. Free play money, no market data.</p>
        </div>
        <span className="tn-pill">DEVNET</span>
      </header>

      {!authenticated ? (
        <div className="tn-card tn-center"><p>Sign in to get a devnet wallet balance.</p><button type="button" className="tn-btn" onClick={() => login()}>Sign in</button></div>
      ) : (
        <div className="tn-card tn-wallet">
          <div>
            <small>Devnet balance</small>
            <strong>{sol === null ? "…" : `${fmt(sol, 4)} SOL`}</strong>
          </div>
          <button type="button" className="tn-addr" onClick={() => void copy()} title="Copy address">
            {address ? `${address.slice(0, 6)}…${address.slice(-6)}` : "No wallet"} <Copy size={12} />
          </button>
          <button type="button" className="tn-btn" disabled={faucetBusy || !address} onClick={() => void faucet()}>
            {faucetBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Droplets size={14} />} Get devnet SOL
          </button>
        </div>
      )}

      {box?.error && (
        <div className="tn-note">
          <p>{box.error.replace(/Send some to \S+ from faucet\.solana\.com\./, "")}</p>
          {box.treasury && (
            <>
              <p>Fund the sandbox once: open <a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer">faucet.solana.com</a>, pick Devnet, paste this address and request 2 SOL.</p>
              <div className="tn-note-row">
                <code>{box.treasury}</code>
                <button type="button" className="tn-addr" onClick={() => { void navigator.clipboard.writeText(box.treasury).then(() => push("Sandbox address copied", "success")).catch(() => {}); }}>Copy <Copy size={12} /></button>
                <button type="button" className="tn-btn" disabled={!wallet || busyKey === "fund" || (sol !== null && sol < 1.05)} onClick={() => void fundSandbox()}>
                  {busyKey === "fund" ? <LoaderCircle size={14} className="animate-spin" /> : null} Fund with 1 SOL from my wallet
                </button>
                <button type="button" className="tn-addr" onClick={() => { setBox(null); setReload((n) => n + 1); }}>Retry</button>
              </div>
            </>
          )}
        </div>
      )}

      {authenticated && (
        <div className="tn-card">
          <div><strong>Deposit and withdraw check</strong></div>
          <p style={{ margin: "6px 0", fontSize: 12, opacity: 0.8 }}>
            Deposit: tap “Get devnet SOL” above, or send devnet SOL to your address. It is reported here when it lands.
            Withdraw: send devnet SOL to any address and the lab checks your balance dropped by exactly amount + fee.
          </p>
          {depSeen && <p style={{ margin: "4px 0", fontSize: 12, color: "var(--green, #3ddc84)" }}>Deposit works: {depSeen}</p>}
          <div className="tn-actions">
            <input aria-label="Recipient address" placeholder="Recipient devnet address" value={wTo} onChange={(e) => setWTo(e.target.value)} style={{ flex: 1, minWidth: 0 }} spellCheck={false} />
            <input aria-label="SOL to send" inputMode="decimal" value={wAmt} onChange={(e) => setWAmt(e.target.value)} style={{ width: 70 }} />
            <span>SOL</span>
            <button type="button" className="tn-btn" disabled={!wallet || !!busyKey || !wTo.trim()} onClick={() => void withdraw()}>
              {busyKey === "withdraw" ? <LoaderCircle size={14} className="animate-spin" /> : "Withdraw"}
            </button>
          </div>
          {wRes && <p style={{ margin: "8px 0 0", fontSize: 12, wordBreak: "break-all" }}>{wRes}</p>}
        </div>
      )}

      <div className="tn-grid">
        {box === null && <div className="tn-card tn-center"><LoaderCircle size={16} className="animate-spin" /> Setting up test tokens…</div>}
        {box?.tokens.map((t) => {
          const raw = bal[t.mint] ?? BigInt(0);
          const held = Number(raw) / 10 ** t.decimals;
          const amt = amounts[t.mint] ?? "0.1";
          return (
            <div key={t.mint} className="tn-card tn-token">
              <div className="tn-token-top">
                <span className="tn-sym">{t.symbol.slice(1, 2)}</span>
                <div><strong>{t.symbol}</strong><small>{t.name}</small></div>
                <div className="tn-price"><small>Price</small><b>{fmt(t.priceSol, 7)} SOL</b></div>
              </div>
              <div className="tn-held">You hold <b>{fmt(held, 2)}</b> {t.symbol}{held > 0 && <> · worth {fmt(held * t.priceSol, 4)} SOL</>}</div>
              <div className="tn-actions">
                <input aria-label={`SOL to spend on ${t.symbol}`} inputMode="decimal" value={amt} onChange={(e) => setAmounts((p) => ({ ...p, [t.mint]: e.target.value }))} />
                <span>SOL</span>
                <button type="button" className="tn-buy" disabled={!authenticated || !wallet || !!busyKey} onClick={() => void buy(t)}>
                  {busyKey === `buy:${t.mint}` ? <LoaderCircle size={14} className="animate-spin" /> : "Buy"}
                </button>
                <button type="button" className="tn-sell" disabled={!authenticated || !wallet || !!busyKey || raw <= BigInt(0)} onClick={() => void sell(t)}>
                  {busyKey === `sell:${t.mint}` ? <LoaderCircle size={14} className="animate-spin" /> : "Sell"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
