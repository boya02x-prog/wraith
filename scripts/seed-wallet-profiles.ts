/**
 * Writes each wallet's behaviour type onto its wallet_stats record (kind, holdPct, flipPct, medOffsetS, avgSol).
 * Safe to run more than once: it only SETS fields, it never adds to the win / dump counts.
 *   npx tsx scripts/analyze-wallets.ts                (makes scripts/.pilot/wallet-profiles.json)
 *   npx tsx scripts/seed-wallet-profiles.ts           dry run
 *   npx tsx scripts/seed-wallet-profiles.ts --apply   writes to the production database (run it yourself)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

interface P { w: string; kind: string; holdPct: number; flipPct: number; medOffsetS: number; avgSol: number }
const APPLY = process.argv.includes("--apply");

async function main() {
  const profiles = JSON.parse(readFileSync("scripts/.pilot/wallet-profiles.json", "utf8")) as P[];
  console.log(`${profiles.length} profiles`);
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const col = c.db(process.env.MONGODB_DB || "wraith").collection("wallet_stats");
  const have = await col.countDocuments({ _id: { $in: profiles.slice(0, 2000).map((p) => p.w as never) } });
  console.log(`first 2000 profiles: ${have} already have a wallet_stats record (profiles are only written for existing records)`);
  if (!APPLY) { console.log("Dry run. Nothing written. Add --apply to write."); await c.close(); return; }
  let modified = 0;
  for (let i = 0; i < profiles.length; i += 1000) {
    const r = await col.bulkWrite(profiles.slice(i, i + 1000).map((p) => ({
      updateOne: { filter: { _id: p.w as never }, update: { $set: { kind: p.kind, holdPct: p.holdPct, flipPct: p.flipPct, medOffsetS: p.medOffsetS, avgSol: p.avgSol } } },
    })), { ordered: false });
    modified += r.modifiedCount;
  }
  console.log(`updated ${modified} wallets`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
