// Auto-buy ("sniper") rules. Real funds: every limit here is a hard cap enforced client-side before any buy.
export const SNIPER_KEY = "wraith_sniper_v1";
export const SNIPER_LOG_KEY = "wraith_sniper_log_v1";
export const SNIPER_EVENT = "wraith:sniper-changed";
export const OPEN_SNIPER = "wraith:open-sniper";

export type SniperCfg = {
  on: boolean;
  buyUsd: number;       // USDC per buy
  dailyCapUsd: number;  // max USDC spent per UTC day
  maxOpen: number;      // max simultaneously held sniped tokens
  mcapMin: number;
  mcapMax: number;
  liqMin: number;
  ageMaxMin: number;    // token must be younger than this (minutes)
  minBuyRatioPct: number; // buys / (buys+sells) over 24h
  includeCurve: boolean; // allow pump.fun tokens still on the bonding curve
  tpPct: number; slPct: number; trailPct: number; // auto-exit attached to every snipe
  ack: boolean;         // user accepted the risk screen
};
export const DEFAULT_SNIPER: SniperCfg = {
  on: false, buyUsd: 5, dailyCapUsd: 25, maxOpen: 3, mcapMin: 15_000, mcapMax: 300_000, liqMin: 5_000,
  ageMaxMin: 60, minBuyRatioPct: 55, includeCurve: false, tpPct: 100, slPct: 30, trailPct: 0, ack: false,
};
export type SniperLog = { ts: number; mint: string; symbol: string; usd: number; mcap: number; sig?: string; error?: string };

export function readCfg(): SniperCfg {
  try { return { ...DEFAULT_SNIPER, ...(JSON.parse(localStorage.getItem(SNIPER_KEY) || "{}") as Partial<SniperCfg>) }; } catch { return DEFAULT_SNIPER; }
}
export function writeCfg(c: SniperCfg) {
  try { localStorage.setItem(SNIPER_KEY, JSON.stringify(c)); } catch { /* full */ }
  window.dispatchEvent(new Event(SNIPER_EVENT));
}
export function readLog(): SniperLog[] {
  try { const v = JSON.parse(localStorage.getItem(SNIPER_LOG_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function pushLog(e: SniperLog) {
  try { localStorage.setItem(SNIPER_LOG_KEY, JSON.stringify([e, ...readLog()].slice(0, 100))); } catch { /* full */ }
  window.dispatchEvent(new Event(SNIPER_EVENT));
}
export function spentToday(): number {
  const d = new Date(); const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return readLog().filter((l) => l.ts >= start && !l.error).reduce((s, l) => s + l.usd, 0);
}
