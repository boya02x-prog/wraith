/** Read-only: can the existing tree model predict collapse (ends <20% of call price) out of sample?  npx tsx scripts/research-rugguard.ts */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { auc, outOfSampleScores, type TrainRow } from "../lib/signalModel";
interface C { spottedAt: number; spottedMcap: number; lastMcap: number; peakMcap: number; badData?: boolean; features?: Record<string, number | null> }
async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const all = await c.db(process.env.MONGODB_DB || "wraith").collection<C>("signal_calls").find({ badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true } }).sort({ spottedAt: 1 }).toArray();
  const old = all.filter((x) => Date.now() - x.spottedAt > 24 * 3_600_000);
  const rows: TrainRow[] = old.map((x) => ({ features: x.features!, win: x.lastMcap / x.spottedMcap <= 0.2, at: x.spottedAt }));
  const oos = outOfSampleScores(rows);
  const a = auc(oos.map((o) => o.score), oos.map((o) => (o.row.win ? 1 : 0)));
  console.log(`rows ${rows.length}, scored out-of-sample ${oos.length}, collapse AUC ${a.toFixed(3)} (0.5 = coin flip)`);
  const s = [...oos].sort((x, y) => x.score - y.score);
  const q = 5;
  for (let i = 0; i < q; i++) {
    const g = s.slice(Math.floor((i * s.length) / q), Math.floor(((i + 1) * s.length) / q));
    console.log(`  risk quintile ${i + 1} (${i === q - 1 ? "highest risk" : i === 0 ? "lowest risk" : "mid"}): collapse ${(g.filter((t) => t.row.win).length / g.length * 100).toFixed(0)}%  n=${g.length}`);
  }
  // what would a cut of the riskiest 20% / 30% have saved
  for (const cut of [0.2, 0.3]) {
    const keep = s.slice(0, Math.floor(s.length * (1 - cut)));
    const col = keep.filter((t) => t.row.win).length / keep.length;
    const wins = keep.filter((t) => { const x = old.find((o) => o.spottedAt === t.row.at); return x ? x.peakMcap / x.spottedMcap >= 2 : false; }).length;
    const allWins = old.filter((x) => x.peakMcap / x.spottedMcap >= 2).length;
    console.log(`  dropping riskiest ${cut * 100}%: collapse rate ${(col * 100).toFixed(0)}% (was ${(rows.filter((r) => r.win).length / rows.length * 100).toFixed(0)}%)`);
    void wins; void allWins;
  }
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
