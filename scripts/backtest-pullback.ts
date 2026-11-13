/**
 * Would waiting for a pullback have made the public calls pay?   npx tsx scripts/backtest-pullback.ts
 * Read-only, no database: uses the real price paths in scripts/.pilot/candles*.jsonl (5-minute candles after each public call,
 * as ratios to the price at the call). For every rule "enter only if the price first falls X% below the call price within W
 * minutes" it replays the trade under four exit rules with realistic costs (pathlib: 1.5% in, 3% out, 6% through a stop), and
 * prints, per rule: how many calls ever got an entry, the average result per trade with a 95% range, win rate, and the SAME
 * exit rule applied to those exact calls if you had bought at the call price (so a better number can't just be a lucky subset).
 * Two entry styles: LIMIT (filled exactly at the X% level the moment a candle's low touches it: optimistic) and CONFIRM
 * (buy at the CLOSE of the first candle that touched the level: cautious, you pay what the market really was).
 * Honest limits: 5-minute candles hide what happens inside a candle; tokens whose pool vanished are missing (leans optimistic);
 * a few hundred calls give wide ranges, so read the ranges. Chronological split: the rule is judged on EARLIER and LATER calls.
 */
import { existsSync, readFileSync } from "node:fs";
import { COSTS, simulate, type Policy } from "./pathlib";

interface Series { addr: string; at: number; engine: number | null; shadow: boolean; s: number[][]; cover?: number }
const P = (sl: number, tp: number, trail: number, trailAfter: number, tp1: number, tp1Sell: number, hold = 0): Policy => ({ sl, tp, trail, trailAfter, tp1, tp1Sell, hold });
const POLICIES: [string, Policy][] = [
  ["app default (TP +100%, SL -30%)", P(30, 100, 0, 0, 0, 0)],
  ["quick (TP +30%, trail -10%)", P(0, 30, 10, 0, 0, 0)],
  ["middle (TP +50%, trail -20%)", P(0, 50, 20, 0, 0, 0)],
  ["runner (half at +100%, trail -30% after +50%, SL -30%)", P(30, 0, 30, 50, 100, 50)],
];
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function ci(xs: number[], n = 800): [number, number] {
  if (xs.length < 10) return [NaN, NaN];
  const m: number[] = [];
  for (let b = 0; b < n; b++) { let s = 0; for (let k = 0; k < xs.length; k++) s += xs[Math.floor(Math.random() * xs.length)]; m.push(s / xs.length); }
  m.sort((a, c) => a - c);
  return [m[Math.floor(n * 0.025)], m[Math.floor(n * 0.975)]];
}
const rng = (xs: number[]) => { const [lo, hi] = ci(xs); return Number.isNaN(lo) ? "n too small" : `${pct(lo)}..${pct(hi)}`; };

/** Series re-based to a new entry price at candle index i (entry candle itself excluded for CONFIRM, partly used for LIMIT). */
function rebase(s: number[][], from: number, entryPx: number, limit: boolean): number[][] {
  const out: number[][] = [];
  for (let i = from; i < s.length; i++) {
    const [m, o, h, l, c] = s[i];
    if (i === from && limit) {
      // filled inside this candle at entryPx: afterwards only the close is known, so treat the rest of the candle as open=entry, low=min(close, entry)
      out.push([0, 1, Math.max(1, c / entryPx), Math.min(1, c / entryPx), c / entryPx]);
    } else out.push([m - s[from][0], o / entryPx, h / entryPx, l / entryPx, c / entryPx]);
  }
  return out;
}

function main() {
  const files = ["scripts/.pilot/candles.jsonl", "scripts/.pilot/candles-helius.jsonl"].filter((f) => existsSync(f));
  const byAddr = new Map<string, Series>();
  for (const f of files) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l) as Series; const cur = byAddr.get(x.addr);
    if (!cur || (x.cover ?? 1440) > (cur.cover ?? 1440)) byAddr.set(x.addr, x);
  }
  const calls = [...byAddr.values()].filter((x) => x.s.length >= 8 && (x.cover ?? 1440) >= 360 && x.engine === 2 && !x.shadow).sort((a, b) => a.at - b.at);
  console.log(`public calls with a real price path: ${calls.length}  (${new Date(calls[0].at).toISOString().slice(0, 10)} .. ${new Date(calls[calls.length - 1].at).toISOString().slice(0, 10)})`);
  const cut = Math.floor(calls.length * 0.5);
  const halves: [string, Series[]][] = [["ALL", calls], ["earlier half", calls.slice(0, cut)], ["later half", calls.slice(cut)]];

  const LEVELS = [0.15, 0.25, 0.4]; // wait for a drop of this much below the call price
  const WINDOWS = [60, 180, 360]; // ... within this many minutes of the call
  const STYLES: ["limit" | "confirm"][] = [["limit"], ["confirm"]];

  for (const [policyName, pol] of POLICIES) {
    console.log(`\n================ exit rule: ${policyName} ================`);
    const base = calls.map((c) => simulate(c.s, pol, COSTS));
    console.log(`buy AT the call (no waiting), all ${calls.length} calls: ${pct(mean(base))}  [${rng(base)}]  win ${(base.filter((v) => v > 0).length / base.length * 100).toFixed(0)}%`);
    for (const [halfName, set] of halves) {
      if (halfName !== "ALL") console.log(`  -- ${halfName} (${set.length} calls) --`);
      for (const [style] of STYLES) for (const W of WINDOWS) for (const X of LEVELS) {
        const picked: { c: Series; r: number }[] = [];
        for (const c of set) {
          const s = c.s;
          let idx = -1;
          for (let i = 0; i < s.length; i++) { if (s[i][0] <= 0) continue; if (s[i][0] > W) break; if (s[i][3] <= 1 - X) { idx = i; break; } }
          if (idx < 0) continue;
          let r: number;
          if (style === "limit") r = simulate(rebase(s, idx, 1 - X, true), pol, COSTS);
          else { if (idx + 1 >= s.length) continue; r = simulate(rebase(s, idx + 1, s[idx][4], false), pol, COSTS); }
          picked.push({ c, r });
        }
        if (picked.length < 8) continue;
        const rs = picked.map((p) => p.r), sameBase = picked.map((p) => simulate(p.c.s, pol, COSTS));
        const fill = picked.length / set.length;
        console.log(`  ${style.padEnd(7)} -${(X * 100).toFixed(0)}% within ${String(W).padStart(3)}m  filled ${(fill * 100).toFixed(0).padStart(3)}% (n=${String(picked.length).padStart(3)})  per trade ${pct(mean(rs)).padStart(7)} [${rng(rs)}]  win ${(rs.filter((v) => v > 0).length / rs.length * 100).toFixed(0).padStart(3)}%   same calls bought at call: ${pct(mean(sameBase))}`);
      }
    }
  }
  console.log("\nHow to read: a pullback rule only matters if its per-trade result is clearly above 0 AND above 'same calls bought at call', with the ranges not both straddling 0, AND it holds in BOTH halves. 'filled' is the share of calls that ever pulled back that far.");
}
main();
