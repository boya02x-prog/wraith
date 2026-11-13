/**
 * The collapse warning rates some calls "very risky" that later go to 5x, 10x or more. How often, and is the warning still worth it?
 *   npx tsx scripts/backtest-collapse-misses.ts      (read-only)
 * Every call (public and shadow, engine 2, 24h+ old) gets a collapse score from a model that only saw EARLIER calls
 * (walk-forward, same method the Discover card reports). Calls are then split into risk quarters, and for each quarter this
 * prints how many collapsed (ended below 20% of the called price), how many reached 2x / 5x / 10x, and what the average call
 * ended at. The point: a warning that is right most of the time still has misses, and a moonshot among the "risky" is the price.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { COSTS, simulate, type Policy } from "./pathlib";
import { outOfSampleScores, type TrainRow, type Features } from "../lib/signalModel";

interface Extra extends TrainRow { peak: number; end: number; addr: string }
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } },
      { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, shadow: 1, symbol: 1, address: 1 } }).sort({ spottedAt: 1 }).toArray();
  await cli.close();
  const rows: Extra[] = docs.map((d) => {
    const s = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap ?? s), Number(d.lastMcap ?? s)) / s, end = Number(d.lastMcap ?? s) / s;
    return { features: (d.features ?? {}) as Features, win: end < 0.2, at: Number(d.spottedAt), peak, end, addr: String(d.address) };
  });
  const oos = outOfSampleScores(rows).map((o) => ({ score: o.score, r: o.row as Extra }));
  console.log(`calls: ${rows.length}; scored out-of-sample (later blocks only): ${oos.length}`);
  if (oos.length < 200) return;
  oos.sort((a, b) => a.score - b.score);
  const q = (i: number) => oos.slice(Math.floor((oos.length * i) / 4), Math.floor((oos.length * (i + 1)) / 4));
  const names = ["safest quarter", "2nd", "3rd", "RISKIEST quarter"];
  console.log("\nquarter            calls  collapsed  reached 2x  5x   10x   median end");
  for (let i = 0; i < 4; i++) {
    const g = q(i).map((x) => x.r), n = g.length || 1;
    console.log(`${names[i].padEnd(17)} ${String(g.length).padStart(5)}   ${pct(g.filter((x) => x.win).length / n).padStart(6)}   ${pct(g.filter((x) => x.peak >= 1.3).length / n).padStart(6)}     ${pct(g.filter((x) => x.peak >= 2).length / n).padStart(6)}   ${pct(g.filter((x) => x.peak >= 5).length / n).padStart(4)} ${pct(g.filter((x) => x.peak >= 10).length / n).padStart(4)}   ${median(g.map((x) => x.end)).toFixed(2)}x`);
  }
  // the top-decile of risk: how many moonshots would the warning have blocked, and how many collapses it caught
  const top = oos.slice(Math.floor(oos.length * 0.75)).map((x) => x.r);
  const rest = oos.slice(0, Math.floor(oos.length * 0.75)).map((x) => x.r);
  const moon5 = oos.map((x) => x.r).filter((x) => x.peak >= 5);
  const blockedMoons = top.filter((x) => x.peak >= 5).length;
  console.log(`\nBlocking the riskiest quarter would have:`);
  console.log(`  avoided ${top.filter((x) => x.win).length} collapses (${pct(top.filter((x) => x.win).length / (oos.filter((x) => x.r.win).length || 1))} of all collapses)`);
  console.log(`  and also blocked ${blockedMoons} of the ${moon5.length} calls that reached 5x (${pct(blockedMoons / (moon5.length || 1))}), ${top.filter((x) => x.peak >= 2).length} that reached 2x`);
  console.log(`  what is left: ${rest.length} calls, ${pct(rest.filter((x) => x.peak >= 2).length / (rest.length || 1))} reach 2x (vs ${pct(oos.filter((x) => x.r.peak >= 2).length / oos.length)} for all)`);
  const big = top.filter((x) => x.peak >= 10);
  console.log(`  riskiest-quarter calls that went 10x+: ${big.length}${big.length ? ` (peak ${big.map((x) => x.peak.toFixed(0) + "x").join(", ")}; they ended at ${big.map((x) => x.end.toFixed(2) + "x").join(", ")} of the called price)` : ""}`);
  const QUICK: Policy = { sl: 10, tp: 30, trail: 10, trailAfter: 0, tp1: 0, tp1Sell: 0, hold: 0 };
  const paths = new Map<string, number[][]>();
  for (const f of ["scripts/.pilot/candles.jsonl", "scripts/.pilot/candles-helius.jsonl"].filter((x) => existsSync(x))) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) { const x = JSON.parse(l) as { addr: string; s: number[][]; cover?: number }; if (x.s.length >= 8 && (x.cover ?? 1440) >= 360) paths.set(x.addr, x.s); }
  console.log("\nQuick exit (TP +30%, trail 10%, stop 10%, costs included) per risk quarter, calls with a real price path:");
  for (let i = 0; i < 4; i++) {
    const rs = q(i).map((x) => paths.get(x.r.addr)).filter((p): p is number[][] => !!p).map((p) => simulate(p, QUICK, COSTS));
    const m = rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : 0;
    console.log(`  ${names[i].padEnd(17)} n=${String(rs.length).padStart(3)}  per trade ${(m * 100 >= 0 ? "+" : "")}${(m * 100).toFixed(1)}%  win ${pct(rs.filter((v) => v > 0).length / (rs.length || 1))}`);
  }
}
void main();

