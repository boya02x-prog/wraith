/**
 * Seeds the scanner's wallet scoreboard (wallet_stats: n, wins, dumps) from the backtest collection, so the existing
 * "proven wallet" / "repeat dumper" intel has real history instead of ~120 calls' worth.
 *   npx tsx scripts/seed-wallet-stats.ts           dry run: prints what WOULD be written, writes nothing
 *   npx tsx scripts/seed-wallet-stats.ts --apply   writes to the production database (run it yourself)
 * Same definitions as lib/walletLearn.ts: win = token reached 2x from the call price, dump = ended below 50%.
 * Snipers (bought in the first 3 seconds) are left out: they buy everything and would look "proven" for no reason.
 * Tokens whose buyers the live system already counted (calls marked learned) are skipped, so nothing is counted twice.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
// same thresholds as lib/signalIntel.ts (isSmart / isDumper); copied here because importing that file loads the database client before .env is read
const isSmart = (s: { n: number; wins: number }) => s.n >= 3 && s.wins / s.n >= 0.3;
const isDumper = (s: { n: number; dumps: number }) => s.n >= 4 && s.dumps / s.n >= 0.75;

const APPLY = process.argv.includes("--apply");
const FILE = "scripts/.pilot/collect-big.json";
interface Row { mint: string; win: boolean; ratioLast: number; t0: number; wallets: { w: string; buyOffsetS: number }[] }

async function main() {
  const rows = (JSON.parse(readFileSync(FILE, "utf8")) as Row[]).filter((r) => r.t0 && r.wallets?.length);
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const db = c.db(process.env.MONGODB_DB || "wraith");
  const learned = new Set((await db.collection("signal_calls").find({ address: { $in: rows.map((r) => r.mint) }, learned: true }, { projection: { address: 1 } }).toArray()).map((d) => d.address as string));
  const agg = new Map<string, { n: number; wins: number; dumps: number }>();
  let used = 0;
  for (const r of rows) {
    if (learned.has(r.mint)) continue;
    used++;
    for (const w of r.wallets) {
      if (w.buyOffsetS <= 3) continue;
      const a = agg.get(w.w) ?? { n: 0, wins: 0, dumps: 0 };
      a.n++; if (r.win) a.wins++; if (r.ratioLast <= 0.5) a.dumps++;
      agg.set(w.w, a);
    }
  }
  const all = [...agg.values()];
  console.log(`${used} tokens used (${learned.size} skipped as already learned); ${agg.size} wallets`);
  console.log(`  would be "proven" (3+ calls, 30%+ wins): ${all.filter(isSmart).length}`);
  console.log(`  would be "repeat dumpers" (4+ calls, 75%+ dumps): ${all.filter(isDumper).length}`);
  console.log(`  seen in 3+ tokens: ${all.filter((a) => a.n >= 3).length}`);
  const existing = await db.collection("wallet_stats").countDocuments({});
  console.log(`  wallet_stats today: ${existing} wallets`);
  if (!APPLY) { console.log("\nDry run. Nothing written. Add --apply to write."); await c.close(); return; }
  // only wallets worth remembering: seen 2+ times, to keep the collection small
  const keep = [...agg.entries()].filter(([, a]) => a.n >= 2);
  const now = Date.now();
  for (let i = 0; i < keep.length; i += 1000) {
    await db.collection("wallet_stats").bulkWrite(keep.slice(i, i + 1000).map(([w, a]) => ({
      updateOne: { filter: { _id: w as never }, update: { $inc: { n: a.n, wins: a.wins, dumps: a.dumps }, $set: { lastSeen: now, seeded: true }, $setOnInsert: { firstSeen: now } }, upsert: true },
    })), { ordered: false });
  }
  console.log(`wrote ${keep.length} wallets`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
