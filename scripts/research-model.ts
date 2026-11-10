/**
 * Offline model research on your real call history. Compares model families with rolling time-ordered folds
 * (train on the past, test on the next block), which is far steadier than one 25% holdout.
 *   npx tsx scripts/research-model.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { auc, rawVector, FEATURE_NAMES, type Features } from "../lib/signalModel";

type Row = { f: Features; y: number; at: number; ratio: number };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

// ── logistic regression (the current model) ─────────────────────────────────────────────────
function standardise(raw: number[][], idx: number[]) {
  const d = raw[0].length, mean = new Array(d).fill(0), std = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    const v = idx.map((i) => raw[i][j]).filter(Number.isFinite);
    if (!v.length) continue;
    const m = v.reduce((a, x) => a + x, 0) / v.length;
    mean[j] = m; std[j] = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) || 1;
  }
  return { mean, std };
}
const apply = (raw: number[][], mean: number[], std: number[]) => raw.map((r) => r.map((v, j) => (Number.isFinite(v) ? (v - mean[j]) / std[j] : 0)));
function fitLogit(X: number[][], y: number[], lambda: number, iters = 400, lr = 0.15) {
  const n = X.length, d = X[0].length, w = new Array(d).fill(0);
  const p0 = y.reduce((a, v) => a + v, 0) / n; let b = Math.log(p0 / (1 - p0));
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b; for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const e = sigmoid(z) - y[i]; gb += e; for (let j = 0; j < d; j++) gw[j] += e * X[i][j];
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}
function logitModel(lambda: number, keep?: number[]) {
  return (trRaw: number[][], trY: number[], teRaw: number[][]) => {
    const cols = keep ?? trRaw[0].map((_, j) => j);
    const sel = (m: number[][]) => m.map((r) => cols.map((j) => r[j]));
    const a = sel(trRaw), b = sel(teRaw);
    const s = standardise(a, a.map((_, i) => i));
    const { w, b: bias } = fitLogit(apply(a, s.mean, s.std), trY, lambda);
    return apply(b, s.mean, s.std).map((r) => bias + r.reduce((acc, v, j) => acc + v * w[j], 0));
  };
}

// ── gradient boosted small trees ───────────────────────────────────────────────────────────
type Node = { j?: number; t?: number; l?: Node; r?: Node; v?: number };
function buildTree(X: number[][], g: number[], h: number[], idx: number[], depth: number, maxDepth: number, minLeaf: number, lam: number): Node {
  const G = idx.reduce((a, i) => a + g[i], 0), H = idx.reduce((a, i) => a + h[i], 0);
  const leaf = { v: -G / (H + lam) };
  if (depth >= maxDepth || idx.length < minLeaf * 2) return leaf;
  let best = { gain: 1e-6, j: -1, t: 0 };
  const d = X[0].length;
  for (let j = 0; j < d; j++) {
    const vals = idx.map((i) => X[i][j]);
    const sorted = [...vals].filter(Number.isFinite).sort((a, b) => a - b);
    if (sorted.length < minLeaf * 2) continue;
    const cands = new Set<number>();
    for (let q = 1; q < 12; q++) cands.add(sorted[Math.floor((sorted.length * q) / 12)]);
    for (const t of cands) {
      let gl = 0, hl = 0, nl = 0;
      for (const i of idx) { const v = X[i][j]; if (!Number.isFinite(v) || v <= t) { gl += g[i]; hl += h[i]; nl++; } }
      const nr = idx.length - nl; if (nl < minLeaf || nr < minLeaf) continue;
      const gr = G - gl, hr = H - hl;
      const gain = gl * gl / (hl + lam) + gr * gr / (hr + lam) - G * G / (H + lam);
      if (gain > best.gain) best = { gain, j, t };
    }
  }
  if (best.j < 0) return leaf;
  const L: number[] = [], R: number[] = [];
  for (const i of idx) { const v = X[i][best.j]; (!Number.isFinite(v) || v <= best.t ? L : R).push(i); }
  return { j: best.j, t: best.t, l: buildTree(X, g, h, L, depth + 1, maxDepth, minLeaf, lam), r: buildTree(X, g, h, R, depth + 1, maxDepth, minLeaf, lam) };
}
const walk = (n: Node, x: number[]): number => (n.v !== undefined ? n.v : walk(!Number.isFinite(x[n.j!]) || x[n.j!] <= n.t! ? n.l! : n.r!, x));
function gbm(rounds: number, depth: number, lr: number, minLeaf = 25, lam = 8, halfLife = 0) {
  return (trRaw: number[][], trY: number[], teRaw: number[][]) => {
    const n = trRaw.length, p0 = trY.reduce((a, v) => a + v, 0) / n;
    const f0 = Math.log(p0 / (1 - p0)); const F = new Array(n).fill(f0); const trees: Node[] = [];
    for (let r = 0; r < rounds; r++) {
      const g = new Array(n), h = new Array(n);
      for (let i = 0; i < n; i++) { const p = sigmoid(F[i]); const wgt = halfLife ? Math.pow(0.5, (n - 1 - i) / halfLife) : 1; g[i] = (p - trY[i]) * wgt; h[i] = Math.max(p * (1 - p), 1e-4) * wgt; }
      const sub = Array.from({ length: n }, (_, i) => i).filter((i) => (i * 2654435761 + r * 40503) % 100 < 70);
      const t = buildTree(trRaw, g, h, sub, 0, depth, minLeaf, lam);
      trees.push(t);
      for (let i = 0; i < n; i++) F[i] += lr * walk(t, trRaw[i]);
    }
    return teRaw.map((x) => f0 + trees.reduce((a, t) => a + lr * walk(t, x), 0));
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "wraith");
  const docs = await db.collection("signal_calls")
    .find({ engine: 2, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 4 * 3_600_000 } }, { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } })
    .sort({ spottedAt: 1 }).limit(20000).toArray();
  await client.close();
  const rows: Row[] = docs.filter((d) => d.features && Object.keys(d.features).length).map((d) => ({
    f: d.features as Features, at: d.spottedAt as number, ratio: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap, y: 0,
  }));
  console.log("calls with features:", rows.length, " span:", new Date(rows[0].at).toISOString().slice(0, 10), "to", new Date(rows[rows.length - 1].at).toISOString().slice(0, 10));
  const raw = rows.map((r) => rawVector(r.f));
  console.log("feature coverage (share of calls with a value):");
  console.log(FEATURE_NAMES.slice(0, 29).map((nme, j) => `${nme} ${(raw.filter((r) => Number.isFinite(r[j])).length / raw.length * 100).toFixed(0)}%`).join("  "));

  const models: Record<string, (a: number[][], b: number[], c: number[][]) => number[]> = {
    "gbm d3 x150 lr.04 (base)": gbm(150, 3, 0.04),
    "gbm d3 x150 recency hl=400": gbm(150, 3, 0.04, 25, 8, 400),
    "gbm d3 x150 recency hl=800": gbm(150, 3, 0.04, 25, 8, 800),
    "gbm d4 x150 lr.04": gbm(150, 4, 0.04, 25, 8),
    "gbm d3 x250 lr.03 minLeaf40": gbm(250, 3, 0.03, 40, 12),
    "gbm d3 x100 lr.05 minLeaf15": gbm(100, 3, 0.05, 15, 5),
  };

  for (const target of [2]) {
    const y = rows.map((r) => (r.ratio >= target ? 1 : 0));
    console.log(`\n=== target ${target}x  base rate ${(y.reduce<number>((a, v) => a + v, 0) / y.length * 100).toFixed(1)}% ===`);
    // rolling-origin: 5 test blocks, each trained on everything before it
    const n = rows.length, start = Math.floor(n * 0.4), block = Math.floor((n - start) / 5);
    for (const [name, run] of Object.entries(models)) {
      const aucs: number[] = [], lifts: number[] = [];
      for (let k = 0; k < 5; k++) {
        const a = start + k * block, b = k === 4 ? n : a + block;
        const tr = Array.from({ length: a }, (_, i) => i), te = Array.from({ length: b - a }, (_, i) => a + i);
        const scores = run(tr.map((i) => raw[i]), tr.map((i) => y[i]), te.map((i) => raw[i]));
        const yt = te.map((i) => y[i]);
        aucs.push(auc(scores, yt));
        const ord = scores.map((s, i) => [s, yt[i]] as const).sort((p, q) => q[0] - p[0]);
        const qn = Math.max(5, Math.floor(ord.length / 4));
        const rate = (arr: readonly (readonly [number, number])[]) => arr.reduce((acc, v) => acc + v[1], 0) / Math.max(1, arr.length);
        lifts.push(rate(ord.slice(0, qn)) / Math.max(1e-6, rate(ord.slice(-qn))));
      }
      const mean = aucs.reduce((a, v) => a + v, 0) / aucs.length;
      console.log(`${name.padEnd(30)} AUC folds ${aucs.map((v) => v.toFixed(3)).join(" ")}  mean ${mean.toFixed(3)}  top/bottom-quarter ${(lifts.reduce((a, v) => a + v, 0) / lifts.length).toFixed(2)}x`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
