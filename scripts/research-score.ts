/** How do calls perform by the scanner's own score? (is the HOT line in the right place?)   npx tsx scripts/research-score.ts */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 24 * 3_600_000 } }, { projection: { score: 1, tier: 1, shadow: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await c.close();
  const rows = docs.filter((d) => typeof d.score === "number").map((d) => ({ s: d.score as number, shadow: d.shadow === true, peak: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap, last: d.lastMcap / d.spottedMcap }));
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const ret = (k: { peak: number; last: number }) => (k.peak >= 2 ? 1 : k.last <= 0.5 ? -0.5 : k.last - 1);
  console.log(`calls with a score: ${rows.length} (public ${rows.filter((r) => !r.shadow).length}, shadow ${rows.filter((r) => r.shadow).length})\n`);
  console.log("score bucket        n     2x     collapsed   avg return (take 2x, stop at -50%)");
  for (const [lo, hi] of [[0, 45], [45, 55], [55, 62], [62, 68], [68, 72], [72, 78], [78, 85], [85, 101]]) {
    const g = rows.filter((r) => r.s >= lo && r.s < hi);
    if (g.length < 15) continue;
    console.log(`${`${lo}-${hi}`.padEnd(14)}${String(g.length).padStart(6)} ${(mean(g.map((r) => (r.peak >= 2 ? 1 : 0))) * 100).toFixed(1).padStart(7)}% ${(mean(g.map((r) => (r.last <= 0.2 ? 1 : 0))) * 100).toFixed(0).padStart(9)}% ${(mean(g.map(ret)) * 100).toFixed(1).padStart(14)}%`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
