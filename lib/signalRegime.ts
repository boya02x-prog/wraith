// lib/signalRegime.ts  (pure, no database)
// Context features for the model: how the market has treated recent calls (regime), and where THIS call ranks among the last
// day's calls on volume, liquidity, momentum and so on (ranks). Everything is computed only from calls BEFORE the one being
// described, so training and live scoring see the same thing. Proven in scripts/research-model2.ts (corrected labels, walk-forward):
// regime + ranks lifted AUC by about +0.03 (not yet statistically proven, so the champion/challenger rule guards the live model).
import type { Features } from "@/lib/signalModel";

const H = 3_600_000;
/** feature written -> raw indicator it ranks */
export const CTX_RANK: [string, string][] = [
  ["rkVol", "volRatio"], ["rkLiq", "liq"], ["rkH1", "h1"], ["rkM5", "m5"], ["rkTraders", "traders1h"],
  ["rkBuy", "buyShare"], ["rkMcap", "mcap"], ["rkHolders", "holders"], ["rkAge", "ageMin"],
];

export interface CtxCall { at: number; f: Features; win: boolean; col: boolean }
export interface CtxPrior { gw: number; gc: number }

/** Overall win / collapse rate, used as the starting guess when few recent calls exist. */
export function priorOf(hist: CtxCall[]): CtxPrior {
  const n = hist.length || 1;
  return { gw: hist.filter((c) => c.win).length / n, gc: hist.filter((c) => c.col).length / n };
}

/**
 * Context for a call at time `at` with features `f`. `hist` is sorted oldest first; only hist[0..hi) (calls before this one) are used.
 * Regime counts only calls that had matured (4h+) by then; ranks use the previous 24h of calls (known at call time, no outcome needed).
 */
export function contextAt(hist: CtxCall[], hi: number, at: number, f: Features, prior: CtxPrior): Features {
  const out: Features = {};
  const reg = (lookbackH: number) => {
    let n = 0, w = 0, k = 0;
    for (let j = hi - 1; j >= 0; j--) {
      const d = hist[j];
      if (d.at < at - lookbackH * H) break;
      if (d.at > at - 4 * H) continue;
      n++; if (d.win) w++; if (d.col) k++;
    }
    return { n, w, k };
  };
  const r12 = reg(16), r36 = reg(40);
  out.regWin12 = (r12.w + 10 * prior.gw) / (r12.n + 10);
  out.regCol12 = (r12.k + 10 * prior.gc) / (r12.n + 10);
  out.regN12 = r12.n;
  out.regWin36 = (r36.w + 10 * prior.gw) / (r36.n + 10);
  for (const [key, src] of CTX_RANK) {
    const v = f[src];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    let below = 0, tot = 0;
    for (let j = hi - 1; j >= 0; j--) {
      const d = hist[j];
      if (d.at < at - 24 * H) break;
      const x = d.f[src];
      if (typeof x !== "number" || !Number.isFinite(x)) continue;
      tot++; if (x < v) below++;
    }
    if (tot >= 15) out[key] = below / tot;
  }
  return out;
}

interface CallDoc { features?: Features; spottedAt: number; spottedMcap: number; peakMcap: number; lastMcap: number }

/** Training: history of calls (any order) -> the same calls with context added to their features, oldest first. */
export function withContext<T extends CallDoc>(docs: T[]): { docs: (T & { features: Features })[]; prior: CtxPrior } {
  const sorted = [...docs].sort((a, b) => a.spottedAt - b.spottedAt);
  const hist: CtxCall[] = sorted.map((d) => ({
    at: d.spottedAt, f: d.features ?? {},
    win: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= 2, col: d.lastMcap / d.spottedMcap <= 0.2,
  }));
  const prior = priorOf(hist);
  return { docs: sorted.map((d, i) => ({ ...d, features: { ...(d.features ?? {}), ...contextAt(hist, i, d.spottedAt, d.features ?? {}, prior) } })), prior };
}
