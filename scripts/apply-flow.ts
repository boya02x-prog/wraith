/**
 * Puts the REAL buyer-flow numbers (rebuilt from on-chain trades by scripts/backfill-flow.ts) onto past calls that never recorded
 * them, so the model can finally learn from buyer behaviour instead of from ~4% of calls.
 *   npx tsx scripts/apply-flow.ts            dry run: shows how many calls would get them, writes nothing
 *   npx tsx scripts/apply-flow.ts --apply    writes to the production database (run it yourself)
 * Only calls whose flow numbers are missing are touched, and only these fields: features.flowBuyers, flowAccel, top3Share, bundled,
 * netSol (and a flowSource marker). Every number uses trades from BEFORE the call was made. Safe to run more than once.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { existsSync, readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const APPLY = process.argv.includes("--apply");
const FILE = "scripts/.pilot/flow.json";

async function main() {
  if (!existsSync(FILE)) { console.log("No flow file yet. Run scripts/backfill-flow.ts first."); return; }
  const j = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, { ok: boolean; f?: Record<string, number> }>;
  const recs = Object.entries(j).filter(([, r]) => r.ok && r.f);
  console.log(`${recs.length} calls with rebuilt buyer flow`);
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const col = c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls");
  const have = new Set((await col.find({ address: { $in: recs.map(([a]) => a) }, "features.flowBuyers": { $ne: null } }, { projection: { address: 1 } }).toArray()).map((d) => d.address as string));
  const todo = recs.filter(([a]) => !have.has(a));
  console.log(`${have.size} of them already have flow numbers; ${todo.length} would be filled in`);
  if (!APPLY) { console.log("\nDry run. Nothing written. Add --apply to write."); await c.close(); return; }
  let done = 0;
  for (let i = 0; i < todo.length; i += 500) {
    const ops = todo.slice(i, i + 500).map(([address, r]) => ({
      updateOne: {
        filter: { address, "features.flowBuyers": null },
        update: { $set: { "features.flowBuyers": r.f!.flowBuyers, "features.flowAccel": r.f!.flowAccel, "features.top3Share": r.f!.top3Share, "features.bundled": r.f!.bundled, "features.netSol": r.f!.netSol, flowSource: "chain-backfill" } },
      },
    }));
    const res = await col.bulkWrite(ops, { ordered: false });
    done += res.modifiedCount;
  }
  console.log(`updated ${done} calls`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
