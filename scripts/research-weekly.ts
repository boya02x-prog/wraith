/** Is the 2x hit rate really improving?   npx tsx scripts/research-weekly.ts   (read-only)
 * Public calls (engine 2, not shadow) grouped by the week they were spotted: how many reached 2x, 5x, and how many ended collapsed.
 * Only calls 24h+ old, so every call had a day to play out. Ranges are 95%. A trend only counts if the ranges stop overlapping. */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
const wilson = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } }, { projection: { spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await cli.close();
  const weeks = new Map<string, { n: number; h2: number; h5: number; coll: number }>();
  for (const d of docs) {
    const dt = new Date(Number(d.spottedAt)); const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const k = monday.toISOString().slice(0, 10); const w = weeks.get(k) ?? { n: 0, h2: 0, h5: 0, coll: 0 }; weeks.set(k, w);
    const s = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap), Number(d.lastMcap)) / s, end = Number(d.lastMcap) / s;
    w.n++; if (peak >= 2) w.h2++; if (peak >= 5) w.h5++; if (end < 0.2) w.coll++;
  }
  console.log("week of     calls   2x (95% range)     5x    collapsed");
  for (const [k, w] of [...weeks].sort()) { const [lo, hi] = wilson(w.h2, w.n); console.log(`${k}  ${String(w.n).padStart(5)}   ${(100 * w.h2 / w.n).toFixed(0).padStart(3)}% (${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%)   ${(100 * w.h5 / w.n).toFixed(0).padStart(3)}%   ${(100 * w.coll / w.n).toFixed(0).padStart(3)}%`); }
}
void main();
