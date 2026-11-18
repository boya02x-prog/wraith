/**
 * Do the calls the collapse model rates RISKY also hold the biggest winners?   npx tsx scripts/research-tail.ts   (read-only)
 * Scores every public call (24h+ old) with today's models and groups them by collapse risk: how many reached 2x / 5x / 10x / 20x and how many
 * collapsed. NOTE: the models were trained on these same calls (in-sample), so the numbers lean a little optimistic; the SHAPE (do big
 * winners sit in the risky groups?) is what this shows. Peaks are the corrected ones.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
const pct = (a: number, n: number) => (n ? `${((a / n) * 100).toFixed(0)}%` : "–").padStart(4);
(async () => {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 }, features: { $exists: true } }).toArray();
  await cli.close();
  const { annotateFeatures } = await import("../lib/signalLearning");
  const out = await annotateFeatures(docs.map((d) => d.features));
  const buckets: [string, number, number][] = [["< 30%", 0, 30], ["30-39%", 30, 40], ["40-49%", 40, 50], ["50-59%", 50, 60], ["60%+", 60, 101]];
  console.log(`scored calls: ${docs.length}   (rugRisk present on ${out.filter((o) => o.rugRisk !== undefined).length})\n`);
  console.log("collapse risk    calls   2x    5x   10x   20x  collapsed");
  for (const [name, lo, hi] of buckets) {
    const rows = docs.filter((_, i) => { const r = out[i]?.rugRisk; return r !== undefined && r >= lo && r < hi; });
    const x = (d: (typeof docs)[number]) => Math.max(Number(d.peakMcap), Number(d.lastMcap)) / Number(d.spottedMcap);
    const c = (m: number) => rows.filter((d) => x(d) >= m).length;
    const coll = rows.filter((d) => Number(d.lastMcap) / Number(d.spottedMcap) < 0.2).length;
    console.log(`${name.padEnd(14)} ${String(rows.length).padStart(6)}  ${pct(c(2), rows.length)}  ${pct(c(5), rows.length)}  ${pct(c(10), rows.length)}  ${pct(c(20), rows.length)}   ${pct(coll, rows.length)}`);
  }
})();

// second table: the same outcomes by the call's SCORE at the time (the number the Scanner shows)
(async () => {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } }).toArray();
  await cli.close();
  console.log("\nscore at the call  calls   2x    5x   10x   20x  collapsed");
  for (const [name, lo, hi] of [["under 50", 0, 50], ["50-59", 50, 60], ["60-69", 60, 70], ["70+", 70, 101]] as [string, number, number][]) {
    const rows = docs.filter((d) => Number(d.score) >= lo && Number(d.score) < hi);
    const x = (d: (typeof docs)[number]) => Math.max(Number(d.peakMcap), Number(d.lastMcap)) / Number(d.spottedMcap);
    const c = (m: number) => rows.filter((d) => x(d) >= m).length;
    const coll = rows.filter((d) => Number(d.lastMcap) / Number(d.spottedMcap) < 0.2).length;
    console.log(`${name.padEnd(16)} ${String(rows.length).padStart(6)}  ${pct(c(2), rows.length)}  ${pct(c(5), rows.length)}  ${pct(c(10), rows.length)}  ${pct(c(20), rows.length)}   ${pct(coll, rows.length)}`);
  }
})();
