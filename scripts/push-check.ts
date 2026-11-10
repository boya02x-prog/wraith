/**
 * Shows how many phones are registered for Android push and which alert types they want (no tokens are printed).
 *   npx tsx scripts/push-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const col = c.db(process.env.MONGODB_DB || "wraith").collection("push_subs");
  const total = await col.countDocuments({});
  const fcm = await col.countDocuments({ fcm: true });
  console.log(`push_subs: ${total} total, ${fcm} Android (Firebase), ${total - fcm} browser`);
  const rows = await col.find({ fcm: true }, { projection: { userId: 1, prefs: 1, createdAt: 1, updatedAt: 1, at: 1 } }).sort({ _id: -1 }).limit(6).toArray();
  for (const d of rows) console.log("  android device:", JSON.stringify({ user: String(d.userId).slice(-6), prefs: d.prefs, at: d.updatedAt ?? d.createdAt ?? d.at ?? null }));
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
