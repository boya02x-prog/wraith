"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { Connection, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { useToast } from "@/components/Toast";
import { ataOf, TOKEN_PROGRAM_ID, transferCheckedIx } from "@/lib/splLite";
import type { SandboxTok } from "@/lib/useSandboxTokens";
import { useWraithTier } from "@/hooks/useWraithTier";
import ExitBox from "@/components/ExitBox";
import { DEVNET_RPC_PUBLIC } from "@/lib/publicRpc";
import { armLiveExit, disarmLiveExit, EXIT_PREFS_KEY, LIVE_EXITS_EVENT, readRules, writeRules, type LiveExitRule } from "@/lib/liveExits";

const DEVNET_RPC = DEVNET_RPC_PUBLIC;
const SELL_PRESETS = [25, 50, 100];
const BUY_PRESETS = [0.1, 0.5, 1];
const fmt = (n: number, d = 4) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "0");

export default function TestTradeDock({ token }: { token: SandboxTok }) {
  const { user, authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { push } = useToast();
  const conn = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const account = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy");
  const address = account?.type === "wallet" ? account.address : null;
  const wallet = address ? wallets.find((w) => w.address === address) : undefined;
  const owner = useMemo(() => (address ? new PublicKey(address) : null), [address]);

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [pct, setPct] = useState(100);
  const [sol, setSol] = useState<number | null>(null);
  const [raw, setRaw] = useState<bigint>(BigInt(0));
  const [busy, setBusy] = useState(false);
  const { canUse } = useWraithTier();
  const [exitOn, setExitOn] = useState(false);
  const [exitPrefs, setExitPrefs] = useState({ tp: "100", sl: "30", trail: "0" });
  const [armed, setArmed] = useState<LiveExitRule | null>(null);
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(EXIT_PREFS_KEY) || "null"); if (p && typeof p === "object") { setExitPrefs((c) => ({ ...c, ...p.prefs })); setExitOn(!!p.on); } } catch { /* none */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(EXIT_PREFS_KEY, JSON.stringify({ on: exitOn, prefs: exitPrefs })); } catch { /* full */ } }, [exitOn, exitPrefs]);
  useEffect(() => {
    const sync = () => setArmed(readRules().find((r) => r.mint === token.mint && r.sandbox) ?? null);
    sync();
    window.addEventListener(LIVE_EXITS_EVENT, sync);
    return () => window.removeEventListener(LIVE_EXITS_EVENT, sync);
  }, [token.mint]);

  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      const mintKey = new PublicKey(token.mint);
      const [lamports, accs] = await Promise.all([
        conn.getBalance(owner),
        conn.getParsedTokenAccountsByOwner(owner, { mint: mintKey, programId: TOKEN_PROGRAM_ID }).catch(() => null),
      ]);
      setSol(lamports / 1e9);
      const total = (accs?.value ?? []).reduce((sum, a) => sum + BigInt((a.account.data.parsed.info as { tokenAmount: { amount: string } }).tokenAmount.amount), BigInt(0));
      setRaw(total);
    } catch (e) {
      console.warn("[test dock balances]", e);
    }
  }, [conn, owner, token.mint]);

  useEffect(() => {
    void refresh();
    const t = visibleInterval(() => void refresh(), 6000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const sandboxPrice = useCallback(async (): Promise<number> => {
    try {
      const r = await fetch(`/api/token-price?mint=${encodeURIComponent(token.mint)}`, { cache: "no-store" });
      const d = (await r.json()) as { priceUsd?: number };
      return typeof d.priceUsd === "number" ? d.priceUsd : 0;
    } catch { return 0; }
  }, [token.mint]);

  // Test-mode auto-exit: same TP / SL / trail logic as live, executed here against the devnet sandbox.
  const sellingRef = useRef(false);
  useEffect(() => {
    if (!owner || !wallet || !canUse("auto_sell")) return;
    const id = window.setInterval(async () => {
      const rule = readRules().find((r) => r.mint === token.mint && r.sandbox);
      if (!rule || sellingRef.current || document.hidden) return;
      const px = await sandboxPrice();
      if (!(px > 0)) return;
      const peak = Math.max(rule.peakMcap, px);
      const pnl = (px / rule.entryMcap - 1) * 100;
      const kind = rule.tpPct > 0 && pnl >= rule.tpPct ? "Take-profit" : rule.slPct > 0 && pnl <= -rule.slPct ? "Stop-loss" : rule.trailPct > 0 && peak > rule.entryMcap && px <= peak * (1 - rule.trailPct / 100) ? "Trailing stop" : null;
      if (!kind) { if (peak !== rule.peakMcap) writeRules(readRules().map((r) => (r.id === rule.id ? { ...r, peakMcap: peak } : r))); return; }
      sellingRef.current = true;
      try {
        const mintKey = new PublicKey(token.mint);
        const accs = await conn.getParsedTokenAccountsByOwner(owner, { mint: mintKey, programId: TOKEN_PROGRAM_ID });
        const total = accs.value.reduce((s, a) => s + BigInt((a.account.data.parsed.info as { tokenAmount: { amount: string } }).tokenAmount.amount), BigInt(0));
        if (total > BigInt(0)) {
          const sig = await sendSigned([transferCheckedIx(ataOf(owner, mintKey), mintKey, new PublicKey(token.treasuryAta), owner, total, token.decimals)]);
          const d = await settle("sell", sig);
          push(`${kind} hit · sold ${token.symbol} for ${fmt(d.sol ?? 0, 4)} SOL (${pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}%)`, kind === "Stop-loss" ? "warning" : "success", { timeoutMs: 9000 });
        }
        disarmLiveExit(token.mint);
        await refresh();
      } catch (e) {
        push(`Auto-exit failed: ${e instanceof Error ? e.message : "error"}`, "error");
        disarmLiveExit(token.mint);
      } finally { sellingRef.current = false; }
    }, 3000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, wallet, token.mint, canUse]);

  const sendSigned = async (ixs: TransactionMessage["instructions"]) => {
    if (!owner || !wallet) throw new Error("Wallet not ready");
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const res = await signTransaction({ transaction: new VersionedTransaction(msg).serialize(), wallet, chain: "solana:devnet" });
    const sig = await conn.sendRawTransaction(res.signedTransaction);
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return sig;
  };

  const settle = async (side: "buy" | "sell", signature: string) => {
    const r = await fetch("/api/devnet/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side, mint: token.mint, signature }),
    });
    const d = (await r.json()) as { error?: string; tokens?: number; sol?: number };
    if (!r.ok) throw new Error(d.error || "Settlement failed.");
    // Unlocks posting intel on this token.
    void fetch("/api/token-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint: token.mint, side, signature }),
    }).then(() => window.dispatchEvent(new Event("wraith:trade-recorded"))).catch(() => {});
    return d;
  };

  const trade = async () => {
    if (!owner || busy) return;
    setBusy(true);
    try {
      if (mode === "buy") {
        const amt = Number(amount);
        if (!(amt > 0)) throw new Error("Enter a SOL amount.");
        if (sol !== null && amt + 0.01 > sol) throw new Error("Not enough devnet SOL. Get more in the Testnet tab.");
        const sig = await sendSigned([SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(token.treasury), lamports: Math.round(amt * 1e9) })]);
        const d = await settle("buy", sig);
        push(`Bought ${fmt(d.tokens ?? 0, 2)} ${token.symbol}`, "success", { actionLabel: "VIEW TX", onAction: () => window.open(`https://explorer.solana.com/tx/${sig}?cluster=devnet`, "_blank", "noopener,noreferrer"), timeoutMs: 7000 });
      } else {
        const amountRaw = pct >= 100 ? raw : (raw * BigInt(pct)) / BigInt(100);
        if (amountRaw <= BigInt(0)) throw new Error(`No ${token.symbol} to sell.`);
        const mint = new PublicKey(token.mint);
        const sig = await sendSigned([transferCheckedIx(ataOf(owner, mint), mint, new PublicKey(token.treasuryAta), owner, amountRaw, token.decimals)]);
        const d = await settle("sell", sig);
        push(`Sold ${token.symbol} for ${fmt(d.sol ?? 0, 4)} SOL`, "success", { actionLabel: "VIEW TX", onAction: () => window.open(`https://explorer.solana.com/tx/${sig}?cluster=devnet`, "_blank", "noopener,noreferrer"), timeoutMs: 7000 });
      }
      if (mode === "buy" && exitOn) {
        const tp = Math.max(0, Number(exitPrefs.tp) || 0), sl = Math.min(95, Math.max(0, Number(exitPrefs.sl) || 0)), trail = Math.min(95, Math.max(0, Number(exitPrefs.trail) || 0));
        const px = await sandboxPrice();
        if (px > 0 && (tp || sl || trail)) { armLiveExit({ mint: token.mint, symbol: token.symbol, entryMcap: px, tpPct: tp, slPct: sl, trailPct: trail, sandbox: true }); push("Auto-exit armed (test mode)", "info", { timeoutMs: 3500 }); }
      }
      if (mode === "sell" && pct >= 100) disarmLiveExit(token.mint);
      await refresh();
    } catch (e) {
      push(e instanceof Error ? e.message : "Trade failed.", "warning");
    } finally {
      setBusy(false);
    }
  };

  const held = Number(raw) / 10 ** token.decimals;

  return (
    <div className="ttd">
      <div className="ttd-badge"><FlaskConical size={13} /> Devnet sandbox · play money</div>
      <div className="ttd-tabs">
        {(["buy", "sell"] as const).map((t) => (
          <button key={t} type="button" className={mode === t ? `on ${t}` : ""} onClick={() => setMode(t)}>{t}</button>
        ))}
      </div>
      {!authenticated ? (
        <button type="button" className="tn-btn ttd-go" onClick={() => login()}>Sign in</button>
      ) : (
        <>
          <div className="ttd-row"><span>Devnet balance</span><b>{sol === null ? "…" : `${fmt(sol, 4)} SOL`}</b></div>
          <div className="ttd-row"><span>Price</span><b>{fmt(token.priceSol, 7)} SOL</b></div>
          {mode === "buy" ? (
            <>
              <label className="ttd-label">AMOUNT IN SOL</label>
              <input className="ttd-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="SOL to spend" />
              <div className="ttd-chips">
                {BUY_PRESETS.map((p) => <button key={p} type="button" className={Number(amount) === p ? "on" : ""} onClick={() => setAmount(String(p))}>{p} SOL</button>)}
              </div>
              <ExitBox mint={token.mint} symbol={token.symbol} on={exitOn} setOn={setExitOn} prefs={exitPrefs} setPrefs={setExitPrefs} allowed={canUse("auto_sell")} armed={armed} />
            </>
          ) : (
            <>
              <div className="ttd-row"><span>You hold</span><b>{fmt(held, 2)} {token.symbol}</b></div>
              <div className="ttd-chips">
                {SELL_PRESETS.map((p) => <button key={p} type="button" className={pct === p ? "on" : ""} onClick={() => setPct(p)}>{p === 100 ? "Max" : `${p}%`}</button>)}
              </div>
            </>
          )}
          <button type="button" className={`ttd-go ${mode}`} disabled={busy || !wallet || (mode === "sell" && raw <= BigInt(0))} onClick={() => void trade()}>
            {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
            {busy ? "Confirm in wallet…" : `${mode === "buy" ? "Buy" : "Sell"} ${token.symbol}`}
          </button>
          {sol !== null && sol < 0.05 && <p className="ttd-hint">Low on devnet SOL. Use “Get devnet SOL” in the Testnet tab.</p>}
        </>
      )}
    </div>
  );
}
