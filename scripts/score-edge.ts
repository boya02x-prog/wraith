/**
 * Does a higher scanner score actually make money? Read-only:  npx tsx scripts/score-edge.ts
 * Takes every public call that has a REAL price path (scripts/.pilot/candles*.jsonl from relabel-paths.ts / relabel-helius.ts),
 * joins the score the scanner gave it when it called it, and replays the trade under a few exit rules with realistic costs.
 *   1. by score group: how often it really reached 2x, how often it collapsed, and the average result of the trade
 *   2. by score threshold, judged only on the LATER 40% of calls: "if I only took calls scoring at least X, would it have paid?"
 *   3. the same with half the trading costs, to show how much of the picture is cost
 * Honest limits: 5-minute candles hide what happens inside a candle (a stop is assumed to hit first), calls whose pool vanished are
 * missing from the data (results lean optimistic), and a few hundred calls give wide ranges: read the ranges, not just the averages.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { auc } from "../lib/signalModel";
import { COSTS, simulate, stats, type Costs, type Policy } from "./pathlib";

interface Series { addr: string; at: number; engine: number | null; shadow: boolean; s: number[][]; cover?: number }
interface Row { addr: string; at: number; score: number; tier: string; peak: number; last: number; s: number[][] }

const P = (sl: number, tp: number, trail: number, trailAfter: number, tp1: number, tp1Sell: number, hold = 0): Policy => ({ sl, tp, trail, trailAfter, tp1, tp1Sell, hold });
const POLICIES: [string, Policy][] = [
  ["app default (TP +100%, SL -30%)", P(30, 100, 0, 0, 0, 0)],
  ["quick (TP +30%, trail -10%)", P(0, 30, 10, 0, 0, 0)],
  ["middle (TP +50%, trail -20%)", P(0, 50, 20, 0, 0, 0)],
  ["runner (half at +100%, trail -30% after +50%, SL -30%)", P(30, 0, 30, 50, 100, 50)],
];
const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
function ci(xs: number[], n = 600): [number, number] {
  if (xs.length < 8) return [NaN, NaN];
  const m: number[] = [];
  for (let b = 0; b < n; b++) { let s = 0; for (let k = 0; k < xs.length; k++) s += xs[Math.floor(Math.random() * xs.length)]; m.push(s / xs.length); }
  m.sort((a, c) => a - c);
  return [m[Math.floor(n * 0.025)], m[Math.floor(n * 0.975)]];
}
const range = (xs: number[]) => { const [lo, hi] = ci(xs); return Number.isNaN(lo) ? "n too small" : `${pct(lo)} to ${pct(hi)}`; };

async function main() {
  const files = ["scripts/.pilot/candles.jsonl", "scripts/.pilot/candles-helius.jsonl"].filter((f) => existsSync(f));
  const byAddr = new Map<string, Series>();
  for (const f of files) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l) as Series; const cur = byAddr.get(x.addr);
    if (!cur || (x.cover ?? 1440) > (cur.cover ?? 1440)) byAddr.set(x.addr, x);
  }
  const usable = [...byAddr.values()].filter((x) => x.s.length >= 6 && (x.cover ?? 1440) >= 180 && x.engine === 2 && !x.shadow);
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ address: { $in: usable.map((x) => x.addr) } }, { projection: { address: 1, score: 1, tier: 1 } }).toArray();
  await c.close();
  const info = new Map(docs.map((d) => [d.address as string, d]));
  const rows: Row[] = usable.flatMap((x) => {
    const d = info.get(x.addr);
    if (!d || typeof d.score !== "number") return [];
    const peak = Math.max(...x.s.filter((r) => r[0] >= 0).map((r) => r[2]), 1);
    return [{ addr: x.addr, at: x.at, score: d.score as number, tier: String(d.tier ?? ""), peak, last: x.s[x.s.length - 1][4], s: x.s }];
  }).sort((a, b) => a.at - b.at);
  if (rows.length < 80) { console.log(`Only ${rows.length} public calls with a real path and a score so far. Need about 80+ for a first look, 300+ to trust it.`); return; }
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const q = (f: number) => scores[Math.min(scores.length - 1, Math.floor(scores.length * f))];
  console.log(`${rows.length} public calls with a real price path and a score (score range ${scores[0]} to ${scores[scores.length - 1]}, median ${q(0.5)}, HOT calls ${rows.filter((r) => r.tier === "HOT").length}).`);
  const win = (r: Row) => r.peak >= 2, col = (r: Row) => r.last <= 0.2;
  console.log(`Overall: ${(mean(rows.map((r) => (win(r) ? 1 : 0))) * 100).toFixed(1)}% reached 2x, ${(mean(rows.map((r) => (col(r) ? 1 : 0))) * 100).toFixed(1)}% collapsed to 20% or less of the call price.`);
  console.log(`Score alone as a 2x detector: AUC ${auc(rows.map((r) => r.score), rows.map((r) => (win(r) ? 1 : 0))).toFixed(3)} (0.50 = coin flip)\n`);

  const groups: [string, (r: Row) => boolean][] = [
    ["top 10% of scores", (r) => r.score >= q(0.9)],
    ["next 15%", (r) => r.score >= q(0.75) && r.score < q(0.9)],
    ["middle 25%", (r) => r.score >= q(0.5) && r.score < q(0.75)],
    ["bottom 50%", (r) => r.score < q(0.5)],
    ["marked HOT", (r) => r.tier === "HOT"],
  ];
  console.log("== 1. BY SCORE GROUP (average result per trade, costs 1.5% in / 3% out / 6% out through a stop) ==");
  console.log("group".padEnd(20) + "calls".padStart(6) + "  reach 2x  collapsed" + POLICIES.map(([n]) => `  ${n.split(" (")[0]}`).join(""));
  for (const [name, f] of groups) {
    const g = rows.filter(f);
    if (!g.length) continue;
    const cells = POLICIES.map(([, p]) => { const r = g.map((x) => simulate(x.s, p)); return `${pct(stats(r).trimmed)}`.padStart(name.length > 0 ? 8 : 8); });
    console.log(name.padEnd(20) + String(g.length).padStart(6) + `  ${(mean(g.map((r) => (win(r) ? 1 : 0))) * 100).toFixed(0).padStart(7)}%  ${(mean(g.map((r) => (col(r) ? 1 : 0))) * 100).toFixed(0).padStart(8)}%` + cells.map((c2, i) => c2.padStart(POLICIES[i][0].split(" (")[0].length + 2)).join(""));
  }
  console.log("(averages drop the best and worst 2% so one lucky 100x cannot carry them)\n");

  const cut = Math.floor(rows.length * 0.6);
  const later = rows.slice(cut);
  const sweep = (title: string, k: Costs) => {
    console.log(title);
    console.log("only calls scoring at least".padEnd(30) + "calls".padStart(6) + "  " + POLICIES.slice(1, 3).map(([n]) => n.split(" (")[0].padEnd(34)).join(""));
    for (const T of [0, 50, 55, 60, 65, 70, 75, 80]) {
      const g = later.filter((r) => r.score >= T);
      if (g.length < 12) continue;
      const cells = POLICIES.slice(1, 3).map(([, p]) => { const r = g.map((x) => simulate(x.s, p, k)); return `${pct(mean(r))} (${range(r)})`.padEnd(34); });
      console.log(`score ${String(T).padEnd(3)} or more`.padEnd(30) + String(g.length).padStart(6) + "  " + cells.join(""));
    }
    console.log();
  };
  console.log(`== 2. SCORE THRESHOLD, judged only on the later ${later.length} calls (95% range in brackets; a range that stays above zero is real) ==`);
  sweep("with the usual costs:", COSTS);
  console.log("== 3. THE SAME WITH HALF THE COSTS (0.75% in, 1.5% out, 3% out through a stop: small orders in liquid tokens) ==");
  sweep("with half the costs:", { entry: COSTS.entry / 2, exit: COSTS.exit / 2, stop: COSTS.stop / 2 });
}
main().catch((e) => { console.error(e); process.exit(1); });
