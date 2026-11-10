/**
 * Does the scanner's model get smarter when it also sees early-buyer features from the first 30 minutes?
 *   npx tsx scripts/research-augmented.ts
 * For every collected token it computes wallet features using ONLY records built from earlier tokens (walk-forward), adds them to
 * that call's stored indicators, then trains and scores the SAME calls twice: with and without the extra features. Same folds,
 * same rows. Read-only (database reads only). The answer is the change in AUC on calls the model never trained on, with a range.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { auc, outOfSampleScores, type Features, type TrainRow } from "../lib/signalModel";

interface W { w: string; sol: number; buyOffsetS: number; soldPct: number; heldS: number | null; holdingAtHourEnd: boolean }
interface Tok { mint: string; win: boolean; ratioLast: number; t0: number; wallets: W[] }
const MATURE_S = 4 * 3600;
const EXTRA = ["wProven", "wHolders", "wDump", "wSniper", "wEarly", "wBig", "wHold"];

async function main() {
  const toks = (JSON.parse(readFileSync("scripts/.pilot/collect-big.json", "utf8")) as Tok[]).filter((t) => t.t0 && t.wallets?.length).sort((a, b) => a.t0 - b.t0);
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ address: { $in: toks.map((t) => t.mint) }, badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true } }, { projection: { address: 1, features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await c.close();
  const byMint = new Map(calls.map((x) => [x.address as string, x]));

  // walk-forward wallet records
  type Rec = { n: number; wins: number; dumps: number };
  const rec = new Map<string, Rec>();
  const pending: Tok[] = [];
  const win: TrainRow[] = [], winX: TrainRow[] = [], col: TrainRow[] = [], colX: TrainRow[] = [];
  for (const t of toks) {
    while (pending.length && pending[0].t0 + MATURE_S <= t.t0) {
      const d = pending.shift()!;
      for (const w of d.wallets) {
        const e = rec.get(w.w) ?? { n: 0, wins: 0, dumps: 0 };
        e.n++; if (d.win) e.wins++; if (d.ratioLast <= 0.5) e.dumps++;
        rec.set(w.w, e);
      }
    }
    const call = byMint.get(t.mint);
    if (call && Date.now() - (call.spottedAt as number) > 24 * 3_600_000) {
      let proven = 0, holders = 0, dump = 0, snipers = 0, big = 0, hold = 0;
      for (const w of t.wallets) {
        if (w.buyOffsetS <= 3) snipers++;
        if (w.sol >= 1) big++;
        if (w.holdingAtHourEnd) hold++;
        const e = rec.get(w.w);
        if (!e) continue;
        if (e.n >= 4 && w.buyOffsetS > 3 && e.dumps / e.n >= 0.75) dump++;
        if (e.n >= 3 && w.buyOffsetS > 3 && e.wins / e.n >= 0.3 && e.dumps / e.n < 0.6) { proven++; if (w.holdingAtHourEnd) holders++; }
      }
      const extra: Features = { wProven: proven, wHolders: holders, wDump: dump, wSniper: snipers / t.wallets.length, wEarly: t.wallets.length, wBig: big, wHold: hold / t.wallets.length };
      const base = (call.features ?? {}) as Features;
      // the baseline must not see ANY wallet feature
      const clean: Features = { ...base }; for (const k of EXTRA) delete clean[k];
      const at = call.spottedAt as number;
      const w2x = Math.max(call.peakMcap as number, call.lastMcap as number) / (call.spottedMcap as number) >= 2;
      const coll = (call.lastMcap as number) / (call.spottedMcap as number) <= 0.2;
      win.push({ features: clean, win: w2x, at }); winX.push({ features: { ...clean, ...extra }, win: w2x, at });
      col.push({ features: clean, win: coll, at }); colX.push({ features: { ...clean, ...extra }, win: coll, at });
    }
    pending.push(t); pending.sort((a, b) => a.t0 - b.t0);
  }
  console.log(`${win.length} calls with both stored indicators and early-buyer data; winners ${win.filter((r) => r.win).length}, collapsed ${col.filter((r) => r.win).length}\n`);

  const compare = (name: string, a: TrainRow[], b: TrainRow[]) => {
    const sa = outOfSampleScores(a), sb = outOfSampleScores(b);
    if (!sa.length || sa.length !== sb.length) { console.log(name, "not enough rows"); return; }
    const y = sa.map((s) => (s.row.win ? 1 : 0));
    const A = (s: { score: number }[], l: number[]) => (l.some((v) => v) && l.some((v) => !v) ? auc(s.map((q) => q.score), l) : NaN);
    const a0 = A(sa, y), b0 = A(sb, y);
    const diffs: number[] = [];
    for (let i = 0; i < 400; i++) {
      const idx = Array.from({ length: y.length }, () => Math.floor(Math.random() * y.length));
      const lab = idx.map((k) => y[k]);
      if (!lab.some((v) => v) || !lab.some((v) => !v)) continue;
      diffs.push(A(idx.map((k) => sb[k]), lab) - A(idx.map((k) => sa[k]), lab));
    }
    diffs.sort((p, q) => p - q);
    const lo = diffs[Math.floor(diffs.length * 0.025)], hi = diffs[Math.floor(diffs.length * 0.975)];
    console.log(`${name}: scored ${y.length} unseen calls (${y.reduce<number>((s, v) => s + v, 0)} positives)`);
    console.log(`  without wallet features AUC ${a0.toFixed(3)}   with ${b0.toFixed(3)}   change ${(b0 - a0).toFixed(3)}  (95% range ${lo.toFixed(3)} to ${hi.toFixed(3)})  ${lo > 0.005 ? "<- REAL gain" : hi < -0.005 ? "<- gets WORSE" : "<- not proven"}`);
  };
  compare("Predicting a 2x win", win, winX);
  compare("Predicting a collapse", col, colX);
}
main().catch((e) => { console.error(e); process.exit(1); });
