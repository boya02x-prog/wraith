/**
 * Checks the track record for impossible price readings (they poison win rates and the model).
 *   npx tsx scripts/data-quality.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 4 * 3_600_000 } }, { projection: { symbol: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, spottedAt: 1, chain: 1 } }).toArray();
  await c.close();
  const n = docs.length;
  const pk = docs.map((d) => d.peakMcap / d.spottedMcap);
  const bucket = (lo: number, hi: number) => pk.filter((x) => x >= lo && x < hi).length;
  console.log("calls", n);
  console.log("peak ratio buckets  <1:", bucket(0, 1), " 1-2:", bucket(1, 2), " 2-5:", bucket(2, 5), " 5-20:", bucket(5, 20), " 20-100:", bucket(20, 100), " 100-1000:", bucket(100, 1000), " >=1000:", bucket(1000, 1e18));
  const bad = docs.filter((d) => d.peakMcap / d.spottedMcap >= 100).slice(0, 10);
  for (const d of bad) console.log(`  ${String(d.symbol).padEnd(10)} spotted $${Math.round(d.spottedMcap)}  peak $${Math.round(d.peakMcap)} (${(d.peakMcap / d.spottedMcap).toFixed(0)}x)  last $${Math.round(d.lastMcap)}  ${new Date(d.spottedAt).toISOString().slice(0, 10)}`);
  const dead = docs.filter((d) => d.lastMcap < d.spottedMcap * 0.05).length;
  console.log("ended below 5% of the call price:", dead, `(${((dead / n) * 100).toFixed(0)}%)`);
  const wins2 = docs.filter((d) => Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= 2).length;
  const wins2clean = docs.filter((d) => { const r = Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap; return r >= 2 && r < 100; }).length;
  console.log("2x wins as counted:", wins2, "| counting only readings under 100x:", wins2clean);
}
main().catch((e) => { console.error(e); process.exit(1); });
