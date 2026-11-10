"use client";

// Executes live auto-exit rules (stop-loss, trailing stop, take-profit, optional partial take-profit and time stop) with the
// user's embedded Solana wallet. Runs only while Wraith is open and the tier has `auto_sell`.
// The decisions live in lib/exitLogic.ts (tested); this file reads prices and carries out the sale.

import { useEffect, useMemo, useRef } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { getMcap } from "@/lib/getTokenPrice";
import { getLiveUsdPrice } from "@/lib/livePrice";
import { executeQuickSell, SwapError } from "@/lib/jupiterSwap";
import { LIVE_EXIT_FIRED, readRules, writeRules, type LiveExitRule } from "@/lib/liveExits";
import { retryDelayMs, slippageFor, stepExit, type ExitCore, type ExitReason } from "@/lib/exitLogic";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TICK_MS = 3000;

// A rule is measured in USD price when it knows the real fill price, otherwise (older rules, the sniper) in market cap.
const usesPrice = (r: LiveExitRule) => (r.entryPrice ?? 0) > 0;
const toCore = (r: LiveExitRule): ExitCore => ({
  entry: usesPrice(r) ? (r.entryPrice as number) : r.entryMcap,
  peak: usesPrice(r) ? (r.peakPrice ?? (r.entryPrice as number)) : r.peakMcap,
  armedAt: r.armedAt,
  tpPct: r.tpPct, slPct: r.slPct, trailPct: r.trailPct,
  tp1Pct: r.tp1Pct, tp1SellPct: r.tp1SellPct, tp1Done: r.tp1Done, maxHoldMin: r.maxHoldMin,
  lastGood: r.lastGood, suspect: r.suspect, breach: r.breach,
});
const fromCore = (r: LiveExitRule, c: Partial<ExitCore>): LiveExitRule => {
  const next: LiveExitRule = { ...r };
  if ("peak" in c && c.peak !== undefined) { if (usesPrice(r)) next.peakPrice = c.peak; else next.peakMcap = c.peak; }
  for (const k of ["tp1Done", "lastGood", "suspect", "breach"] as const) if (k in c) (next as Record<string, unknown>)[k] = c[k];
  return next;
};
const sameState = (a: LiveExitRule, b: LiveExitRule) =>
  a.peakMcap === b.peakMcap && a.peakPrice === b.peakPrice && a.suspect === b.suspect && a.breach?.n === b.breach?.n && a.breach?.reason === b.breach?.reason && a.tp1Done === b.tp1Done;

export default function LiveAutoExit({ enabled }: { enabled: boolean }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { connection } = useConnection();
  const selling = useRef(new Set<string>());

  const address = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const wallet = useMemo(() => wallets.find((w) => w.address === address), [wallets, address]);

  useEffect(() => {
    if (!enabled || !address || !wallet) return;
    const publicKey = new PublicKey(address);
    const signer = {
      publicKey,
      signTransaction: async (tx: VersionedTransaction) => {
        const r = await signTransaction({ transaction: tx.serialize(), wallet, chain: "solana:mainnet" });
        return VersionedTransaction.deserialize(r.signedTransaction);
      },
    };
    const fire = (kind: ExitReason | "failed" | "gone", rule: LiveExitRule, pnl: number, sig?: string) =>
      window.dispatchEvent(new CustomEvent(LIVE_EXIT_FIRED, { detail: { kind, symbol: rule.symbol, mint: rule.mint, pnl, sig } }));
    // always work on the latest saved copy of the rule (a tick can take seconds)
    const patch = (id: string, f: (r: LiveExitRule) => LiveExitRule | null) =>
      writeRules(readRules().flatMap((r) => { if (r.id !== id) return [r]; const n = f(r); return n ? [n] : []; }));

    const tick = async () => {
      if (document.hidden) return;
      const now = Date.now();
      for (const rule of readRules().filter((r) => !r.sandbox)) {
        if (selling.current.has(rule.id)) continue;
        if (rule.nextTryAt && now < rule.nextTryAt) continue;
        const reading = usesPrice(rule)
          ? await getLiveUsdPrice(rule.mint).catch(() => 0)
          : await getMcap(rule.mint, { skipJupiter: true }).catch(() => 0);
        const core = toCore(rule);
        const step = stepExit(core, reading, now);
        const pnl = reading > 0 ? (reading / core.entry - 1) * 100 : 0;

        if (!step.decision.sell) {
          const next = fromCore(rule, step.patch);
          if (!sameState(rule, next)) patch(rule.id, (r) => fromCore(r, step.patch));
          continue;
        }

        const d = step.decision;
        selling.current.add(rule.id);
        try {
          const res = await executeQuickSell(rule.mint, d.pct, signer, connection, { outputMint: USDC_MINT, slippageBps: slippageFor(rule.fails) });
          if (d.pct >= 100) patch(rule.id, () => null);
          else patch(rule.id, (r) => ({ ...fromCore(r, { ...step.patch, ...step.afterSell }), fails: 0, nextTryAt: undefined }));
          fire(d.reason, rule, pnl, res.signature);
          void fetch("/api/token-activity", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mint: rule.mint, side: "sell", signature: res.signature }),
          }).then(() => window.dispatchEvent(new Event("wraith:trade-recorded"))).catch(() => undefined);
        } catch (e) {
          if (e instanceof SwapError && e.code === "NO_TOKENS") { patch(rule.id, () => null); fire("gone", rule, pnl); }
          else {
            // Keep the rule armed. Retry with a wider slippage and a growing pause; tell the user once it keeps failing.
            const fails = rule.fails + 1;
            patch(rule.id, (r) => ({ ...r, fails, nextTryAt: Date.now() + retryDelayMs(fails) }));
            if (fails === 3) fire("failed", rule, pnl);
          }
        } finally { selling.current.delete(rule.id); }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), TICK_MS);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, address, wallet, signTransaction, connection]);

  return null;
}
