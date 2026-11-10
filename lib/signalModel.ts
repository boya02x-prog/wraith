// lib/signalModel.ts  (pure math + pattern library, no network; server only in practice)
// Wraith learns from its own track record. Every tracked call stores ~30 indicators at call time (featuresOf) and later
// an outcome (did it reach 2x?). This file turns that history into:
//   1. a logistic-regression model: P(reaches 2x) from the indicators, validated on NEWER calls than it trained on
//   2. a pattern library: named setups (rules over the indicators) with their real historical hit rate
// The model is only allowed to influence scores when it beats chance on the held-out calls.

export type Features = Record<string, number | null | undefined>;

/** Indicators the model reads, in a fixed order. Heavy-tailed ones are log-scaled. */
const NUMERIC: { key: string; log?: boolean }[] = [
  { key: "h1" }, { key: "m5" }, { key: "h6" }, { key: "h24" },
  { key: "volRatio", log: true }, { key: "buyShare" },
  { key: "liq", log: true }, { key: "liqRatio" }, { key: "mcap", log: true },
  { key: "ageMin", log: true }, { key: "curve" }, { key: "grad" },
  { key: "holders", log: true }, { key: "organic" }, { key: "topHolders" }, { key: "devPct" }, { key: "traders1h", log: true },
  { key: "flowBuyers", log: true }, { key: "flowAccel" }, { key: "top3Share" }, { key: "bundled" }, { key: "netSol" },
  { key: "devCreated", log: true }, { key: "devGraduated" }, { key: "devDead" }, { key: "devRecent7d" },
  { key: "smart" }, { key: "dumpers" }, { key: "intelAdj" },
];
/** "was this indicator available at all" flags: availability itself carries information (e.g. Solana + vetted) */
const HAS = ["holders", "organic", "flowBuyers", "smart", "devCreated", "buyShare"];

/**
 * Launch / early-buyer features from the first 30 minutes of a token's trades (see scripts/research-augmented.ts).
 * They are appended AFTER everything above, so a model saved before they existed keeps reading the same positions and still works.
 * Missing values are fine: most live calls will not have them yet.
 */
const EXTRA: { key: string; log?: boolean }[] = [
  { key: "wProven" }, { key: "wHolders" }, { key: "wDump" }, { key: "wSniper" }, { key: "wEarly", log: true }, { key: "wBig" }, { key: "wHold" },
  // market regime (how the last day of calls turned out) and where this call ranks among the last day's calls: see lib/signalRegime.ts
  { key: "regWin12" }, { key: "regWin36" }, { key: "regCol12" }, { key: "regN12", log: true },
  { key: "rkVol" }, { key: "rkLiq" }, { key: "rkH1" }, { key: "rkM5" }, { key: "rkTraders" }, { key: "rkBuy" }, { key: "rkMcap" }, { key: "rkHolders" }, { key: "rkAge" },
  { key: "thWin" }, { key: "thN", log: true },
];

export const FEATURE_NAMES = [...NUMERIC.map((n) => n.key), ...HAS.map((k) => `has:${k}`), ...EXTRA.map((n) => n.key)];

const slog = (x: number) => Math.sign(x) * Math.log1p(Math.abs(x));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Raw (unstandardised) vector; missing numeric values become NaN and are filled with the mean later. */
export function rawVector(f: Features): number[] {
  const out: number[] = [];
  for (const n of NUMERIC) {
    const v = num(f[n.key]);
    out.push(v === null ? NaN : n.log ? slog(v) : v);
  }
  for (const k of HAS) out.push(num(f[k]) === null ? 0 : 1);
  for (const n of EXTRA) {
    const v = num(f[n.key]);
    out.push(v === null ? NaN : n.log ? slog(v) : v);
  }
  return out;
}

/** One small decision tree. Leaves carry a score; internal nodes split on one indicator (missing values go left). */
export interface Tree { j?: number; t?: number; l?: Tree; r?: Tree; v?: number }

export interface SignalModel {
  /** 1 = old logistic model (still readable), 2 = boosted decision trees */
  v: 1 | 2;
  names: string[];
  // v1 (logistic)
  mean?: number[];
  std?: number[];
  w?: number[];
  b?: number;
  // v2 (boosted trees)
  f0?: number;
  lr?: number;
  trees?: Tree[];
  base: number; // share of calls that reached 2x in the training data
  n: number; // training calls
  wins: number;
  trainedAt: number;
  /** walk-forward test: the model is trained on the past and scored on the NEXT block of calls, over several blocks */
  holdout: { n: number; auc: number; baseRate: number; topQuartileRate: number; bottomQuartileRate: number; folds?: number[] };
  /** the model may only move scores when it clearly beats chance on calls it never saw */
  active: boolean;
  /** strongest learned effects, for the UI: sign = whether higher values go with winners */
  top: { name: string; w: number }[];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Area under the ROC curve (probability a random winner is ranked above a random non-winner). */
export function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let rank = 1, sumPos = 0, pos = 0, neg = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (rank + (rank + (j - i) - 1)) / 2;
    for (let k = i; k < j; k++) if (idx[k][1] === 1) { sumPos += avg; pos++; } else neg++;
    rank += j - i;
    i = j;
  }
  return pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

// ── boosted small trees ───────────────────────────────────────────────────────────────────────
// Trees, unlike a straight-line (logistic) model, can learn "this indicator only matters when that one is high",
// and need no scaling. On this track record, 5 walk-forward blocks gave AUC ~0.60 against ~0.53 for the old model.
export interface TreeOpts { rounds: number; depth: number; lr: number; minLeaf: number; lambda: number; subsample: number }
/** The settings the live model uses. Research scripts pass other settings to compare them on calls the model never saw. */
export const TREE_DEFAULTS: TreeOpts = { rounds: 250, depth: 3, lr: 0.03, minLeaf: 40, lambda: 12, subsample: 0.7 };
const LR = TREE_DEFAULTS.lr;

function buildTree(X: number[][], g: number[], h: number[], idx: number[], depth: number, gains: number[], o: TreeOpts): Tree {
  const G = idx.reduce((a, i) => a + g[i], 0), H = idx.reduce((a, i) => a + h[i], 0);
  const leaf: Tree = { v: -G / (H + o.lambda) };
  if (depth >= o.depth || idx.length < o.minLeaf * 2) return leaf;
  let best = { gain: 1e-6, j: -1, t: 0 };
  const d = X[0].length;
  for (let j = 0; j < d; j++) {
    const sorted: number[] = [];
    for (const i of idx) { const v = X[i][j]; if (Number.isFinite(v)) sorted.push(v); }
    if (sorted.length < o.minLeaf * 2) continue;
    sorted.sort((a, b) => a - b);
    const cands = new Set<number>();
    for (let q = 1; q < 12; q++) cands.add(sorted[Math.floor((sorted.length * q) / 12)]);
    for (const t of cands) {
      let gl = 0, hl = 0, nl = 0;
      for (const i of idx) { const v = X[i][j]; if (!Number.isFinite(v) || v <= t) { gl += g[i]; hl += h[i]; nl++; } }
      const nr = idx.length - nl;
      if (nl < o.minLeaf || nr < o.minLeaf) continue;
      const gr = G - gl, hr = H - hl;
      const gain = (gl * gl) / (hl + o.lambda) + (gr * gr) / (hr + o.lambda) - (G * G) / (H + o.lambda);
      if (gain > best.gain) best = { gain, j, t };
    }
  }
  if (best.j < 0) return leaf;
  gains[best.j] += best.gain;
  const L: number[] = [], R: number[] = [];
  for (const i of idx) { const v = X[i][best.j]; (!Number.isFinite(v) || v <= best.t ? L : R).push(i); }
  return { j: best.j, t: best.t, l: buildTree(X, g, h, L, depth + 1, gains, o), r: buildTree(X, g, h, R, depth + 1, gains, o) };
}
const walk = (n: Tree, x: number[]): number =>
  n.v !== undefined ? n.v : walk(!Number.isFinite(x[n.j as number]) || x[n.j as number] <= (n.t as number) ? (n.l as Tree) : (n.r as Tree), x);

export function fitTrees(X: number[][], y: number[], o: TreeOpts = TREE_DEFAULTS, w?: number[]): { f0: number; trees: Tree[]; gains: number[] } {
  const n = X.length, d = X[0].length;
  const p0 = Math.min(0.95, Math.max(0.01, y.reduce((a, v) => a + v, 0) / n));
  const f0 = Math.log(p0 / (1 - p0));
  const F = new Array(n).fill(f0), trees: Tree[] = [], gains = new Array(d).fill(0);
  const g = new Array(n), h = new Array(n);
  const keep = Math.round(o.subsample * 100);
  for (let r = 0; r < o.rounds; r++) {
    for (let i = 0; i < n; i++) { const p = sigmoid(F[i]); const wi = w ? w[i] : 1; g[i] = (p - y[i]) * wi; h[i] = Math.max(p * (1 - p), 1e-4) * wi; }
    // each tree sees a different share of the calls, which keeps it from memorising
    const sub: number[] = [];
    for (let i = 0; i < n; i++) if ((i * 2654435761 + r * 40503) % 100 < keep) sub.push(i);
    const t = buildTree(X, g, h, sub, 0, gains, o);
    trees.push(t);
    for (let i = 0; i < n; i++) F[i] += o.lr * walk(t, X[i]);
  }
  return { f0, trees, gains };
}
export const scoreTrees = (f0: number, trees: Tree[], x: number[], lr: number = LR) => f0 + trees.reduce((a, t) => a + lr * walk(t, x), 0);
const score = (f0: number, trees: Tree[], x: number[]) => scoreTrees(f0, trees, x, LR);

export interface TrainRow { features: Features; win: boolean; at: number }

/**
 * Walk-forward test: for each of several later blocks of calls, train on everything BEFORE the block and score the block.
 * The reported numbers come from those never-seen blocks. Then the live model is refit on every call.
 */
export function trainModel(rows: TrainRow[], now = Date.now()): SignalModel | null {
  const usable = rows.filter((r) => r.features && Object.keys(r.features).length).sort((a, b) => a.at - b.at);
  if (usable.length < 300) return null;
  const raw = usable.map((r) => rawVector(r.features));
  const y = usable.map((r) => (r.win ? 1 : 0));
  const n = usable.length;

  const start = Math.floor(n * 0.45), folds = 4, block = Math.floor((n - start) / folds);
  const foldAuc: number[] = [], pooled: (readonly [number, number])[] = [];
  for (let k = 0; k < folds; k++) {
    const a = start + k * block, b = k === folds - 1 ? n : a + block;
    const { f0, trees } = fitTrees(raw.slice(0, a), y.slice(0, a));
    const sc: number[] = [], yt: number[] = [];
    for (let i = a; i < b; i++) { const s = score(f0, trees, raw[i]); sc.push(s); yt.push(y[i]); pooled.push([s, y[i]] as const); }
    foldAuc.push(auc(sc, yt));
  }
  const order = [...pooled].sort((p, q) => q[0] - p[0]);
  const qn = Math.max(8, Math.floor(order.length / 4));
  const rate = (arr: readonly (readonly [number, number])[]) => (arr.length ? arr.reduce((a, v) => a + v[1], 0) / arr.length : 0);
  const meanAuc = foldAuc.reduce((a, v) => a + v, 0) / foldAuc.length;
  const holdout = {
    n: pooled.length,
    auc: Math.round(meanAuc * 1000) / 1000,
    baseRate: Math.round(rate(order) * 1000) / 1000,
    topQuartileRate: Math.round(rate(order.slice(0, qn)) * 1000) / 1000,
    bottomQuartileRate: Math.round(rate(order.slice(-qn)) * 1000) / 1000,
    folds: foldAuc.map((v) => Math.round(v * 1000) / 1000),
  };

  // live model: refit on every call
  const live = fitTrees(raw, y);
  const wins = y.reduce<number>((a, v) => a + v, 0);
  const totalGain = live.gains.reduce((a, v) => a + v, 0) || 1;
  const corr = (j: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(raw[i][j])) pts.push([raw[i][j], y[i]]);
    if (pts.length < 30) return 0;
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, yy] of pts) { sxy += (x - mx) * (yy - my); sxx += (x - mx) ** 2; syy += (yy - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  const top = FEATURE_NAMES.map((name, j) => ({ name, w: (Math.round((live.gains[j] / totalGain) * 1000) / 10) * (corr(j) >= 0 ? 1 : -1) }))
    .filter((t) => t.w !== 0)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 8);

  return {
    v: 2,
    names: FEATURE_NAMES,
    f0: live.f0,
    lr: LR,
    trees: live.trees,
    base: wins / n,
    n,
    wins,
    trainedAt: now,
    holdout,
    // beats chance on average across the walk-forward blocks, in most of them, and the top quarter clearly out-hits the bottom
    active: holdout.auc >= 0.57 && foldAuc.filter((v) => v > 0.5).length >= Math.ceil(folds * 0.75) && holdout.topQuartileRate >= holdout.bottomQuartileRate * 1.3,
    top,
  };
}

/** Walk-forward scores for the later blocks (each scored by a model that only saw earlier calls). For honest performance reports. */
export function outOfSampleScores(rows: TrainRow[]): { score: number; row: TrainRow }[] {
  const usable = rows.filter((r) => r.features && Object.keys(r.features).length).sort((a, b) => a.at - b.at);
  if (usable.length < 300) return [];
  const raw = usable.map((r) => rawVector(r.features));
  const y = usable.map((r) => (r.win ? 1 : 0));
  const n = usable.length, start = Math.floor(n * 0.45), folds = 4, block = Math.floor((n - start) / folds);
  const out: { score: number; row: TrainRow }[] = [];
  for (let k = 0; k < folds; k++) {
    const a = start + k * block, b = k === folds - 1 ? n : a + block;
    const { f0, trees } = fitTrees(raw.slice(0, a), y.slice(0, a));
    for (let i = a; i < b; i++) out.push({ score: score(f0, trees, raw[i]), row: usable[i] });
  }
  return out;
}

/** P(reaches 2x) for one token's indicators. */
export function predict(model: SignalModel, f: Features): number {
  const r = rawVector(f);
  if (model.v === 2 && model.trees && model.f0 !== undefined) return sigmoid(score(model.f0, model.trees, r));
  // v1 (logistic) models saved before the upgrade
  let z = model.b ?? 0;
  for (let j = 0; j < r.length; j++) z += (model.w?.[j] ?? 0) * (Number.isFinite(r[j]) ? (r[j] - (model.mean?.[j] ?? 0)) / (model.std?.[j] ?? 1) : 0);
  return sigmoid(z);
}

// ── pattern library ───────────────────────────────────────────────────────────
// Named setups over the same indicators. Their hit rates are measured from history, never assumed.
export interface PatternDef { id: string; label: string; hint: string; test: (f: Features) => boolean }
const g = (f: Features, k: string) => num(f[k]);
const inR = (v: number | null, lo: number, hi: number) => v !== null && v >= lo && v <= hi;

export const PATTERNS: PatternDef[] = [
  { id: "early-accum", label: "Early accumulation", hint: "Young token, buyers outnumber sellers, price still quiet",
    test: (f) => inR(g(f, "ageMin"), 0, 360) && inR(g(f, "buyShare"), 0.55, 0.85) && inR(g(f, "h1"), -5, 40) },
  { id: "vol-breakout", label: "Breakout on volume", hint: "Hourly volume jumps against market cap while price starts to climb",
    test: (f) => (g(f, "volRatio") ?? 0) >= 0.12 && inR(g(f, "h1"), 10, 90) && (g(f, "m5") ?? 0) > 0 },
  { id: "accelerating", label: "Pace picking up", hint: "5-minute pace is faster than the hourly trend",
    test: (f) => (g(f, "h1") ?? 0) > 5 && (g(f, "m5") ?? 0) > 0 && (g(f, "m5") ?? 0) * 12 > (g(f, "h1") ?? 0) },
  { id: "smart-money", label: "Smart-money entry", hint: "Wallets with a winning record are buying and no known dumpers are in",
    test: (f) => (g(f, "smart") ?? 0) >= 1 && (g(f, "dumpers") ?? 0) === 0 },
  { id: "fresh-flow", label: "Fresh buyer flow", hint: "Many distinct buyers and buying speeding up",
    test: (f) => (g(f, "flowBuyers") ?? 0) >= 25 && (g(f, "flowAccel") ?? 0) >= 1.5 },
  { id: "graduation", label: "Graduation run", hint: "Just left the bonding curve with live momentum",
    test: (f) => (g(f, "grad") ?? 0) === 1 && inR(g(f, "ageMin"), 0, 720) && (g(f, "h1") ?? 0) > 0 },
  { id: "curve-push", label: "Curve push", hint: "Bonding curve more than 60% filled, getting close to graduating",
    test: (f) => (g(f, "curve") ?? 0) >= 0.6 && (g(f, "curve") ?? 0) < 1 },
  { id: "clean-dev", label: "Clean dev + holders", hint: "Developer has no dead launches, wide holder base, low concentration",
    test: (f) => (g(f, "devDead") ?? 1) === 0 && (g(f, "holders") ?? 0) >= 300 && (g(f, "topHolders") ?? 100) < 35 },
  { id: "reclaim", label: "Dip reclaim", hint: "Pulled back over 6 hours but is turning up again",
    test: (f) => (g(f, "h6") ?? 0) < -10 && (g(f, "h1") ?? 0) > 3 && (g(f, "m5") ?? 0) > 0 },
  // traps: patterns that tend to lose, shown as warnings
  { id: "trap-late", label: "Late chase", hint: "Already ran hard in the last hour",
    test: (f) => (g(f, "h1") ?? 0) > 150 },
  { id: "trap-bundled", label: "Bundled / concentrated", hint: "A few wallets hold or drive most of the flow",
    test: (f) => (g(f, "bundled") ?? 0) >= 1 || (g(f, "top3Share") ?? 0) >= 0.6 },
  { id: "trap-wash", label: "Wash volume", hint: "Big volume from very few traders",
    test: (f) => (g(f, "traders1h") ?? 999) < 15 && (g(f, "volRatio") ?? 0) > 1.5 },
];

export interface PatternStat { id: string; label: string; hint: string; trap: boolean; calls: number; wins: number; rate: number | null; lift: number | null }

export function patternStats(rows: TrainRow[]): PatternStat[] {
  const base = rows.length ? rows.filter((r) => r.win).length / rows.length : 0;
  return PATTERNS.map((p) => {
    const hit = rows.filter((r) => p.test(r.features));
    const wins = hit.filter((r) => r.win).length;
    const rate = hit.length >= 15 ? wins / hit.length : null;
    return {
      id: p.id, label: p.label, hint: p.hint, trap: p.id.startsWith("trap-"),
      calls: hit.length, wins, rate: rate === null ? null : Math.round(rate * 1000) / 1000,
      lift: rate === null || !base ? null : Math.round((rate / base) * 100) / 100,
    };
  });
}

export function detectPatterns(f: Features): string[] {
  const out: string[] = [];
  for (const p of PATTERNS) { try { if (p.test(f)) out.push(p.id); } catch { /* ignore */ } }
  return out;
}
