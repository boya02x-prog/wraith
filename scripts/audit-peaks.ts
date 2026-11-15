/**
 * Which recorded "big wins" are fake?   npx tsx scripts/audit-peaks.ts            (read-only, lists them)
 *                                      npx tsx scripts/audit-peaks.ts --apply    (fixes them: the user runs this, it writes production)
 * Takes every call whose recorded peak is 10x+ the called market cap and compares it with what the real candles (Jupiter chart data)
 * show. When the candles peaked at less than 35% of the claimed rise the recorded peak is a bad price tick (wrong pool / thin pool).
 * --apply sets peakMcap to the real peak (called mcap x real rise) and clears hit2xAt when even the real rise never reached 2x.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

async function main() {
  const { chartRise } = await import("../lib/signalCalls"); // after dotenv, so the database settings exist when it loads
  const apply = process.argv.includes("--apply");
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const col = cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls");
  const docs = await col.find({ spottedMcap: { $gt: 0 }, $expr: { $gte: ["$peakMcap", { $multiply: ["$spottedMcap", 10] }] } },
    { projection: { address: 1, symbol: 1, shadow: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, hit2xAt: 1 } }).sort({ spottedAt: -1 }).limit(400).toArray();
  console.log(`calls recorded at 10x or more: ${docs.length}`);
  let bad = 0, ok = 0, unknown = 0;
  for (const d of docs) {
    const claimed = d.peakMcap / d.spottedMcap;
    const rise = await chartRise(String(d.address), Number(d.spottedAt));
    await new Promise((r) => setTimeout(r, 250));
    if (rise === null) { unknown++; continue; }
    if (rise < claimed * 0.35) {
      bad++;
      console.log(`FAKE ${String(d.symbol).padEnd(10)} ${d.shadow ? "shadow" : "PUBLIC"}  recorded ${claimed.toFixed(1)}x   candles show ${rise.toFixed(2)}x   ${new Date(Number(d.spottedAt)).toISOString().slice(0, 16)}`);
      if (apply) {
        const realPeak = Math.max(d.spottedMcap, d.spottedMcap * rise);
        await col.updateOne({ _id: d._id }, { $set: { peakMcap: realPeak, ...(rise < 2 ? {} : {}) }, ...(rise < 2 ? { $unset: { hit2xAt: "" } } : {}) });
      }
    } else ok++;
  }
  console.log(`\nreal: ${ok}   fake: ${bad}   could not check (no chart): ${unknown}   ${apply ? "FIXED in the database" : "(read-only: nothing changed)"}`);
  await cli.close();
}
void main();
