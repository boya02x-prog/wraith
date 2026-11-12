/**
 * Model research harness. Compares ideas ONLY on calls the model never saw, the same way every time:
 *   - walk-forward: train on the past, score the next block, repeat over 6 blocks (starting at 40% of the history)
 *   - a 24h gap between the end of training and the start of each test block, so no training label is still "in flight"
 *   - every idea is scored on identical blocks, so differences are paired; a bootstrap gives a 95% range for the change vs baseline
 *   npx tsx scripts/research-model2.ts [groups]       groups: base,tune,feat,target,ens,stack (default: all)
 * Read-only (database reads only). Takes a while: it fits a few hundred small models.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync } from "node:fs";
import { auc, fitTrees, rawVector, scoreTrees, TREE_DEFAULTS, type Features, type TreeOpts } from "../lib/signalModel";
import { simulate, stats } from "./pathlib";

/** "quick win": the price touched +30% before it touched -10% (a stop is assumed to hit first inside one 5-minute candle). From the real candle paths. */
function quickWins(): Map<string, { quick: boolean; s: number[][] }> {
  const out = new Map<string, { quick: boolean; s: number[][] }>(); const cover = new Map<string, number>();
  for (const f of ["scripts/.pilot/candles.jsonl", "scripts/.pilot/candles-helius.jsonl"]) {
    if (!existsSync(f)) continue;
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      const x = JSON.parse(l) as { addr: string; cover?: number; s: number[][] };
      if ((cover.get(x.addr) ?? -1) >= (x.cover ?? 1440)) continue;
      cover.set(x.addr, x.cover ?? 1440);
      let r = false;
      for (const [m, , h, lo] of x.s) { if (m < 0) continue; if (lo <= 0.9) break; if (h >= 1.3) { r = true; break; } }
      out.set(x.addr, { quick: r, s: x.s });
    }
  }
  return out;
}

interface Call { s?: number[][]; quick?: boolean; address: string; symbol: string; name: string; at: number; f: Features; ratioPeak: number; legacyPeak: number; hasPath: boolean; ratioLast: number; score: number | null; tier: string }
const H = 3_600_000;
const PATHS = process.argv.includes("--paths"); // use REAL price paths (candles / on-chain trades) to correct each call's peak
const GROUPS = new Set((process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "base,tune,feat,target,ens,stack").split(","));

// ── data ─────────────────────────────────────────────────────────────────────────────────────
async function load(): Promise<Call[]> {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const docs = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true }, spottedAt: { $lt: Date.now() - 24 * H } },
      { projection: { address: 1, symbol: 1, name: 1, features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, score: 1, tier: 1 } }).sort({ spottedAt: 1 }).toArray();
  await c.close();
  // real paths: GeckoTerminal candles, and the on-chain-trade rebuild; for each call keep the one covering more of the day
  const load = (f: string) => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, { ok: boolean; peak24h: number; coverMin?: number }>) : {});
  const g = load("scripts/.pilot/paths.json"), h = load("scripts/.pilot/paths-helius.json");
  const pathOf = (a: string) => { const x = g[a], y = h[a]; if (x?.ok && (!y?.ok || (x.coverMin ?? 1440) >= (y.coverMin ?? 1440))) return x; return y?.ok ? y : null; };
  const qw = PATHS ? quickWins() : new Map<string, { quick: boolean; s: number[][] }>();
  return docs.map((d) => {
    const legacy = Math.max(d.peakMcap as number, d.lastMcap as number) / (d.spottedMcap as number);
    const p = PATHS ? pathOf(d.address as string) : null;
    return {
      quick: qw.get(d.address as string)?.quick, s: qw.get(d.address as string)?.s, address: d.address as string, symbol: String(d.symbol ?? ""), name: String(d.name ?? ""), at: d.spottedAt as number, f: (d.features ?? {}) as Features,
      ratioPeak: p ? Math.max(legacy, p.peak24h) : legacy, legacyPeak: legacy, hasPath: !!p, ratioLast: (d.lastMcap as number) / (d.spottedMcap as number),
      score: typeof d.score === "number" ? d.score : null, tier: String(d.tier ?? ""),
    };
  });
}

// ── regime / rank / theme features, each computed from calls BEFORE the one being described ─────
const STOP = new Set(["the", "coin", "token", "of", "and", "for", "inu", "sol", "solana", "pump", "fun", "meme", "official", "new"]);
const words = (c: Call) => new Set(`${c.symbol} ${c.name}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
const RANK: [string, string][] = [["rkVol", "volRatio"], ["rkLiq", "liq"], ["rkH1", "h1"], ["rkM5", "m5"], ["rkTraders", "traders1h"], ["rkBuy", "buyShare"], ["rkMcap", "mcap"], ["rkHolders", "holders"], ["rkAge", "ageMin"]];

function withContext(calls: Call[]): Call[] {
  const win = (c: Call) => c.ratioPeak >= 2, col = (c: Call) => c.ratioLast <= 0.2;
  const gw = calls.filter(win).length / calls.length, gc = calls.filter(col).length / calls.length;
  const W = calls.map(words);
  const out: Call[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const f: Features = { ...c.f };
    // regime: only calls that had matured (4h+) by the time of this one
    const reg = (lo: number) => { let n = 0, w = 0, k = 0; for (let j = i - 1; j >= 0; j--) { const d = calls[j]; if (d.at < c.at - lo * H) break; if (d.at > c.at - 4 * H) continue; n++; if (win(d)) w++; if (col(d)) k++; } return { n, w, k }; };
    const r12 = reg(16), r36 = reg(40);
    f.regWin12 = (r12.w + 10 * gw) / (r12.n + 10); f.regCol12 = (r12.k + 10 * gc) / (r12.n + 10); f.regN12 = r12.n; f.regWin36 = (r36.w + 10 * gw) / (r36.n + 10);
    // rank vs the previous 24h of calls (features are known at call time, no outcome needed)
    for (const [key, src] of RANK) {
      const v = c.f[src];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      let below = 0, tot = 0;
      for (let j = i - 1; j >= 0; j--) { const d = calls[j]; if (d.at < c.at - 24 * H) break; const x = d.f[src]; if (typeof x !== "number" || !Number.isFinite(x)) continue; tot++; if (x < v) below++; }
      if (tot >= 15) f[key] = below / tot;
    }
    // theme: how did calls with a shared word in the last 48h (matured) turn out
    let tn = 0, tw = 0;
    if (W[i].size) for (let j = i - 1; j >= 0; j--) { const d = calls[j]; if (d.at < c.at - 48 * H) break; if (d.at > c.at - 4 * H) continue; let hit = false; for (const w of W[i]) if (W[j].has(w)) { hit = true; break; } if (hit) { tn++; if (win(d)) tw++; } }
    f.thN = tn; f.thWin = (tw + 4 * gw) / (tn + 4);
    out.push({ ...c, f });
  }
  return out;
}

// ── walk-forward ────────────────────────────────────────────────────────────────────────────
interface Fold { a: number; b: number }
function folds(n: number, k = 6): Fold[] {
  const start = Math.floor(n * 0.4), block = Math.floor((n - start) / k);
  return Array.from({ length: k }, (_, i) => ({ a: start + i * block, b: i === k - 1 ? n : start + (i + 1) * block }));
}
type Labeler = (c: Call) => number;
interface Result { name: string; scores: number[]; labels: number[]; foldAuc: number[]; idx: number[] }

function runConfig(name: string, calls: Call[], label: Labeler, o: TreeOpts, opts?: { cols?: number[]; w?: (c: Call) => number; extra?: (c: Call) => number[] }): Result {
  const X = calls.map((c) => (opts?.extra ? [...rawVector(c.f), ...opts.extra(c)] : rawVector(c.f)));
  const cols = opts?.cols;
  const Xs = cols ? X.map((r) => cols.map((j) => r[j])) : X;
  const y = calls.map(label);
  const scores: number[] = [], labels: number[] = [], idx: number[] = [], foldAuc: number[] = [];
  for (const { a, b } of folds(calls.length)) {
    const cut = calls[a].at - 24 * H;
    let m = 0; while (m < a && calls[m].at <= cut) m++; // 24h gap
    if (m < 200) continue;
    const w = opts?.w ? calls.slice(0, m).map(opts.w) : undefined;
    const { f0, trees } = fitTrees(Xs.slice(0, m), y.slice(0, m), o, w);
    const sc: number[] = [], yt: number[] = [];
    for (let i = a; i < b; i++) { const s = scoreTrees(f0, trees, Xs[i], o.lr); sc.push(s); yt.push(y[i]); scores.push(s); labels.push(y[i]); idx.push(i); }
    foldAuc.push(auc(sc, yt));
  }
  return { name, scores, labels, foldAuc, idx };
}
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

/** AUC of a result against ANY label set (e.g. a model trained on 1.5x, judged on 2x) */
function aucAgainst(r: Result, calls: Call[], label: Labeler): number { return auc(r.scores, r.idx.map((i) => label(calls[i]))); }
function boot(base: Result, r: Result, calls: Call[], label: Labeler, n = 300): [number, number] {
  const y = r.idx.map((i) => label(calls[i]));
  const d: number[] = [];
  for (let b = 0; b < n; b++) {
    const k = Array.from({ length: y.length }, () => Math.floor(Math.random() * y.length));
    const lab = k.map((i) => y[i]);
    if (!lab.some((v) => v) || !lab.some((v) => !v)) continue;
    d.push(auc(k.map((i) => r.scores[i]), lab) - auc(k.map((i) => base.scores[i]), lab));
  }
  d.sort((p, q) => p - q);
  return [d[Math.floor(d.length * 0.025)], d[Math.floor(d.length * 0.975)]];
}
function topRate(r: Result, calls: Call[], label: Labeler, frac: number): number {
  const order = r.idx.map((_, k) => k).sort((p, q) => r.scores[q] - r.scores[p]).slice(0, Math.max(10, Math.floor(r.idx.length * frac)));
  return mean(order.map((k) => label(calls[r.idx[k]])));
}
function report(base: Result | null, r: Result, calls: Call[], judge: Labeler) {
  const a = aucAgainst(r, calls, judge);
  const delta = base ? ` | change ${(a - aucAgainst(base, calls, judge) >= 0 ? "+" : "")}${(a - aucAgainst(base, calls, judge)).toFixed(3)} [${boot(base, r, calls, judge).map((v) => v.toFixed(3)).join(", ")}]` : "";
  const verdict = base ? (boot(base, r, calls, judge)[0] > 0 ? " <- REAL gain" : boot(base, r, calls, judge)[1] < 0 ? " <- worse" : " <- not proven") : "";
  console.log(`${r.name.padEnd(34)} AUC ${a.toFixed(3)} | folds ${mean(r.foldAuc).toFixed(3)}±${sd(r.foldAuc).toFixed(3)} | top10% hit ${(topRate(r, calls, judge, 0.1) * 100).toFixed(1)}%${delta}${verdict}`);
}

async function main() {
  let raw = await load();
  if (PATHS) {
    const n0 = raw.length;
    raw = raw.filter((c) => c.hasPath);
    console.log(`PATH MODE: ${raw.length} of ${n0} calls have a real price path; using only those, with the 24h peak taken from the path`);
    if (raw.length < 400) { console.log("Fewer than 400 calls with paths: results below are only a preview. Let the path jobs run longer for firm answers."); }
    if (raw.length < 150) return;
  }
  console.log(`${raw.length} calls (engine 2, older than 24h), ${new Date(raw[0].at).toISOString().slice(0, 10)} to ${new Date(raw[raw.length - 1].at).toISOString().slice(0, 10)}`);
  const L2: Labeler = (c) => (c.ratioPeak >= 2 ? 1 : 0);
  console.log(`2x winners ${raw.filter((c) => L2(c)).length} (${(mean(raw.map(L2)) * 100).toFixed(1)}%), collapsed ${raw.filter((c) => c.ratioLast <= 0.2).length}`);
  const ctx = withContext(raw);
  const t0 = Date.now();

  console.log("\n== BASELINE ==");
  const base = runConfig("baseline (live settings)", raw, L2, TREE_DEFAULTS);
  report(null, base, raw, L2);
  if (PATHS) {
    // the same model trained on the OLD sparse labels, but judged against the corrected ones: how much did the label noise cost?
    const Lold: Labeler = (c) => (c.legacyPeak >= 2 ? 1 : 0);
    report(base, runConfig("trained on OLD (sparse) labels", raw, Lold, TREE_DEFAULTS), raw, L2);
    console.log(`  (2x winners by the old labels ${raw.filter((c) => c.legacyPeak >= 2).length}, by the corrected labels ${raw.filter((c) => c.ratioPeak >= 2).length}, of ${raw.length} calls)`);
  }
  if (raw.some((c) => c.score !== null)) {
    const sc: Result = { name: "scanner score alone", scores: base.idx.map((i) => raw[i].score ?? 0), labels: base.labels, foldAuc: [], idx: base.idx };
    report(null, sc, raw, L2);
  }

  if (GROUPS.has("tune")) {
    console.log("\n== SETTINGS (same features, other tree settings) ==");
    const variants: [string, Partial<TreeOpts>][] = [
      ["depth 2", { depth: 2 }], ["depth 4", { depth: 4 }], ["minLeaf 20", { minLeaf: 20 }], ["minLeaf 80", { minLeaf: 80 }],
      ["lr .02 x400", { lr: 0.02, rounds: 400 }], ["lr .05 x120", { lr: 0.05, rounds: 120 }], ["lambda 30", { lambda: 30 }], ["lambda 60", { lambda: 60 }],
      ["subsample .5", { subsample: 0.5 }], ["depth 2, minLeaf 60, x400", { depth: 2, minLeaf: 60, rounds: 400, lr: 0.03 }], ["depth 3, minLeaf 80, lambda 30", { minLeaf: 80, lambda: 30 }], ["rounds 120", { rounds: 120 }],
    ];
    for (const [name, v] of variants) report(base, runConfig(name, raw, L2, { ...TREE_DEFAULTS, ...v }), raw, L2);
  }

  if (GROUPS.has("feat")) {
    console.log("\n== FEATURES (live settings) ==");
    const names = ctx[0] ? Object.keys(ctx[0].f) : [];
    void names;
    report(base, runConfig("+ market regime", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^(rk|th)/.test(k))) })), L2, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("+ ranks vs last 24h", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^(reg|th)/.test(k))) })), L2, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("+ name/theme history", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^(reg|rk)/.test(k))) })), L2, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("+ all three", ctx, L2, TREE_DEFAULTS), raw, L2);
  }

  if (GROUPS.has("target")) {
    console.log("\n== WHAT TO LEARN (all judged against real 2x winners) ==");
    const L15: Labeler = (c) => (c.ratioPeak >= 1.5 ? 1 : 0);
    const Ldur: Labeler = (c) => (c.ratioPeak >= 2 && c.ratioLast >= 0.7 ? 1 : 0);
    const Lnc: Labeler = (c) => (c.ratioLast > 0.2 ? 1 : 0);
    report(base, runConfig("learn 1.5x (judged on 2x)", raw, L15, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("learn 2x that held 70% (judged 2x)", raw, Ldur, TREE_DEFAULTS), raw, L2);
    report(base, runConfig("learn NOT-collapsing (judged 2x)", raw, Lnc, TREE_DEFAULTS), raw, L2);
    const wpos: (c: Call) => number = (c) => (L2(c) ? 2 : 1);
    report(base, runConfig("weight winners x2", raw, L2, TREE_DEFAULTS, { w: wpos }), raw, L2);
  }

  if (GROUPS.has("ens")) {
    console.log("\n== ENSEMBLE (average of several models) ==");
    const parts = [TREE_DEFAULTS, { ...TREE_DEFAULTS, depth: 2, rounds: 300 }, { ...TREE_DEFAULTS, subsample: 0.5, minLeaf: 60 }, { ...TREE_DEFAULTS, lambda: 30, rounds: 200 }].map((o, i) => runConfig(`part ${i}`, raw, L2, o));
    const z = (v: number[]) => { const m = mean(v), s = sd(v) || 1; return v.map((x) => (x - m) / s); };
    const zs = parts.map((p) => z(p.scores));
    const ens: Result = { name: "average of 4 tree models", scores: zs[0].map((_, i) => mean(zs.map((q) => q[i]))), labels: parts[0].labels, foldAuc: parts[0].foldAuc, idx: parts[0].idx };
    report(base, ens, raw, L2);
  }
  if (GROUPS.has("quick")) {
    // An easier question that matches the best exit rule found: does it touch +30% BEFORE it touches -10%? Everything is judged on that.
    const Lq: Labeler = (c) => (c.quick ? 1 : 0);
    console.log(`\n== QUICK WIN: +30% before -10% (${raw.filter((c) => c.quick).length} of ${raw.length} calls, ${(mean(raw.map(Lq)) * 100).toFixed(1)}%) ==`);
    const sc: Result = { name: "scanner score alone", scores: base.idx.map((i) => raw[i].score ?? 0), labels: base.labels, foldAuc: [], idx: base.idx };
    report(null, base, raw, Lq);
    report(base, sc, raw, Lq);
    report(base, runConfig("trained on quick wins", raw, Lq, TREE_DEFAULTS), raw, Lq);
    report(base, runConfig("trained on quick wins + context", ctx, Lq, TREE_DEFAULTS), raw, Lq);
    report(base, runConfig("trained on quick, shallow trees", raw, Lq, { ...TREE_DEFAULTS, depth: 2, minLeaf: 60 }), raw, Lq);
  }

  if (GROUPS.has("guard")) {
    // What a stricter gate would have done to the calls the app actually shows (score 72+), judged only on calls the models never saw.
    // A "failed call" here = it collapsed to 20% or less, or the quick-exit trade (take profit +30%, trail -10%) lost money.
    const Lcol: Labeler = (c) => (c.ratioLast <= 0.2 ? 1 : 0);
    const Lq: Labeler = (c) => (c.quick ? 1 : 0);
    const rugRes = runConfig("collapse model", ctx, Lcol, TREE_DEFAULTS);
    const qRes = runConfig("quick-win model", ctx, Lq, TREE_DEFAULTS);
    const QUICK = { sl: 0, tp: 30, trail: 10, trailAfter: 0, tp1: 0, tp1Sell: 0, hold: 0 };
    type T = { c: Call; rug: number; q: number; ret: number };
    const tested: T[] = base.idx.map((i, k) => ({ c: raw[i], rug: rugRes.scores[k], q: qRes.scores[k], ret: raw[i].s ? simulate(raw[i].s!, QUICK) : NaN })).filter((t) => (t.c.score ?? 0) >= 72 && Number.isFinite(t.ret));
    const rank = (key: "rug" | "q") => { const o = [...tested].sort((a, b) => a[key] - b[key]); return new Map(o.map((t, i) => [t, i / Math.max(1, o.length - 1)])); };
    const rr = rank("rug"), qr = rank("q");
    const ci = (xs: number[]) => { if (xs.length < 10) return "n small"; const m: number[] = []; for (let b = 0; b < 400; b++) { let s = 0; for (let k = 0; k < xs.length; k++) s += xs[Math.floor(Math.random() * xs.length)]; m.push(s / xs.length); } m.sort((a, c2) => a - c2); return `${(m[10] * 100).toFixed(1)}% to ${(m[389] * 100).toFixed(1)}%`; };
    const line = (name: string, keep: T[]) => {
      const n = keep.length || 1, f = (g: (t: T) => boolean) => ((keep.filter(g).length / n) * 100).toFixed(0).padStart(3) + "%";
      console.log(`${name.padEnd(34)} ${String(keep.length).padStart(4)} calls | collapsed ${f((t) => t.c.ratioLast <= 0.2)} | quick win ${f((t) => !!t.c.quick)} | lost money ${f((t) => t.ret < 0)} | avg trade ${(mean(keep.map((t) => t.ret)) * 100).toFixed(1).padStart(5)}% (${ci(keep.map((t) => t.ret))})`);
    };
    console.log(`\n== STRICTER GATES on the ${tested.length} tested public calls with a real path (quick exit: take profit +30%, trail -10%, usual costs) ==`);
    line("all public calls (today)", tested);
    for (const d of [0.1, 0.2, 0.3, 0.4]) line(`drop riskiest ${d * 100}% by collapse model`, tested.filter((t) => (rr.get(t) as number) < 1 - d));
    for (const k of [0.7, 0.5, 0.3]) line(`keep best ${k * 100}% by quick-win model`, tested.filter((t) => (qr.get(t) as number) >= 1 - k));
    for (const k of [0.7, 0.5, 0.3]) line(`keep best ${k * 100}% by both models`, [...tested].sort((a, b) => (qr.get(b) as number) - (rr.get(b) as number) - ((qr.get(a) as number) - (rr.get(a) as number))).slice(0, Math.round(tested.length * k)));
    console.log("\nBy ABSOLUTE collapse risk (the number the app shows; this is what the block / warn levels are set in):");
    const pr = (t: T) => 1 / (1 + Math.exp(-t.rug));
    for (const lim of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) line(`collapse risk under ${Math.round(lim * 100)}%`, tested.filter((t) => pr(t) < lim));
    const ps = tested.map(pr).sort((a, b) => a - b);
    console.log(`(risk spread on these calls: lowest ${(ps[0] * 100).toFixed(0)}%, median ${(ps[Math.floor(ps.length / 2)] * 100).toFixed(0)}%, highest ${(ps[ps.length - 1] * 100).toFixed(0)}%)`);
    console.log(`quick-win model AUC on these calls: ${auc(tested.map((t) => t.q), tested.map((t) => (t.c.quick ? 1 : 0))).toFixed(3)} | collapse model AUC: ${auc(tested.map((t) => t.rug), tested.map((t) => (t.c.ratioLast <= 0.2 ? 1 : 0))).toFixed(3)}`);
  }

  if (GROUPS.has("flow")) {
    // Does buyer flow (rebuilt from real on-chain trades by scripts/backfill-flow.ts, using only trades BEFORE each call) help?
    // Both runs use exactly the same calls; the only difference is whether the five flow numbers are given to the model.
    const KEYS = ["flowBuyers", "flowAccel", "top3Share", "bundled", "netSol"];
    const fm: Record<string, { ok: boolean; f?: Record<string, number> }> = existsSync("scripts/.pilot/flow.json") ? JSON.parse(readFileSync("scripts/.pilot/flow.json", "utf8")) : {};
    const sub = raw.filter((c) => fm[c.address]?.ok);
    console.log(`\n== BUYER FLOW from on-chain trades: ${sub.length} of ${raw.length} calls have it ==`);
    if (sub.length < 300) { console.log("Too few so far (need 300+). Let scripts/backfill-flow.ts run longer."); }
    else {
      const strip = (f: Features): Features => Object.fromEntries(Object.entries(f).filter(([k]) => !KEYS.includes(k)));
      const without = sub.map((c) => ({ ...c, f: strip(c.f) }));
      const withF = sub.map((c) => ({ ...c, f: { ...strip(c.f), ...(fm[c.address].f as Features) } }));
      const Lcol: Labeler = (c) => (c.ratioLast <= 0.2 ? 1 : 0);
      const b2 = runConfig("reach 2x: WITHOUT flow", without, L2, TREE_DEFAULTS);
      report(null, b2, without, L2);
      report(b2, runConfig("reach 2x: WITH flow", withF, L2, TREE_DEFAULTS), withF, L2);
      const bc = runConfig("collapse: WITHOUT flow", without, Lcol, TREE_DEFAULTS);
      report(null, bc, without, Lcol);
      report(bc, runConfig("collapse: WITH flow", withF, Lcol, TREE_DEFAULTS), withF, Lcol);
      // the same two questions, but only for the calls the app shows (score 72+): ranking inside them is what users feel
      const hot = (i: number) => (sub[i].score ?? 0) >= 72;
      const within = (r: Result, judge: Labeler) => { const keep = r.idx.map((i, k) => (hot(i) ? k : -1)).filter((k) => k >= 0); return keep.length > 30 ? auc(keep.map((k) => r.scores[k]), keep.map((k) => judge(sub[r.idx[k]]))).toFixed(3) : "n/a"; };
      const w2 = runConfig("w2", withF, L2, TREE_DEFAULTS), n2 = runConfig("n2", without, L2, TREE_DEFAULTS), wc = runConfig("wc", withF, Lcol, TREE_DEFAULTS), nc = runConfig("nc", without, Lcol, TREE_DEFAULTS);
      console.log(`WITHIN score 72+ calls: reach 2x AUC ${within(n2, L2)} -> ${within(w2, L2)} with flow | collapse AUC ${within(nc, Lcol)} -> ${within(wc, Lcol)} with flow`);
    }
  }

  if (GROUPS.has("cand")) {
    // Does the SHAPE of the chart right before the call help (how far off its high, how much it already ran, volatility, volume pick-up)?
    // scripts/backfill-candles.ts reads each token's chart from Jupiter up to the moment of the call (complete candles only, no peeking).
    // Both runs use exactly the same calls; the only difference is whether the chart numbers are given to the model.
    const CK = ["cN15", "cRet1h", "cRet4h", "cRet12h", "cAth", "cAthBars", "cLowDist", "cVol", "cVolPick", "cUp8", "cRange1h", "cHigh16", "c1mMom"];
    const cm: Record<string, { ok: boolean; f?: Record<string, number> }> = existsSync("scripts/.pilot/cand.json") ? JSON.parse(readFileSync("scripts/.pilot/cand.json", "utf8")) : {};
    const sub = raw.filter((c) => cm[c.address]?.ok);
    console.log(`
== CHART SHAPE before the call: ${sub.length} of ${raw.length} calls have it ==`);
    if (sub.length < 300) { console.log("Too few so far (need 300+). Let scripts/backfill-candles.ts run longer."); }
    else {
      const extra = (c: Call) => CK.map((k) => { const v = cm[c.address]?.f?.[k]; return typeof v === "number" && Number.isFinite(v) ? v : NaN; });
      const Lcol: Labeler = (c) => (c.ratioLast <= 0.2 ? 1 : 0);
      const L15: Labeler = (c) => (c.ratioPeak >= 1.5 ? 1 : 0);
      const b2 = runConfig("reach 2x: WITHOUT chart shape", sub, L2, TREE_DEFAULTS);
      report(null, b2, sub, L2);
      const w2 = runConfig("reach 2x: WITH chart shape", sub, L2, TREE_DEFAULTS, { extra });
      report(b2, w2, sub, L2);
      const bc = runConfig("collapse: WITHOUT chart shape", sub, Lcol, TREE_DEFAULTS);
      report(null, bc, sub, Lcol);
      const wc = runConfig("collapse: WITH chart shape", sub, Lcol, TREE_DEFAULTS, { extra });
      report(bc, wc, sub, Lcol);
      const b15 = runConfig("reach 1.5x: WITHOUT chart shape", sub, L15, TREE_DEFAULTS);
      report(null, b15, sub, L15);
      report(b15, runConfig("reach 1.5x: WITH chart shape", sub, L15, TREE_DEFAULTS, { extra }), sub, L15);
      const hot = (i: number) => (sub[i].score ?? 0) >= 72;
      const within = (r: Result, judge: Labeler) => { const keep = r.idx.map((i, k) => (hot(i) ? k : -1)).filter((k) => k >= 0); return keep.length > 30 ? auc(keep.map((k) => r.scores[k]), keep.map((k) => judge(sub[r.idx[k]]))).toFixed(3) : "n/a"; };
      console.log(`WITHIN score 72+ calls: reach 2x AUC ${within(b2, L2)} -> ${within(w2, L2)} with chart shape | collapse AUC ${within(bc, Lcol)} -> ${within(wc, Lcol)}`);
      // the hand-built scanner score on the same calls, for reference
      const scoreOnly: Result = { name: "scanner score alone", scores: b2.idx.map((i) => sub[i].score ?? 0), labels: b2.labels, foldAuc: [], idx: b2.idx };
      report(null, scoreOnly, sub, L2);
    }
  }

  if (GROUPS.has("stack")) {
    // The hand-built scanner score beats the learned model on its own. So the honest question is whether learning adds ANYTHING to it.
    console.log("\n== DOES LEARNING ADD ANYTHING TO THE HAND-BUILT SCORE? (every line is judged against the score alone) ==");
    const scoreRes: Result = { name: "scanner score alone", scores: base.idx.map((i) => raw[i].score ?? 0), labels: base.labels, foldAuc: [], idx: base.idx };
    const z = (v: number[]) => { const m = mean(v), s = sd(v) || 1; return v.map((x) => (x - m) / s); };
    const zs = z(scoreRes.scores), zm = z(base.scores);
    const blend = (k: number): Result => ({ name: `score + ${k} x the model`, scores: zs.map((x, i) => x + k * zm[i]), labels: base.labels, foldAuc: [], idx: base.idx });
    const stacked = runConfig("trees given the score as an input", raw, L2, TREE_DEFAULTS, { extra: (c) => [c.score ?? 0] });
    const stackedCtx = runConfig("... plus regime and ranks", ctx.map((c) => ({ ...c, f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !/^th/.test(k))) })), L2, TREE_DEFAULTS, { extra: (c) => [c.score ?? 0] });
    const all: Result[] = [blend(0.25), blend(0.5), blend(1), stacked, stackedCtx];
    for (const r of all) report(scoreRes, r, raw, L2);
    // what matters for the app: ranking WITHIN the calls it actually shows (score 72+), not telling shadow calls from public ones
    const hot = (i: number) => (raw[i].score ?? 0) >= 72;
    const within = (r: Result) => { const keep = r.idx.map((i, k) => (hot(i) ? k : -1)).filter((k) => k >= 0); return keep.length ? auc(keep.map((k) => r.scores[k]), keep.map((k) => L2(raw[r.idx[k]]))) : NaN; };
    const nHot = base.idx.filter(hot).length;
    console.log(`\nWITHIN the calls the app actually shows (score 72 or more, ${nHot} of ${base.idx.length} tested calls), AUC for reaching 2x:`);
    for (const r of [scoreRes, base, ...all]) console.log(`  ${r.name.padEnd(36)} ${within(r).toFixed(3)}`);
  }
  console.log(`\nfinished in ${Math.round((Date.now() - t0) / 1000)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
