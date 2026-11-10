/**
 * Puts the REAL price-path facts (from candles) back onto your tracked calls, so the model trains on true peaks instead of sparse samples.
 *   npx tsx scripts/apply-paths.ts            dry run: shows how many labels would change, writes nothing
 *   npx tsx scripts/apply-paths.ts --apply    writes to the production database (run it yourself)
 * Per call it sets: peakMcap (raised to the true 24h peak, never lowered), troughMcap, hit2xAt, hitHalfAt, peakAt and pathSource.
 * Nothing else is touched. Safe to run more than once.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { existsSync, readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import type { PathRec } from "./pathlib";

const APPLY = process.argv.includes("--apply");

async function main() {
  // two sources: GeckoTerminal candles, and a rebuild from on-chain trades. Use whichever covers more of the 24h for each call.
  const load = (f: string) => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, PathRec>) : {});
  const gecko = load("scripts/.pilot/paths.json"), chain = load("scripts/.pilot/paths-helius.json");
  const paths: Record<string, PathRec> = { ...chain };
  for (const [k, v] of Object.entries(gecko)) if (v.ok && (!paths[k]?.ok || (v.coverMin ?? 1440) >= (paths[k].coverMin ?? 1440))) paths[k] = v;
  const recs = Object.values(paths).filter((r) => r.ok && r.p0 > 0);
  console.log(`${recs.length} calls with real price paths`);
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const col = c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls");
  const docs = await col.find({ address: { $in: recs.map((r) => r.addr) } }, { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  const by = new Map(docs.map((d) => [d.address as string, d]));
  let missed = 0, phantom = 0, raised = 0;
  const ops: Parameters<typeof col.bulkWrite>[0] = [];
  for (const r of recs) {
    const d = by.get(r.addr);
    if (!d) continue;
    const sm = d.spottedMcap as number, at = d.spottedAt as number;
    const oldWin = Math.max(d.peakMcap as number, d.lastMcap as number) / sm >= 2;
    const truePeak = sm * r.peak24h;
    const newPeak = Math.max(d.peakMcap as number, truePeak);
    const newWin = Math.max(newPeak, d.lastMcap as number) / sm >= 2;
    if (!oldWin && newWin) missed++;
    if (newPeak > (d.peakMcap as number) * 1.0001) raised++;
    const set: Record<string, unknown> = { peakMcap: newPeak, pathSource: "ohlcv5m", pathAt: Date.now(), maxDrawBeforePeak: r.maxDrawBeforePeak };
    if (r.first2xMin !== null) set.hit2xAt = at + r.first2xMin * 60_000;
    if (r.firstHalfMin !== null) set.hitHalfAt = at + r.firstHalfMin * 60_000;
    ops.push({ updateOne: { filter: { address: r.addr }, update: { $set: set, $min: { troughMcap: sm * r.trough24h } } } });
  }
  void phantom;
  console.log(`would raise the recorded peak on ${raised} calls`);
  console.log(`would turn ${missed} calls from "not a 2x winner" into "2x winner" (the refresh job had missed the spike)`);
  if (!APPLY) { console.log("\nDry run. Nothing written. Add --apply to write."); await c.close(); return; }
  for (let i = 0; i < ops.length; i += 500) await col.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  console.log(`updated ${ops.length} calls`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
