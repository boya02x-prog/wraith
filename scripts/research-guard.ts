/**
 * Does the rug guard help the money, or does it push out the winners too?   npx tsx scripts/research-guard.ts
 * Walk-forward (train on the past, score the next block, 24h gap). For each call we get an out-of-sample "collapse risk" score, then
 * compare risk quartiles on: share that reached 2x, share that collapsed, and the average return under two simple exit rules
 *   TAKE-2X : sell at 2x if it got there, otherwise hold to the last price
 *   TAKE-2X+STOP : same, but a call that ended below 50% counts as -50% (a stop-loss would have cut it there)
 * Uses the recorded peak/last prices, which are sparse samples (see relabel-paths.ts), so read the comparison, not the absolute levels.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { fitTrees, rawVector, scoreTrees, TREE_DEFAULTS, type Features } from "../lib/signalModel";

const H = 3_600_000;
interface Call { at: number; f: Features; peak: number; last: number; score: number | null; tier: string; shadow: boolean }

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true }, spottedAt: { $lt: Date.now() - 24 * H } },
      { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, score: 1, tier: 1, shadow: 1 } }).sort({ spottedAt: 1 }).toArray();
  await c.close();
  const calls: Call[] = docs.map((d) => ({ at: d.spottedAt as number, f: (d.features ?? {}) as Features, peak: Math.max(d.peakMcap as number, d.lastMcap as number) / (d.spottedMcap as number), last: (d.lastMcap as number) / (d.spottedMcap as number), score: typeof d.score === "number" ? d.score : null, tier: String(d.tier), shadow: d.shadow === true }));
  const n = calls.length;
  const X = calls.map((k) => rawVector(k.f));
  const yCol = calls.map((k) => (k.last <= 0.2 ? 1 : 0));
  const start = Math.floor(n * 0.4), K = 6, block = Math.floor((n - start) / K);
  const risk = new Array<number | null>(n).fill(null);
  for (let k = 0; k < K; k++) {
    const a = start + k * block, b = k === K - 1 ? n : a + block;
    const cut = calls[a].at - 24 * H;
    let m = 0; while (m < a && calls[m].at <= cut) m++;
    const { f0, trees } = fitTrees(X.slice(0, m), yCol.slice(0, m), TREE_DEFAULTS);
    for (let i = a; i < b; i++) risk[i] = scoreTrees(f0, trees, X[i], TREE_DEFAULTS.lr);
  }
  const idx = calls.map((_, i) => i).filter((i) => risk[i] !== null);
  const ret1 = (k: Call) => (k.peak >= 2 ? 1 : k.last - 1);
  const ret2 = (k: Call) => (k.peak >= 2 ? 1 : k.last <= 0.5 ? -0.5 : k.last - 1);
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const show = (label: string, ids: number[]) => {
    const g = ids.map((i) => calls[i]);
    console.log(`${label.padEnd(30)} n=${String(g.length).padStart(4)}  2x ${(mean(g.map((k) => (k.peak >= 2 ? 1 : 0))) * 100).toFixed(1).padStart(5)}%   collapsed ${(mean(g.map((k) => (k.last <= 0.2 ? 1 : 0))) * 100).toFixed(0).padStart(3)}%   return TAKE-2X ${(mean(g.map(ret1)) * 100).toFixed(1).padStart(6)}%   +STOP ${(mean(g.map(ret2)) * 100).toFixed(1).padStart(6)}%`);
  };
  console.log(`${idx.length} calls scored out-of-sample\n`);
  show("ALL calls", idx);
  const order = [...idx].sort((a, b) => (risk[a] as number) - (risk[b] as number));
  const q = 5;
  console.log("\nby collapse-risk quintile (1 = safest, 5 = riskiest):");
  for (let i = 0; i < q; i++) show(`  risk quintile ${i + 1}`, order.slice(Math.floor((i * order.length) / q), Math.floor(((i + 1) * order.length) / q)));
  console.log("\nwhat the rug guard does to the PUBLIC (HOT) calls:");
  const hot = idx.filter((i) => calls[i].tier === "HOT" && !calls[i].shadow);
  show("  HOT calls, all", hot);
  const cutRisk = order.length ? (risk[order[Math.floor(order.length * 0.7)]] as number) : 0; // riskiest 30%
  show("  HOT, keep (not riskiest 30%)", hot.filter((i) => (risk[i] as number) < cutRisk));
  show("  HOT, removed by the guard", hot.filter((i) => (risk[i] as number) >= cutRisk));
  console.log("\nThe guard avoids collapses, but check the 2x column and the returns: if the riskiest group has a HIGHER 2x rate or return,");
  console.log("then removing it throws away winners and the guard should be softer or tied to the exit rules.");
}
main().catch((e) => { console.error(e); process.exit(1); });
