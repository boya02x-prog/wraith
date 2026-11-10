/**
 * Now that buyer flow is really available, do the scanner's hand-made flow adjustments (lib/signalIntel.ts scoreIntel) help or hurt?
 *   npx tsx scripts/research-flow-adj.ts
 * Uses the buyer-flow numbers rebuilt from real chain trades (scripts/backfill-flow.ts) and replays ONLY the flow part of scoreIntel
 * on past calls. Read-only. The question matters because until now these rules almost never fired (4% coverage); they are about to.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { auc } from "../lib/signalModel";

interface F { flowBuyers: number; flowAccel: number; top3Share: number; bundled: number; netSol: number }
/** the flow rules of scoreIntel, copied as they are in lib/signalIntel.ts (buys is approximated from the parsed swap count) */
function flowAdj(f: F, buys: number): number {
  let adj = 0;
  if (f.top3Share > 0.5 && buys >= 10) adj -= 6;
  if (f.flowBuyers < 12 && buys > 40) adj -= 8;
  if (f.bundled >= 5) adj -= 8;
  if (f.flowAccel >= 2 && f.flowBuyers >= 20) adj += 6;
  if (f.netSol > 3) adj += 3; else if (f.netSol < -3) adj -= 4;
  if (f.flowBuyers >= 60) adj += 3;
  return adj;
}

async function main() {
  const flow: Record<string, { ok: boolean; n: number; f?: F }> = existsSync("scripts/.pilot/flow.json") ? JSON.parse(readFileSync("scripts/.pilot/flow.json", "utf8")) : {};
  const load = (f: string) => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, { ok: boolean; peak24h: number; coverMin?: number }>) : {});
  const g = load("scripts/.pilot/paths.json"), h = load("scripts/.pilot/paths-helius.json");
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 24 * 3_600_000 } }, { projection: { address: 1, score: 1, shadow: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await c.close();
  const rows = docs.flatMap((d) => {
    const fl = flow[d.address as string];
    if (!fl?.ok || !fl.f || typeof d.score !== "number") return [];
    const p = [g[d.address as string], h[d.address as string]].filter((x) => x?.ok).sort((a, b) => (b.coverMin ?? 1440) - (a.coverMin ?? 1440))[0];
    const peak = Math.max(d.peakMcap / d.spottedMcap, d.lastMcap / d.spottedMcap, p?.peak24h ?? 0);
    return [{ pub: !d.shadow, score: d.score as number, adj: flowAdj(fl.f, Math.round(fl.n * 0.65)), win: peak >= 2, col: d.lastMcap / d.spottedMcap <= 0.2, hasPath: !!p }];
  });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%`.padStart(4) : " n/a");
  for (const [title, set] of [["ALL CALLS WITH FLOW + LABELS", rows], ["PUBLIC CALLS ONLY", rows.filter((r) => r.pub)], ["PUBLIC CALLS WITH A REAL PATH", rows.filter((r) => r.pub && r.hasPath)]] as const) {
    if (set.length < 40) { console.log(`\n${title}: only ${set.length} calls`); continue; }
    console.log(`\n== ${title}: ${set.length} calls, ${pct(set.filter((r) => r.win).length, set.length)} reached 2x, ${pct(set.filter((r) => r.col).length, set.length)} collapsed ==`);
    for (const [name, test] of [["adjustment negative", (r: { adj: number }) => r.adj < 0], ["adjustment zero", (r: { adj: number }) => r.adj === 0], ["adjustment positive", (r: { adj: number }) => r.adj > 0]] as const) {
      const gset = set.filter(test);
      console.log(`  ${name.padEnd(22)} ${String(gset.length).padStart(5)} calls | reached 2x ${pct(gset.filter((r) => r.win).length, gset.length)} | collapsed ${pct(gset.filter((r) => r.col).length, gset.length)}`);
    }
    const y = set.map((r) => (r.win ? 1 : 0)), yc = set.map((r) => (r.col ? 0 : 1)); // "not collapsed" = good
    console.log(`  score alone      : AUC for 2x ${auc(set.map((r) => r.score), y).toFixed(3)} | for not-collapsing ${auc(set.map((r) => r.score), yc).toFixed(3)}`);
    console.log(`  score + flow adj : AUC for 2x ${auc(set.map((r) => r.score + r.adj), y).toFixed(3)} | for not-collapsing ${auc(set.map((r) => r.score + r.adj), yc).toFixed(3)}`);
    console.log(`  flow adj alone   : AUC for 2x ${auc(set.map((r) => r.adj), y).toFixed(3)} | for not-collapsing ${auc(set.map((r) => r.adj), yc).toFixed(3)}  (0.50 = no information)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
