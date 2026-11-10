/**
 * Read-only. Do we have enough data to test "proven wallets" as a filter, and how do rugs look?
 *   npx tsx scripts/research-wallets.ts
 * Walk-forward: a call is judged using wallet records built ONLY from calls that matured before it was made (no peeking).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

const H = 3_600_000;
interface C { address: string; spottedAt: number; spottedMcap: number; peakMcap: number; lastMcap: number; lastCheck?: number; tier: string; shadow?: boolean; buyers?: string[]; badData?: boolean; features?: Record<string, number | null> }
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "n/a");

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || "wraith");
  const calls = (await db.collection<C>("signal_calls").find({ badData: { $ne: true }, spottedMcap: { $gt: 0 } }).sort({ spottedAt: 1 }).toArray());
  const stats = await db.collection("wallet_stats").countDocuments({});
  const stats3 = await db.collection("wallet_stats").countDocuments({ n: { $gte: 3 } });
  const now = Date.now();
  const matured = calls.filter((x) => now - x.spottedAt > 4 * H);
  const withBuyers = matured.filter((x) => (x.buyers?.length ?? 0) >= 3);
  console.log(`calls: ${calls.length} total, ${matured.length} older than 4h, ${withBuyers.length} of those have 3+ stored early buyers`);
  console.log(`wallet_stats: ${stats} wallets, ${stats3} seen in 3+ calls`);
  const span = calls.length ? (now - calls[0].spottedAt) / 86_400_000 : 0;
  console.log(`history spans ${span.toFixed(1)} days`);

  const win = (x: C) => x.peakMcap / x.spottedMcap >= 2;
  const rug = (x: C) => x.lastMcap / x.spottedMcap <= 0.2;
  console.log(`\nbase rates over matured calls: reached 2x ${pct(matured.filter(win).length, matured.length)}, ended below 20% of call price ${pct(matured.filter(rug).length, matured.length)}`);

  // walk-forward wallet record
  const rec = new Map<string, { n: number; w: number; d: number }>();
  const rows: { calls: number; proven: number; dumpers: number; win: boolean; rug: boolean }[] = [];
  const queue = [...withBuyers];
  const pending: { at: number; c: C }[] = [];
  for (const x of queue) {
    // credit wallets only from calls that were already old enough when THIS call was made
    while (pending.length && pending[0].at + 4 * H <= x.spottedAt) {
      const done = pending.shift()!.c;
      for (const w of done.buyers ?? []) {
        const r = rec.get(w) ?? { n: 0, w: 0, d: 0 };
        r.n++; if (win(done)) r.w++; if (done.lastMcap / done.spottedMcap <= 0.5) r.d++;
        rec.set(w, r);
      }
    }
    let proven = 0, dumpers = 0;
    for (const w of x.buyers ?? []) {
      const r = rec.get(w);
      if (!r || r.n < 3) continue;
      if (r.w >= 2 && r.w / r.n >= 0.4) proven++;
      if (r.d >= 2 && r.d / r.n >= 0.5) dumpers++;
    }
    rows.push({ calls: 1, proven, dumpers, win: win(x), rug: rug(x) });
    pending.push({ at: x.spottedAt, c: x }); pending.sort((a, b) => a.at - b.at);
  }
  const grp = (name: string, f: (r: typeof rows[number]) => boolean) => {
    const g = rows.filter(f);
    console.log(`  ${name.padEnd(28)} n=${String(g.length).padStart(4)}  2x ${pct(g.filter((r) => r.win).length, g.length).padStart(4)}  rug ${pct(g.filter((r) => r.rug).length, g.length).padStart(4)}`);
  };
  console.log(`\nwalk-forward test (${rows.length} calls scored with earlier data only):`);
  grp("no proven wallets", (r) => r.proven === 0);
  grp("1+ proven wallet", (r) => r.proven >= 1);
  grp("2+ proven wallets", (r) => r.proven >= 2);
  grp("1+ repeat dumper", (r) => r.dumpers >= 1);
  grp("no repeat dumpers", (r) => r.dumpers === 0);

  // rugs: how long after the call, and are they still on the board?
  const recent = calls.filter((x) => !x.shadow && now - x.spottedAt < 7 * 24 * H);
  const rugged = recent.filter(rug);
  console.log(`\nlast 7 days, non-shadow calls: ${recent.length}; ended below 20% of call price: ${rugged.length} (${pct(rugged.length, recent.length)})`);
  const stale = rugged.filter((x) => (x.lastCheck ?? 0) < now - 6 * H).length;
  console.log(`  of those, not re-checked in 6h+ (could still look alive on the board): ${stale}`);
  const hot = rugged.filter((x) => x.tier === "HOT").length;
  console.log(`  HOT tier among rugged: ${hot}`);
  const feats = ["liquidity", "top10Pct", "holders", "devHoldPct", "bundled", "ageMin", "liqMcapRatio"];
  const have = recent.filter((x) => x.features);
  if (have.length) {
    const keys = [...new Set(have.flatMap((x) => Object.keys(x.features ?? {})))];
    console.log(`  features stored per call: ${keys.slice(0, 40).join(", ")}`);
    void feats;
  }
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
