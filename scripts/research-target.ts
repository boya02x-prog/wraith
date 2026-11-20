/**
 * The win model asks "will it reach 2x?" (about 20% of calls). Your default exit sells at +30%, so the question that matters for trading is smaller:
 * "will it pop +30% / +50% at all?". Does the model see THAT better?   npx tsx scripts/research-target.ts   (read-only)
 * Same honest walk-forward test as the live retrain (train on everything before each of 4 later blocks, score the block), run for several targets,
 * with and without the market-regime columns that were hurting. A score near 0.50 is a coin flip; 0.55+ with all blocks above 0.50 starts to be real.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

(async () => {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const all = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 4 * 3_600_000 } },
      { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, shadow: 1 } })
    .sort({ spottedAt: -1 }).limit(6000).toArray();
  await cli.close();
  const { withContext } = await import("../lib/signalRegime");
  const { rawVector, fitTrees, scoreTrees, auc, FEATURE_NAMES, TREE_DEFAULTS } = await import("../lib/signalModel");
  const docs = withContext(all as unknown as Parameters<typeof withContext>[0]).docs;
  const rise = (d: (typeof docs)[number]) => Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap;
  const regime = new Set(["regWin12", "regWin36", "regCol12", "regN12", "rkVol", "rkLiq", "rkH1", "rkM5", "rkTraders", "rkBuy", "rkMcap", "rkHolders", "rkAge", "thWin", "thN"]);
  const usable = docs.filter((r) => r.features && Object.keys(r.features).length).sort((a, b) => (a.spottedAt as number) - (b.spottedAt as number));
  console.log(`rows: ${usable.length}\n`);

  function run(label: string, target: number, drop: Set<string>) {
    const keep = FEATURE_NAMES.map((nm) => !drop.has(nm));
    const raw = usable.map((r) => rawVector(r.features).map((v, j) => (keep[j] ? v : (FEATURE_NAMES[j].startsWith("has:") ? 0 : NaN))));
    const y: number[] = usable.map((r) => (rise(r) >= target ? 1 : 0));
    const n = usable.length, start = Math.floor(n * 0.45), folds = 4, block = Math.floor((n - start) / folds);
    const aucs: number[] = [], tops: number[] = [], bots: number[] = [];
    for (let k = 0; k < folds; k++) {
      const a = start + k * block, b = k === folds - 1 ? n : a + block;
      const { f0, trees } = fitTrees(raw.slice(0, a), y.slice(0, a), TREE_DEFAULTS);
      const sc: number[] = [], yt: number[] = [];
      for (let i = a; i < b; i++) { sc.push(scoreTrees(f0, trees, raw[i])); yt.push(y[i]); }
      aucs.push(auc(sc, yt));
      const order = sc.map((s, i) => [s, yt[i]] as const).sort((p, q) => q[0] - p[0]);
      const qn = Math.max(8, Math.floor(order.length / 4));
      tops.push(order.slice(0, qn).reduce((p, v) => p + v[1], 0) / qn); bots.push(order.slice(-qn).reduce((p, v) => p + v[1], 0) / qn);
    }
    const mean = (xs: number[]) => xs.reduce((p, v) => p + v, 0) / xs.length;
    console.log(`${label.padEnd(34)} base ${(y.reduce((p, v) => p + v, 0) / n * 100).toFixed(0).padStart(3)}%  folds ${aucs.map((v) => v.toFixed(3)).join(" ")}  mean ${mean(aucs).toFixed(3)}   best quarter ${(mean(tops) * 100).toFixed(0)}% vs worst quarter ${(mean(bots) * 100).toFixed(0)}%`);
  }
  for (const [name, t] of [["reach +30%  (your quick exit)", 1.3], ["reach +50%", 1.5], ["reach 2x (what it did)", 2]] as [string, number][]) {
    run(`${name}, all columns`, t, new Set());
    run(`${name}, no regime columns`, t, regime);
  }
})();
