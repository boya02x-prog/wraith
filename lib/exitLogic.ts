// lib/exitLogic.ts
// The decision part of auto-exit, with no network and no wallet, so it can be tested without risking money.
// "reading" is whatever the monitor measures (USD price, or market cap for older rules); only ratios to `entry` matter.
//
// What it does differently from the first version, which could sell for no good reason:
//   - one bad price tick can no longer trigger a sale: a reading that jumps 4x either way is ignored until the next reading agrees,
//   - stop-loss, trailing stop and take-profit need two readings in a row on the wrong side (a deep breach sells at once),
//   - optional partial take-profit (sell part at a first target, then the rest runs with a breakeven stop and the trail),
//   - optional time stop.

export type ExitReason = "sl" | "trail" | "tp" | "tp1" | "time";

export interface ExitCore {
  /** price the position was opened at (fill price) in the same units as readings */
  entry: number;
  /** highest accepted reading since entry */
  peak: number;
  armedAt: number;
  tpPct: number; // sell everything when up this % (0 = off)
  slPct: number; // sell everything when down this % (0 = off)
  trailPct: number; // sell everything when this % below the peak, once above entry (0 = off)
  tp1Pct?: number; // first target: up this % ...
  tp1SellPct?: number; // ... sell this % of what is left (1..99)
  tp1Done?: boolean;
  maxHoldMin?: number; // sell everything after this many minutes (0 = off)
  // working state
  lastGood?: number;
  suspect?: number;
  breach?: { reason: ExitReason; n: number };
}

export type Decision = { sell: false } | { sell: true; reason: ExitReason; pct: number };
export interface Step {
  /** state to save now */
  patch: Partial<ExitCore>;
  decision: Decision;
  /** state to save only after the sale actually went through (e.g. the first target is done) */
  afterSell?: Partial<ExitCore>;
}

export const CONFIRM_READS = 2;
export const BAD_TICK_JUMP = 4;
/** a breach this far (in % of entry) beyond the trigger is already a crash: do not wait for a second reading */
export const DEEP_BREACH_PTS = 10;

export function stepExit(r: ExitCore, reading: number, now: number): Step {
  // time stop does not need a price
  if ((r.maxHoldMin ?? 0) > 0 && now - r.armedAt >= (r.maxHoldMin as number) * 60_000) {
    return { patch: {}, decision: { sell: true, reason: "time", pct: 100 } };
  }
  if (!(reading > 0) || !Number.isFinite(reading) || !(r.entry > 0)) return { patch: {}, decision: { sell: false } };

  // 1) ignore a reading that is wildly off from the last good one, unless the next reading agrees with it
  const ref = r.lastGood && r.lastGood > 0 ? r.lastGood : r.entry;
  const ratio = reading / ref;
  if (ratio > BAD_TICK_JUMP || ratio < 1 / BAD_TICK_JUMP) {
    const agrees = r.suspect && Math.abs(reading / r.suspect - 1) < 0.35;
    if (!agrees) return { patch: { suspect: reading }, decision: { sell: false } };
  }

  const peak = Math.max(r.peak, reading);
  const level = reading / r.entry; // 1 = break-even
  const base: Partial<ExitCore> = { peak, lastGood: reading, suspect: undefined };

  // 2) which rule is breached right now?
  let reason: ExitReason | null = null;
  let deep = false;
  const slLevel = r.tp1Done ? 1 : r.slPct > 0 ? 1 - r.slPct / 100 : null; // after the first target the stop moves up to break-even
  if (slLevel !== null && level <= slLevel) {
    reason = "sl";
    deep = (slLevel - level) * 100 >= DEEP_BREACH_PTS - 1e-9;
  } else if (r.trailPct > 0 && peak > r.entry && reading <= peak * (1 - r.trailPct / 100)) {
    reason = "trail";
    deep = ((peak * (1 - r.trailPct / 100) - reading) / r.entry) * 100 >= DEEP_BREACH_PTS - 1e-9;
  } else if ((r.tp1Pct ?? 0) > 0 && !r.tp1Done && level >= 1 + (r.tp1Pct as number) / 100) {
    reason = "tp1";
  } else if (r.tpPct > 0 && level >= 1 + r.tpPct / 100) {
    reason = "tp";
  }

  if (!reason) return { patch: { ...base, breach: undefined }, decision: { sell: false } };

  // 3) confirm with a second reading (a deep breach goes straight through)
  const n = (r.breach?.reason === reason ? r.breach.n : 0) + 1;
  if (n < CONFIRM_READS && !deep) return { patch: { ...base, breach: { reason, n } }, decision: { sell: false } };

  if (reason === "tp1") {
    const pct = Math.min(99, Math.max(1, Math.round(r.tp1SellPct ?? 50)));
    return { patch: { ...base, breach: undefined }, decision: { sell: true, reason, pct }, afterSell: { tp1Done: true, breach: undefined } };
  }
  return { patch: { ...base, breach: undefined }, decision: { sell: true, reason, pct: 100 } };
}

/** Slippage to use for a sale: starts at 5% and widens after each failed attempt, so an exit does not get stuck. */
export const slippageFor = (fails: number) => [500, 1000, 1500, 2500, 4000][Math.min(fails, 4)];
/** Wait before the next attempt after failures (ms): 0, 3s, 12s, 27s, then every 60s. */
export const retryDelayMs = (fails: number) => Math.min(60_000, fails * fails * 3_000);

// ── position sizing ───────────────────────────────────────────────────────────────────────────
// Fixed-fraction risk: decide what share of the account you accept to lose if the stop is hit, and size the position from that.
//   size = account x risk% / stop%       (e.g. 1% risk, 30% stop -> 3.3% of the account)
// It never exceeds `maxPct` of the account, and it is scaled down when the token is thin (price impact eats the stop).

export interface SizeInput {
  balance: number; // cash available, same currency as the result
  riskPct: number; // % of balance you accept to lose on this trade (0.25 to 5)
  stopPct: number; // stop-loss distance in %, 0 = none
  maxPct?: number; // hard cap as % of balance (default 20)
  liquidity?: number; // pool liquidity in the same currency; the position stays under 1% of it
  odds?: number; // model probability (0..1) of reaching 2x, optional
  base?: number; // base rate the odds are compared with
}
export interface SizeOut { size: number; pctOfBalance: number; riskAmount: number; notes: string[]; capped: boolean }

export function suggestSize(i: SizeInput): SizeOut {
  const notes: string[] = [];
  const bal = Math.max(0, i.balance);
  const risk = Math.min(5, Math.max(0.25, i.riskPct)) / 100;
  const cap = Math.min(100, Math.max(1, i.maxPct ?? 20)) / 100;
  let capped = false;
  let frac: number;
  if (i.stopPct > 0) frac = risk / (Math.min(95, i.stopPct) / 100);
  else {
    // without a stop the whole position can be lost, so size as if the stop were 100%
    frac = risk;
    notes.push("No stop-loss set: sized as if the whole position could be lost.");
  }
  // a stronger-than-usual model reading nudges size up a little, a weaker one down (never more than +-25%)
  if (typeof i.odds === "number" && typeof i.base === "number" && i.base > 0) {
    const adj = Math.max(0.75, Math.min(1.25, 1 + (i.odds - i.base) / i.base / 4));
    if (Math.abs(adj - 1) > 0.03) notes.push(adj > 1 ? "Model reads above average: size nudged up." : "Model reads below average: size nudged down.");
    frac *= adj;
  }
  if (frac > cap) { frac = cap; capped = true; notes.push(`Capped at ${Math.round(cap * 100)}% of your balance.`); }
  let size = bal * frac;
  if (i.liquidity && i.liquidity > 0 && size > i.liquidity * 0.01) {
    size = i.liquidity * 0.01;
    capped = true;
    notes.push("Kept under 1% of the pool's liquidity so your own trade does not move the price against you.");
  }
  size = Math.floor(size * 100) / 100;
  return { size, pctOfBalance: bal > 0 ? (size / bal) * 100 : 0, riskAmount: i.stopPct > 0 ? size * (Math.min(95, i.stopPct) / 100) : size, notes, capped };
}
