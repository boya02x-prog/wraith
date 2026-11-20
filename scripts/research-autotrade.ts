/**
 * Would an AUTO-TRADER that buys Wraith's calls have made money?   npx tsx scripts/research-autotrade.ts   (read-only)
 * Replays the real 5-minute price paths of Wraith's public calls (scripts/.pilot/candles*.jsonl) under three trading styles and a few
 * "only the best calls" filters, with realistic costs (1.5% to get in, 3% to get out, 6% when a stop is hit: thin tokens slip). Prints, per
 * style: trades, win rate, average and middle result per trade, and the 95% range of the average. An average whose range sits clearly above
 * zero would be an edge; a range that includes zero is a coin flip with fees. Limits: only calls whose pool still existed have a path, so
 * dead-on-arrival tokens are under-represented and the numbers are somewhat optimistic; inside a candle the stop is assumed to hit first.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { existsSync, readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { simulate, stats, type Policy } from "./pathlib";

interface Series { addr: string; at: number; engine: number | null; shadow: boolean; s: number[][]; cover?: number }
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

const STYLES: { name: string; p: Policy }[] = [
  { name: "scalp   (TP +30%, stop -10%, trail 10%, max 2h)", p: { sl: 10, tp: 30, trail: 10, trailAfter: 10, tp1: 0, tp1Sell: 0, hold: 120 } },
  { name: "day     (TP +100%, stop -25%, trail 25%, max 24h)", p: { sl: 25, tp: 100, trail: 25, trailAfter: 50, tp1: 0, tp1Sell: 0, hold: 1440 } },
  { name: "long    (no TP, stop -35%, trail 35% after +100%)", p: { sl: 35, tp: 0, trail: 35, trailAfter: 100, tp1: 0, tp1Sell: 0, hold: 0 } },
  { name: "hold    (buy and just sell at the end of the data)", p: { sl: 0, tp: 0, trail: 0, trailAfter: 0, tp1: 0, tp1Sell: 0, hold: 0 } },
];

(async () => {
  const files = ["scripts/.pilot/candles.jsonl", "scripts/.pilot/candles-helius.jsonl"].filter((f) => existsSync(f));
  const byAddr = new Map<string, Series>();
  for (const f of files) for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const x = JSON.parse(l) as Series;
    const cur = byAddr.get(x.addr);
    if (!cur || (x.cover ?? 1440) > (cur.cover ?? 1440)) byAddr.set(x.addr, x);
  }
  const paths = [...byAddr.values()].filter((x) => x.s.length >= 6 && (x.cover ?? 1440) >= 180 && x.engine === 2 && !x.shadow).sort((a, b) => a.at - b.at);

  // what Wraith knew at each call (score and wallet intel), to test "only the best of the best"
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, address: { $in: paths.map((p) => p.addr) } }, { projection: { address: 1, score: 1, features: 1 } }).toArray();
  await cli.close();
  const info = new Map(docs.map((d) => [String(d.address), d as unknown as { score?: number; features?: Record<string, number | null> }]));

  console.log(`public calls with a real price path: ${paths.length}  (${new Date(paths[0].at).toISOString().slice(0, 10)} to ${new Date(paths[paths.length - 1].at).toISOString().slice(0, 10)})\n`);
  const groups: { name: string; keep: (x: Series) => boolean }[] = [
    { name: "ALL public calls", keep: () => true },
    { name: "best of best: score 75+", keep: (x) => (info.get(x.addr)?.score ?? 0) >= 75 },
    { name: "proven wallet already buying (smart>=1)", keep: (x) => (info.get(x.addr)?.features?.smart ?? 0) >= 1 },
    { name: "5+ fresh buyers and no known dumper", keep: (x) => (info.get(x.addr)?.features?.flowBuyers ?? 0) >= 5 && (info.get(x.addr)?.features?.dumpers ?? 1) === 0 },
  ];
  for (const g of groups) {
    const sel = paths.filter(g.keep);
    if (sel.length < 15) { console.log(`${g.name}: only ${sel.length} calls with a path, too few to say anything\n`); continue; }
    console.log(`${g.name}  (n = ${sel.length})`);
    for (const st of STYLES) {
      const r = sel.map((x) => simulate(x.s, st.p));
      const s = stats(r);
      const mean = r.reduce((a, v) => a + v, 0) / r.length;
      const sd = Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / (r.length - 1 || 1));
      const se = 1.96 * sd / Math.sqrt(r.length);
      console.log(`  ${st.name.padEnd(54)} win ${pct(s.win, 0).padStart(4)}  average ${pct(mean).padStart(7)} (${pct(mean - se, 0)} to ${pct(mean + se, 0)})  middle trade ${pct(s.median).padStart(7)}`);
    }
    console.log("");
  }
  console.log("Read it like this: an 'average' whose range (in brackets) stays above 0% on every style would be a real edge. A range that includes 0% is a coin flip minus fees.");
})();
