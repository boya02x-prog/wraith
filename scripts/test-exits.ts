/**
 * Tests for the auto-exit decisions and position sizing. No network, no wallet.  npx tsx scripts/test-exits.ts
 */
import assert from "node:assert/strict";
import { stepExit, suggestSize, slippageFor, retryDelayMs, type ExitCore } from "../lib/exitLogic";

const T0 = 1_700_000_000_000;
const mk = (o: Partial<ExitCore> = {}): ExitCore => ({ entry: 100, peak: 100, armedAt: T0, tpPct: 100, slPct: 30, trailPct: 0, ...o });
/** feeds readings one per 3s, applying patches like the monitor does; returns the first sale (if any) */
function run(core: ExitCore, readings: number[]) {
  let c = core;
  for (let i = 0; i < readings.length; i++) {
    const s = stepExit(c, readings[i], T0 + (i + 1) * 3000);
    c = { ...c, ...s.patch };
    if (s.decision.sell) { if (s.afterSell) c = { ...c, ...s.afterSell }; return { sold: s.decision, at: i, c }; }
  }
  return { sold: null, at: -1, c };
}
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("  ok  ", name); };

ok("stop-loss needs two readings, then sells 100%", () => {
  const r = run(mk(), [95, 69, 68]);
  assert.equal(r.sold?.sell && r.sold.reason, "sl");
  assert.equal(r.at, 2); // first breach at index 1 only counts once
});
ok("a single dip that recovers does NOT sell", () => {
  const r = run(mk(), [95, 69, 96, 97]);
  assert.equal(r.sold, null);
});
ok("a crash far past the stop sells immediately", () => {
  const r = run(mk(), [60]);
  assert.equal(r.sold?.sell && r.sold.reason, "sl"); // 40 points below entry, stop at -30: deep
  assert.equal(r.at, 0);
});
ok("a bad tick (price 10x too low) is ignored when the next reading is normal", () => {
  const r = run(mk(), [100, 10, 101, 99]);
  assert.equal(r.sold, null);
});
ok("a real 10x crash that persists is accepted on the second reading", () => {
  const r = run(mk(), [100, 10, 11]);
  assert.equal(r.sold?.sell && r.sold.reason, "sl");
});
ok("take-profit sells everything after two readings", () => {
  const r = run(mk(), [150, 205, 210]);
  assert.equal(r.sold?.sell && r.sold.reason, "tp");
  assert.equal(r.sold?.sell && r.sold.pct, 100);
});
ok("a bad tick spike up does not trigger take-profit", () => {
  const r = run(mk(), [105, 900, 106, 107]);
  assert.equal(r.sold, null);
});
ok("trailing stop follows the peak and sells 30% below it", () => {
  const r = run(mk({ slPct: 0, tpPct: 0, trailPct: 30 }), [120, 160, 200, 150, 139, 138]);
  assert.equal(r.sold?.sell && r.sold.reason, "trail");
  assert.equal(r.c.peak, 200);
});
ok("trailing stop is not armed until price is above entry", () => {
  const r = run(mk({ slPct: 0, tpPct: 0, trailPct: 10 }), [95, 90, 85, 80]);
  assert.equal(r.sold, null);
});
ok("partial take-profit sells part, then the stop moves to break-even", () => {
  const core = mk({ tp1Pct: 50, tp1SellPct: 40, slPct: 30, tpPct: 0, trailPct: 30 });
  const a = run(core, [120, 152, 155]);
  assert.equal(a.sold?.sell && a.sold.reason, "tp1");
  assert.equal(a.sold?.sell && a.sold.pct, 40);
  assert.equal(a.c.tp1Done, true);
  // price falls back to entry: break-even stop sells the rest (2 readings)
  const b = run(a.c, [110, 99, 98]);
  assert.equal(b.sold?.sell && b.sold.reason, "sl");
});
ok("after the first target the rest still trails from the peak", () => {
  const core = mk({ tp1Pct: 50, tp1SellPct: 40, slPct: 30, tpPct: 0, trailPct: 30 });
  const a = run(core, [152, 155]);
  const b = run(a.c, [200, 260, 250, 180, 179]);
  assert.equal(b.sold?.sell && b.sold.reason, "trail");
});
ok("time stop sells everything with no price needed", () => {
  const s = stepExit(mk({ maxHoldMin: 10 }), 0, T0 + 11 * 60_000);
  assert.equal(s.decision.sell && s.decision.reason, "time");
});
ok("no price reading means no decision", () => {
  assert.equal(stepExit(mk(), 0, T0 + 1000).decision.sell, false);
  assert.equal(stepExit(mk(), NaN, T0 + 1000).decision.sell, false);
});
ok("slippage widens and retries back off", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(slippageFor), [500, 1000, 1500, 2500, 4000, 4000]);
  assert.equal(retryDelayMs(0), 0);
  assert.equal(retryDelayMs(1), 3000);
  assert.equal(retryDelayMs(10), 60000);
});
ok("sizing: 1% risk with a 30% stop is 3.33% of the account", () => {
  const s = suggestSize({ balance: 1000, riskPct: 1, stopPct: 30 });
  assert.equal(s.size, 33.33);
  assert.equal(Math.round(s.riskAmount * 100) / 100, 10);
});
ok("sizing: capped at 20% of the account", () => {
  const s = suggestSize({ balance: 1000, riskPct: 5, stopPct: 10 });
  assert.equal(s.size, 200);
  assert.equal(s.capped, true);
});
ok("sizing: stays under 1% of pool liquidity", () => {
  const s = suggestSize({ balance: 10000, riskPct: 2, stopPct: 20, liquidity: 5000 });
  assert.equal(s.size, 50);
  assert.equal(s.capped, true);
});
ok("sizing: no stop sizes as if everything could be lost", () => {
  const s = suggestSize({ balance: 1000, riskPct: 1, stopPct: 0 });
  assert.equal(s.size, 10);
});
ok("sizing: model odds nudge size by at most 25%", () => {
  const up = suggestSize({ balance: 1000, riskPct: 1, stopPct: 30, odds: 0.9, base: 0.15 });
  const down = suggestSize({ balance: 1000, riskPct: 1, stopPct: 30, odds: 0.01, base: 0.15 });
  assert.ok(up.size <= 33.33 * 1.25 + 0.01 && up.size > 33.33);
  assert.ok(down.size >= 33.33 * 0.75 - 0.01 && down.size < 33.33);
});
console.log(`\nall ${n} checks passed`);
