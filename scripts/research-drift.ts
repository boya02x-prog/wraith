/**
 * Why did the win model's score on unseen calls fall (0.578 on Nov 8 -> 0.485 on Nov 19)?   npx tsx scripts/research-drift.ts   (read-only)
 * Rebuilds the exact training set the live retrain uses, then re-runs the same walk-forward test several ways: with and without the
 * wallet-intel columns, without the market-regime columns, Solana only, public calls only, and only calls that had a full day to play out.
 * Whichever variant restores the score points at the cause. Also prints the daily mix of the data (how many calls, win rate, chain mix,
 * how many have wallet intel), because a changing mix is the usual reason a model that "got weaker" did not really forget anything.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

(async () => {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const all = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 4 * 3_600_000 } },
      { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, chain: 1, shadow: 1 } })
    .sort({ spottedAt: -1 }).limit(6000).toArray();
  await cli.close();
  const { withContext } = await import("../lib/signalRegime");
  const { rawVector, fitTrees, scoreTrees, auc, FEATURE_NAMES, TREE_DEFAULTS } = await import("../lib/signalModel");
  const ctx = withContext(all as unknown as Parameters<typeof withContext>[0]);
  type D = (typeof ctx.docs)[number] & { chain?: string; shadow?: boolean };
  const docs = ctx.docs as D[];
  const win = (d: D) => Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= 2;
  const day = (t: number) => new Date(t).toISOString().slice(5, 10);

  // 1) the mix of the data, day by day
  const byDay = new Map<string, D[]>();
  for (const d of docs) { const k = day(d.spottedAt as number); byDay.set(k, [...(byDay.get(k) ?? []), d]); }
  console.log(`training rows: ${docs.length}\n`);
  console.log("day     calls  win2x  nonSolana  public  withIntel  noFeatures");
  for (const [k, xs] of [...byDay].sort().slice(-14)) {
    const n = xs.length;
    console.log(`${k}  ${String(n).padStart(6)}  ${((xs.filter(win).length / n) * 100).toFixed(0).padStart(4)}%  ${String(xs.filter((d) => (d.chain ?? "solana") !== "solana").length).padStart(8)}  ${String(xs.filter((d) => !d.shadow).length).padStart(6)}  ${String(xs.filter((d) => typeof d.features.smart === "number" || typeof d.features.flowBuyers === "number").length).padStart(9)}  ${String(xs.filter((d) => !d.features || !Object.keys(d.features).length).length).padStart(9)}`);
  }

  // 2) the same walk-forward test the live retrain does (train on everything before each of the last 4 blocks, score the block)
  const names = FEATURE_NAMES;
  const intelCols = new Set(["flowBuyers", "flowAccel", "top3Share", "bundled", "netSol", "devCreated", "devGraduated", "devDead", "devRecent7d", "smart", "dumpers", "intelAdj",
    "has:flowBuyers", "has:smart", "has:devCreated", "wProven", "wHolders", "wDump", "wSniper", "wEarly", "wBig", "wHold"]);
  const regimeCols = new Set(["regWin12", "regWin36", "regCol12", "regN12", "rkVol", "rkLiq", "rkH1", "rkM5", "rkTraders", "rkBuy", "rkMcap", "rkHolders", "rkAge", "thWin", "thN"]);
  function run(label: string, rows: D[], drop: Set<string> = new Set()) {
    const usable = rows.filter((r) => r.features && Object.keys(r.features).length).sort((a, b) => (a.spottedAt as number) - (b.spottedAt as number));
    if (usable.length < 300) { console.log(`${label.padEnd(40)} too few rows (${usable.length})`); return; }
    const keepIdx = names.map((nm) => !drop.has(nm));
    const raw = usable.map((r) => rawVector(r.features).map((v, j) => (keepIdx[j] ? v : (names[j].startsWith("has:") ? 0 : NaN))));
    const y = usable.map((r) => (win(r) ? 1 : 0));
    const n = usable.length, start = Math.floor(n * 0.45), folds = 4, block = Math.floor((n - start) / folds);
    const aucs: number[] = [];
    for (let k = 0; k < folds; k++) {
      const a = start + k * block, b = k === folds - 1 ? n : a + block;
      const { f0, trees } = fitTrees(raw.slice(0, a), y.slice(0, a), TREE_DEFAULTS);
      const sc: number[] = [], yt: number[] = [];
      for (let i = a; i < b; i++) { sc.push(scoreTrees(f0, trees, raw[i])); yt.push(y[i]); }
      aucs.push(auc(sc, yt));
    }
    const mean = aucs.reduce((p, v) => p + v, 0) / aucs.length;
    console.log(`${label.padEnd(40)} rows=${String(n).padStart(4)}  folds ${aucs.map((v) => v.toFixed(3)).join(" ")}  mean ${mean.toFixed(3)}`);
  }
  console.log("\nwalk-forward score on unseen blocks (the number on your screen is the 'mean'):");
  run("A. exactly what the live retrain does", docs);
  run("B. without wallet-intel columns", docs, intelCols);
  run("C. without market-regime columns", docs, regimeCols);
  run("D. without BOTH", docs, new Set([...intelCols, ...regimeCols]));
  run("E. Solana calls only", docs.filter((d) => (d.chain ?? "solana") === "solana"));
  run("F. public calls only", docs.filter((d) => !d.shadow));
  run("G. only calls older than 24h", docs.filter((d) => (d.spottedAt as number) < Date.now() - 24 * 3_600_000));
  run("H. older than 24h, no regime columns", docs.filter((d) => (d.spottedAt as number) < Date.now() - 24 * 3_600_000), regimeCols);
  run("I. older than 24h, Solana, no regime/intel", docs.filter((d) => (d.spottedAt as number) < Date.now() - 24 * 3_600_000 && (d.chain ?? "solana") === "solana"), new Set([...intelCols, ...regimeCols]));
})();
