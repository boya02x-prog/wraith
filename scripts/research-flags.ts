/**
 * Which red flags, known AT CALL TIME, really predicted a failed call?   npx tsx scripts/research-flags.ts
 * For each recorded indicator it shows, above and below a few cut-offs, how many calls there were and how they ended
 * (collapsed to 20% or less of the call price / reached 2x). Read-only. Uses the numbers saved when each call was made,
 * so there is no hindsight in them (unlike asking an outside service about a token today).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

const CUTS: [string, number[], "above" | "below"][] = [
  ["bundled", [3, 5, 8, 12], "above"], ["top3Share", [0.4, 0.5, 0.65, 0.8], "above"], ["devDead", [1, 3, 5, 8, 15], "above"],
  ["devRecent7d", [2, 4, 8, 15], "above"], ["devCreated", [3, 8, 20, 50], "above"], ["topHolders", [25, 35, 50, 70], "above"], ["devPct", [3, 8, 15, 30], "above"],
  ["organic", [15, 30, 50], "below"], ["holders", [60, 150, 400], "below"], ["liqRatio", [0.04, 0.08, 0.15], "below"], ["traders1h", [20, 50, 100], "below"],
  ["ageMin", [10, 30, 120], "below"], ["dumpers", [1, 3, 5, 10], "above"], ["smart", [1, 2], "above"], ["netSol", [-5, -1, 2], "below"],
];

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true }, spottedAt: { $lt: Date.now() - 24 * 3_600_000 } }, { projection: { features: 1, shadow: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, score: 1 } }).toArray();
  await c.close();
  const rows = docs.map((d) => ({ f: (d.features ?? {}) as Record<string, number | null>, pub: !d.shadow, col: d.lastMcap / d.spottedMcap <= 0.2, win: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= 2 }));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%`.padStart(4) : " n/a");
  for (const [title, set] of [["ALL CALLS", rows], ["PUBLIC CALLS (what users see)", rows.filter((r) => r.pub)]] as const) {
    console.log(`\n== ${title}: ${set.length} calls, ${pct(set.filter((r) => r.col).length, set.length)} collapsed, ${pct(set.filter((r) => r.win).length, set.length)} reached 2x ==`);
    for (const [key, cuts, dir] of CUTS) {
      const known = set.filter((r) => typeof r.f[key] === "number");
      if (known.length < 40) { console.log(`${key.padEnd(12)} (only ${known.length} calls have it)`); continue; }
      const cells = cuts.map((t) => {
        const g = known.filter((r) => (dir === "above" ? (r.f[key] as number) >= t : (r.f[key] as number) < t));
        return g.length >= 8 ? `${dir === "above" ? ">=" : "<"}${t}: ${String(g.length).padStart(4)} calls, ${pct(g.filter((r) => r.col).length, g.length)} collapsed, ${pct(g.filter((r) => r.win).length, g.length)} 2x` : `${dir === "above" ? ">=" : "<"}${t}: n<8`;
      });
      console.log(`${key.padEnd(12)} (${String(known.length).padStart(4)} known) | ${cells.join(" | ")}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
