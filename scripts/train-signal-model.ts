/**
 * Trains the signal model from your own track record and prints how well it does on calls it never saw.
 * Run: npx tsx scripts/train-signal-model.ts          (print only)
 *      npx tsx scripts/train-signal-model.ts --save   (also store it in MongoDB for the app to use)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { patternStats, trainModel, type TrainRow } from "../lib/signalModel";
import { withContext } from "../lib/signalRegime";

const TARGET = Number((process.argv.find((a) => a.startsWith("--target=")) ?? "--target=2").split("=")[1]) || 2;

async function main() {
  console.log(`target: reach ${TARGET}x from the call price`);
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "wraith");
  const now = Date.now();
  const docs = await db
    .collection("signal_calls")
    .find({ engine: 2, spottedMcap: { $gt: 0 }, spottedAt: { $lt: now - 4 * 3_600_000 } }, { projection: { address: 1, features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } })
    .limit(20000)
    .toArray();
  // --paths: also use the real price paths found so far (even ones not yet written to the database) to correct each call's peak, so you can
  // see what a retrain WOULD score after running apply-paths --apply. Read-only.
  if (process.argv.includes("--paths")) {
    const load = (f: string) => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, { ok: boolean; peak24h: number; coverMin?: number }>) : {});
    const g = load("scripts/.pilot/paths.json"), h = load("scripts/.pilot/paths-helius.json");
    let fixed = 0;
    for (const d of docs) {
      const p = [g[d.address as string], h[d.address as string]].filter((x) => x?.ok).sort((a, b) => (b.coverMin ?? 1440) - (a.coverMin ?? 1440))[0];
      if (p && d.spottedMcap * p.peak24h > d.peakMcap) { d.peakMcap = d.spottedMcap * p.peak24h; fixed++; }
    }
    console.log(`--paths: raised the peak on ${fixed} calls from real price paths`);
  }
  // each call also gets the market context it was made in (regime + ranks): the same thing the live scanner computes
  const ctx = withContext(docs as unknown as Parameters<typeof withContext>[0]);
  const rows: TrainRow[] = ctx.docs.map((d) => ({
    features: d.features,
    win: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= TARGET,
    at: d.spottedAt,
  }));
  const model = trainModel(rows);
  if (!model) { console.log("not enough calls yet:", rows.length); await client.close(); return; }
  const { holdout: h } = model;
  console.log(`calls ${model.n}  wins ${model.wins}  base ${(model.base * 100).toFixed(1)}%`);
  console.log(`held-out (newest ${h.n} calls): AUC ${h.auc}  top-quarter 2x rate ${(h.topQuartileRate * 100).toFixed(1)}%  bottom-quarter ${(h.bottomQuartileRate * 100).toFixed(1)}%  base ${(h.baseRate * 100).toFixed(1)}%`);
  console.log(`model ${model.active ? "ACTIVE (beats chance on unseen calls)" : "INACTIVE (not better than chance yet, scores are left alone)"}`);
  console.log("strongest effects:", model.top.map((t) => `${t.name} ${t.w > 0 ? "+" : ""}${t.w}`).join(", "));
  console.log("\npattern                       calls   2x rate   lift");
  for (const p of patternStats(rows)) console.log(`${p.label.padEnd(28)} ${String(p.calls).padStart(6)}   ${p.rate === null ? "  n/a " : (p.rate * 100).toFixed(1).padStart(5) + "%"}   ${p.lift ?? "-"}`);
  // Rug model: "will this call end below 20% of its call price?" Judged only on calls a full day old.
  const rugRows: TrainRow[] = ctx.docs
    .filter((d) => d.spottedAt < now - 24 * 3_600_000)
    .map((d) => ({ features: d.features, win: d.lastMcap / d.spottedMcap <= 0.2, at: d.spottedAt }));
  const rug = trainModel(rugRows);
  if (rug) {
    const r = rug.holdout;
    console.log(`\nRUG MODEL (collapse = ends below 20% of call price): calls ${rug.n}, collapsed ${(rug.base * 100).toFixed(0)}%`);
    console.log(`held-out: AUC ${r.auc}  riskiest quarter collapsed ${(r.topQuartileRate * 100).toFixed(0)}%  safest quarter ${(r.bottomQuartileRate * 100).toFixed(0)}%  ${rug.active ? "ACTIVE" : "INACTIVE"}`);
  } else console.log("\nrug model: not enough calls yet");
  if (process.argv.includes("--save")) {
    await db.collection("signal_model").updateOne({ _id: "current" as never }, { $set: { model, rug, ctx: ctx.prior, patterns: patternStats(rows), at: new Date() } }, { upsert: true });
    console.log("\nsaved to signal_model/current");
  }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
