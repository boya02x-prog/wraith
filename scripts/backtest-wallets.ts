/**
 * Walk-forward test of the wallet signal on the collected early buyers.  npx tsx scripts/backtest-wallets.ts [file]
 * Question: do early buyers with a good record add anything to what the scanner already knows?
 * Rules of the test (so it cannot flatter itself):
 *   - tokens are replayed in launch order; a wallet's record only counts tokens that launched AND had matured (4h+) BEFORE this one
 *   - wallets that bought inside the first 3 seconds (snipers/bots) are scored separately from later, more deliberate buyers
 *   - results are compared with the scanner's own score on the same tokens, alone and combined
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { auc } from "../lib/signalModel";

const FILE = process.argv[2] ?? "scripts/.pilot/collect-big.json";
interface Row { mint: string; symbol?: string; win: boolean; ratioPeak: number; ratioLast: number; t0: number; wallets: { w: string; sol: number; buyOffsetS: number; soldPct: number; heldS: number | null; holdingAtHourEnd: boolean }[] }
const MATURE_S = 4 * 3600;

async function main() {
  const rows = (JSON.parse(readFileSync(FILE, "utf8")) as Row[]).filter((r) => r.t0 && r.wallets?.length).sort((a, b) => a.t0 - b.t0);
  console.log(`${rows.length} tokens, ${rows.filter((r) => r.win).length} winners (${((rows.filter((r) => r.win).length / Math.max(1, rows.length)) * 100).toFixed(0)}%), ${new Set(rows.flatMap((r) => r.wallets.map((w) => w.w))).size} distinct wallets`);
  if (rows.length < 150 || rows.filter((r) => r.win).length < 15) { console.log("Not enough tokens/winners yet for a meaningful test (need ~150+ tokens and 15+ winners)."); return; }

  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls").find({ address: { $in: rows.map((r) => r.mint) } }, { projection: { address: 1, score: 1 } }).toArray();
  await c.close();
  const scanner = new Map(calls.map((x) => [x.address as string, Number(x.score)]));

  type Rec = { n: number; wins: number; holdWins: number; holdN: number; dumps: number };
  const rec = new Map<string, Rec>();
  const pending: Row[] = [];
  const feat: { win: boolean; collapse: boolean; dumpers: number; proven: number; provenHolders: number; sniperShare: number; scanner: number | null }[] = [];
  for (const r of rows) {
    // credit only tokens that were mature when this one launched
    while (pending.length && pending[0].t0 + MATURE_S <= r.t0) {
      const d = pending.shift()!;
      for (const w of d.wallets) {
        const e = rec.get(w.w) ?? { n: 0, wins: 0, holdWins: 0, holdN: 0, dumps: 0 };
        e.n++; if (d.win) e.wins++; if (d.ratioLast <= 0.5) e.dumps++;
        if (w.holdingAtHourEnd) { e.holdN++; if (d.win) e.holdWins++; }
        rec.set(w.w, e);
      }
    }
    let proven = 0, provenHolders = 0, snipers = 0, dumpers = 0;
    for (const w of r.wallets) {
      if (w.buyOffsetS <= 3) snipers++;
      const e = rec.get(w.w);
      if (e && e.n >= 4 && w.buyOffsetS > 3 && e.dumps / e.n >= 0.75) dumpers++;
      if (!e || e.n < 3) continue;
      if (e.wins / e.n >= 0.25 && e.wins >= 2 && w.buyOffsetS > 3) { proven++; if (w.holdingAtHourEnd) provenHolders++; }
    }
    feat.push({ win: r.win, collapse: r.ratioLast <= 0.2, dumpers, proven, provenHolders, sniperShare: snipers / r.wallets.length, scanner: scanner.get(r.mint) ?? null });
    pending.push(r); pending.sort((a, b) => a.t0 - b.t0);
  }
  const scored = feat.slice(Math.floor(feat.length * 0.3)); // the first 30% only builds records
  const y = scored.map((f) => (f.win ? 1 : 0)), yc = scored.map((f) => (f.collapse ? 1 : 0));
  const A = (sc: number[], lab: number[]) => (lab.some((v) => v) && lab.some((v) => !v) ? auc(sc, lab) : NaN);
  const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
  console.log(`\nscored ${scored.length} tokens with earlier data only`);
  console.log("AUC predicting a 2x win (0.5 = coin flip):");
  console.log("  proven-wallet count        ", f2(A(scored.map((f) => f.proven), y)));
  console.log("  proven wallets that hold   ", f2(A(scored.map((f) => f.provenHolders), y)));
  console.log("  fewer snipers (inverse)    ", f2(A(scored.map((f) => -f.sniperShare), y)));
  const withScore = scored.filter((f) => f.scanner !== null);
  if (withScore.length > 80) {
    const yy = withScore.map((f) => (f.win ? 1 : 0));
    const base = A(withScore.map((f) => f.scanner as number), yy);
    // simple blend: scanner rank + wallet rank
    const rank = (v: number[]) => { const o = [...v.keys()].sort((a, b) => v[a] - v[b]); const r = new Array(v.length); o.forEach((i, k) => (r[i] = k / v.length)); return r; };
    const rs = rank(withScore.map((f) => f.scanner as number)), rw = rank(withScore.map((f) => f.provenHolders + f.proven * 0.5));
    const bl = rs.map((v, i) => v + 0.5 * rw[i]);
    const blend = A(bl, yy);
    // Is the gain real or noise? Resample the tokens 400 times and look at the spread of (blend - scanner).
    const sc = withScore.map((f) => f.scanner as number);
    const gains: number[] = [];
    for (let b = 0; b < 400; b++) {
      const idx = Array.from({ length: yy.length }, () => Math.floor(Math.random() * yy.length));
      const lab = idx.map((i) => yy[i]);
      if (!lab.some((v) => v) || !lab.some((v) => !v)) continue;
      gains.push(A(idx.map((i) => bl[i]), lab) - A(idx.map((i) => sc[i]), lab));
    }
    gains.sort((a, b2) => a - b2);
    const lo95 = gains[Math.floor(gains.length * 0.025)], hi95 = gains[Math.floor(gains.length * 0.975)];
    // The scanner's score is below 0.5 here (all these tokens were already called, so scores are bunched), so beating it proves little.
    // The fair test is the wallet signal ON ITS OWN against a coin flip (0.5), with a resampled range.
    const wal = withScore.map((f) => f.provenHolders + f.proven * 0.5);
    const solo: number[] = [];
    for (let b = 0; b < 400; b++) {
      const idx = Array.from({ length: yy.length }, () => Math.floor(Math.random() * yy.length));
      const lab = idx.map((i) => yy[i]);
      if (!lab.some((v) => v) || !lab.some((v) => !v)) continue;
      solo.push(A(idx.map((i) => wal[i]), lab));
    }
    solo.sort((a, b2) => a - b2);
    const s_lo = solo[Math.floor(solo.length * 0.025)], s_hi = solo[Math.floor(solo.length * 0.975)];
    console.log(`\nwallet signal ALONE: AUC ${f2(A(wal, yy))}, 95% range ${f2(s_lo)} to ${f2(s_hi)}`, s_lo > 0.5 ? "  <- beats a coin flip" : "  <- NOT proven (the range includes 0.5)");
    console.log(`versus the scanner's own score on the same ${withScore.length} tokens (${yy.reduce<number>((a, v) => a + v, 0)} winners):`);
    console.log("  scanner alone              ", f2(base));
    console.log("  scanner + wallet signal    ", f2(blend));
    console.log(`  gain ${f2(blend - base)}, 95% range ${f2(lo95)} to ${f2(hi95)}`, lo95 > 0.01 ? "  <- REAL gain" : "  <- NOT proven (the range includes zero)");
  }
  console.log("\nAUC predicting a collapse (low is good for a wallet signal):");
  console.log("  proven wallets that hold   ", f2(A(scored.map((f) => f.provenHolders), yc)));
  console.log("\nREPEAT DUMPERS among the early buyers (wallets that kept ending in a 50%+ loss):");
  console.log("  AUC predicting a collapse   ", f2(A(scored.map((f) => f.dumpers), yc)), " (above 0.5 = more dumpers means more collapses)");
  for (const [lab, test] of [["0 dumpers", (f: typeof scored[number]) => f.dumpers === 0], ["1-3 dumpers", (f: typeof scored[number]) => f.dumpers >= 1 && f.dumpers <= 3], ["4-9 dumpers", (f: typeof scored[number]) => f.dumpers >= 4 && f.dumpers <= 9], ["10+ dumpers", (f: typeof scored[number]) => f.dumpers >= 10]] as const) {
    const g = scored.filter(test);
    console.log(`  ${lab.padEnd(12)} n=${String(g.length).padStart(4)}  collapse ${g.length ? Math.round((g.filter((f) => f.collapse).length / g.length) * 100) : 0}%  2x ${g.length ? Math.round((g.filter((f) => f.win).length / g.length) * 100) : 0}%`);
  }
  const hi = scored.filter((f) => f.provenHolders >= 2), lo = scored.filter((f) => f.provenHolders < 2);
  const pr = (a: typeof scored, k: "win" | "collapse") => (a.length ? `${((a.filter((f) => f[k]).length / a.length) * 100).toFixed(0)}% (n=${a.length})` : "n/a");
  console.log(`\n2+ proven holders: 2x ${pr(hi, "win")}, collapse ${pr(hi, "collapse")}   |   otherwise: 2x ${pr(lo, "win")}, collapse ${pr(lo, "collapse")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
