/** Why did the bell show something the phone never rang for?   npx tsx scripts/diag-push.ts   (read-only, prints no tokens)
 * Lists the phones the server would push to (kind, last successful send, last error, how stale the cursor is) and the HOT calls of the last
 * 24 hours with how each one looks to the bell (peak-based) versus the server (current-price-based). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

const iso = (t?: number | null) => (t ? new Date(t).toISOString().replace("T", " ").slice(0, 19) : "-");
const ladder = [2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
const mile = (x: number) => [...ladder].reverse().find((m) => x >= m) ?? 0;

async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!);
  await cli.connect();
  const db = cli.db(process.env.MONGODB_DB || "wraith");
  const now = Date.now();

  const subs = await db.collection("push_subs").find({}, { projection: { p256dh: 0, auth: 0, saved: 0, base: 0 } }).toArray();
  console.log(`push devices: ${subs.length} (phone app ${subs.filter((s) => s.fcm).length}, browser ${subs.filter((s) => !s.fcm).length})`);
  for (const s of subs.sort((a, b) => (b.lastSentAt ?? b.createdAt ?? 0) - (a.lastSentAt ?? a.createdAt ?? 0)).slice(0, 12)) {
    console.log(
      `  ${s.fcm ? "app    " : "browser"} user …${String(s.userId).slice(-6)}  created ${iso(s.createdAt)}  lastSent ${iso(s.lastSentAt)}  cursor ${Math.round((now - s.cursor) / 60000)} min old  lastError ${s.lastError ? `${s.lastError.code} @ ${iso(s.lastError.at)}` : "-"}  prefs ${JSON.stringify(s.prefs)}`,
    );
  }

  const calls = await db.collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, tier: "HOT", spottedAt: { $gt: now - 24 * 3600e3 } }, { projection: { symbol: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, score: 1, badData: 1 } })
    .sort({ spottedAt: -1 }).toArray();
  console.log(`\nHOT calls in the last 24h: ${calls.length}`);
  for (const c of calls.slice(0, 25)) {
    const xp = c.spottedMcap > 0 ? Math.max(c.peakMcap ?? 0, c.lastMcap ?? 0) / c.spottedMcap : 0;
    const xl = c.spottedMcap > 0 ? (c.lastMcap ?? 0) / c.spottedMcap : 0;
    const bellMile = mile(xp), pushMile = c.badData || xl >= 100 ? 0 : mile(xl);
    console.log(`  ${iso(c.spottedAt)}  $${String(c.symbol).padEnd(10)} score ${Math.round(c.score)}  peak ${xp.toFixed(2)}x  now ${xl.toFixed(2)}x  bell 🏆${bellMile || "-"}  push 🏆${pushMile || "-"}${bellMile !== pushMile ? "   <-- bell shows a win the phone never got" : ""}${c.badData ? "  (badData)" : ""}`);
  }
  await cli.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
