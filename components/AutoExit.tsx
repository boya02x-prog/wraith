"use client";

// Headless auto-exit monitor for PAPER positions: stop-loss, take-profit multiple and trailing stop.
// Runs while Wraith is open in a tab. Positions are opened (with SL/TP/trail) by lib/paperTrading.ts.
// Gated to tiers with the `auto_sell` feature; below that, positions stay manual.

import { useEffect } from "react";
import { getMcap } from "@/lib/getTokenPrice";
import { PAPER_SYNC_EVENT } from "@/lib/paperTrading";

const BAL = "wraith_paper_bal_v1";
const POS = "wraith_paper_positions_v1";
const LOG = "wraith_paper_log_v1";
const TICK_MS = 6000;

type Pos = {
  id: string; symbol: string; mint: string; entryMcap: number; amountSol: number;
  slPct: number; tpX: number; trailPct: number; peakMcap: number; currentMcap: number;
  currentPnlPct: number; trailStopMcap: number; status: "watching" | "closed";
  exitReason?: string; exitMcap?: number; exitPnlPct?: number; imageUrl?: string; ts: number;
};

function read<T>(k: string, d: T): T {
  try { const r = localStorage.getItem(k); return r != null ? (JSON.parse(r) as T) : d; } catch { return d; }
}
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } }

export default function AutoExit({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const open = read<Pos[]>(POS, []).filter((p) => p.status === "watching" && p.mint);
        if (!open.length) return;
        const mcaps = new Map<string, number>();
        await Promise.all([...new Set(open.map((p) => p.mint))].map(async (m) => {
          const v = await getMcap(m, { skipJupiter: true }).catch(() => 0);
          if (v > 0) mcaps.set(m, v);
        }));
        // Re-read after the awaits: a buy may have landed meanwhile.
        const all = read<Pos[]>(POS, []);
        let bal = read<number>(BAL, 10);
        const log = read<unknown[]>(LOG, []);
        let changed = false;
        const next = all.map((p) => {
          const mc = mcaps.get(p.mint);
          if (p.status !== "watching" || !mc) return p;
          const peak = Math.max(p.peakMcap || p.entryMcap, mc);
          const trailStop = peak * (1 - (p.trailPct || 0) / 100);
          const pnl = (mc / p.entryMcap - 1) * 100;
          let reason: "SL" | "TP" | "TRAIL" | null = null;
          if (p.slPct < 0 && pnl <= p.slPct) reason = "SL";
          else if (p.tpX > 0 && mc >= p.entryMcap * p.tpX) reason = "TP";
          else if (p.trailPct > 0 && peak > p.entryMcap && mc <= trailStop) reason = "TRAIL";
          changed = true;
          if (!reason) return { ...p, peakMcap: peak, currentMcap: mc, currentPnlPct: pnl, trailStopMcap: trailStop };
          bal = parseFloat((bal + p.amountSol * (mc / p.entryMcap)).toFixed(6));
          log.unshift({
            id: p.id, symbol: p.symbol, mint: p.mint, entryMcap: p.entryMcap, exitMcap: mc, amountSol: p.amountSol,
            slPct: p.slPct, tpX: p.tpX, pnlPct: pnl, exitReason: reason, imageUrl: p.imageUrl, ts: Date.now(),
          });
          window.dispatchEvent(new CustomEvent("wraith:autoexit", { detail: { symbol: p.symbol, reason, pnlPct: pnl } }));
          return { ...p, status: "closed" as const, exitReason: reason, exitMcap: mc, exitPnlPct: pnl, peakMcap: peak, currentMcap: mc, currentPnlPct: pnl };
        });
        if (changed) {
          write(POS, next); write(BAL, bal); write(LOG, log);
          window.dispatchEvent(new CustomEvent(PAPER_SYNC_EVENT));
        }
      } finally { busy = false; }
    };
    void tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);
  return null;
}
