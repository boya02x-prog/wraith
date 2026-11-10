/**
 * Flags impossible rows in the call record (no starting price, or a 100x+ peak that came from a bad price reading) as badData.
 * Flagged rows are left in place but ignored by public lists, win alerts and model training. Reversible.
 *   npx tsx scripts/repair-calls.ts            (shows what it would flag)
 *   npx tsx scripts/repair-calls.ts --apply    (flags them)
 *   npx tsx scripts/repair-calls.ts --undo     (removes every flag)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const col = c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls");
  if (process.argv.includes("--undo")) {
    const r = await col.updateMany({ badData: true }, { $unset: { badData: "" } });
    console.log("flags removed:", r.modifiedCount);
    await c.close();
    return;
  }
  const filter = { engine: 2, badData: { $ne: true }, $or: [{ spottedMcap: { $not: { $gt: 0 } } }, { $expr: { $gte: [{ $divide: ["$peakMcap", { $max: ["$spottedMcap", 1] }] }, 100] } }] };
  const rows = await col.find(filter, { projection: { symbol: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  console.log("rows that look impossible:", rows.length);
  for (const d of rows.slice(0, 12)) console.log(`  ${String(d.symbol).padEnd(10)} spotted $${Math.round(d.spottedMcap ?? 0)}  peak $${Math.round(d.peakMcap ?? 0)}  last $${Math.round(d.lastMcap ?? 0)}`);
  if (process.argv.includes("--apply")) {
    const r = await col.updateMany(filter, { $set: { badData: true } });
    console.log("flagged:", r.modifiedCount);
  } else console.log("(dry run: add --apply to flag them)");
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
