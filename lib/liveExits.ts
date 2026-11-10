// Live (real-funds) auto-exit rules: take-profit, stop-loss, trailing stop.
// Rules live in this browser and are executed by <LiveAutoExit/> while Wraith is open.
export const LIVE_EXITS_KEY = "wraith_live_exits_v1";
export const LIVE_EXITS_EVENT = "wraith:live-exits";
export const LIVE_EXIT_FIRED = "wraith:live-exit-fired";
export const EXIT_PREFS_KEY = "wraith_exit_prefs_v1";

export type LiveExitRule = {
  id: string;
  mint: string;
  symbol: string;
  entryMcap: number;
  peakMcap: number;
  tpPct: number;    // sell when up this % (0 = off)
  slPct: number;    // sell when down this % (0 = off)
  trailPct: number; // sell when this % below the peak after entry (0 = off)
  armedAt: number;
  fails: number;
  /** real fill price in USD per token. When present the rule is measured in price (exact); otherwise in market cap. */
  entryPrice?: number;
  peakPrice?: number;
  /** optional first target: sell `tp1SellPct`% of the position at +`tp1Pct`%, then the rest runs with a break-even stop */
  tp1Pct?: number;
  tp1SellPct?: number;
  tp1Done?: boolean;
  /** optional time stop in minutes */
  maxHoldMin?: number;
  // working state kept by the monitor
  lastGood?: number;
  suspect?: number;
  breach?: { reason: "sl" | "trail" | "tp" | "tp1" | "time"; n: number };
  nextTryAt?: number;
  /** devnet test-mode rule: executed by the test dock, never by the mainnet monitor */
  sandbox?: boolean;
};

export function readRules(): LiveExitRule[] {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE_EXITS_KEY) || "[]");
    return Array.isArray(v) ? (v as LiveExitRule[]) : [];
  } catch { return []; }
}
export function writeRules(rules: LiveExitRule[]) {
  try { localStorage.setItem(LIVE_EXITS_KEY, JSON.stringify(rules)); } catch { /* full */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIVE_EXITS_EVENT));
}
export function armLiveExit(r: Omit<LiveExitRule, "id" | "armedAt" | "fails" | "peakMcap">) {
  const rules = readRules().filter((x) => x.mint !== r.mint);
  rules.push({ ...r, id: `exit-${Date.now()}`, peakMcap: r.entryMcap, peakPrice: r.entryPrice, armedAt: Date.now(), fails: 0 });
  writeRules(rules);
}
export function disarmLiveExit(mint: string) {
  writeRules(readRules().filter((x) => x.mint !== mint));
}
