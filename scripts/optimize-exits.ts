/**
 * Which exit rules would actually have made money on past calls?   npx tsx scripts/optimize-exits.ts [all|public]
 * Replays every call's real 5-minute candles (scripts/.pilot/candles.jsonl, made by relabel-paths.ts) under thousands of
 * TP / SL / trailing / partial-TP / time-stop combinations, with realistic costs, and reports what works on calls it was NOT fitted on.
 *
 * Honest limits, so the numbers are read correctly:
 *   - 5-minute candles hide what happens inside a candle. When a candle touches both the stop and the target, the STOP is assumed to
 *     have hit first (cautious). A stop gapped through at the open fills at the open.
 *   - costs: 1.5% to get in, 3% to get out, 6% to get out through a stop (thin tokens slip when everyone sells)
 *   - only calls whose pool still existed are in the file, so dead-on-arrival tokens are under-represented: results are somewhat optimistic
 *   - the rule is CHOSEN on the earlier 60% of calls and judged on the later 40%
 */
import { existsSync, readFileSync } from "node:fs";
import { simulate, stats, type Policy } from "./pathlib";

interface Series { addr: string; at: number; engine: number | null; shadow: boolean; s: number[][] } // s: [minute, open, high, low, close] as ratios to the call price

const pct =(v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const label = (p: Policy) => `${p.tp ? `TP +${p.tp}%` : "no TP"} | ${p.sl ? `SL -${p.sl}%` : "no SL"} | ${p.trail ? `trail -${p.trail}% after +${p.trailAfter}%` : "no trail"}${p.tp1 ? ` | part ${p.tp1Sell}% at +${p.tp1}%` : ""}${p.hold ? ` | time ${p.hold}m` : ""}`;

function main() {
  const files = ["scripts/.pilot/candles.jsonl", "scripts/.pilot/candles-helius.jsonl"].filter((f) => existsSync(f));
  if (!files.length) { console.log("No candles yet. Run scripts/relabel-paths.ts or scripts/relabel-helius.ts first."); return; }
  const mode = process.argv[2] ?? "all";
  // two sources: GeckoTerminal candles and candles built from on-chain trades. For a call that has both, keep the one covering more of the day.
  const byAddr = new Map<string, Series & { cover?: number }>();
  for (const f of files) {
    for (const l of readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      const x = JSON.parse(l) as Series & { cover?: number };
      const cur = byAddr.get(x.addr);
      if (!cur || (x.cover ?? 1440) > (cur.cover ?? 1440)) byAddr.set(x.addr, x);
    }
  }
  let all = [...byAddr.values()].filter((x) => x.s.length >= 6 && (x.cover ?? 1440) >= 180);
  if (mode === "public") all = all.filter((x) => x.engine === 2 && !x.shadow);
  all.sort((a, b) => a.at - b.at);
  if (all.length < 60) { console.log(`Only ${all.length} calls with candles so far (${mode}); need about 60+ for a first look, 300+ to trust it.`); return; }
  const cut = Math.floor(all.length * 0.6);
  const train = all.slice(0, cut), test = all.slice(cut);
  console.log(`${all.length} calls with real price paths (${mode}). Fit on the earlier ${train.length}, judged on the later ${test.length}.\n`);

  const grid: Policy[] = [];
  for (const sl of [0, 15, 20, 25, 30, 40, 50, 60]) for (const tp of [0, 30, 50, 75, 100, 150, 200, 300, 500]) for (const trail of [0, 10, 15, 20, 30, 40]) for (const trailAfter of trail ? [0, 50] : [0])
    for (const [tp1, tp1Sell] of [[0, 0], [50, 50], [100, 50]]) for (const hold of [0, 60, 240, 1440]) {
      if (!sl && !trail && !tp && !hold) continue;
      grid.push({ sl, tp, trail, trailAfter, tp1, tp1Sell, hold });
    }
  console.log(`${grid.length} exit rules to try...`);

  const run = (set: Series[], p: Policy) => set.map((x) => simulate(x.s, p));
  const trainRes = grid.map((p) => ({ p, st: stats(run(train, p)) }));
  const ranked = trainRes.filter((r) => r.st.n >= 40).sort((a, b) => b.st.trimmed - a.st.trimmed);

  const baseline: Policy = { sl: 30, tp: 100, trail: 0, trailAfter: 0, tp1: 0, tp1Sell: 0, hold: 0 };
  const hold24: Policy = { sl: 0, tp: 0, trail: 0, trailAfter: 0, tp1: 0, tp1Sell: 0, hold: 1440 };
  const row = (name: string, p: Policy) => {
    const a = stats(run(train, p)), b = stats(run(test, p));
    console.log(`${name.padEnd(8)} ${label(p)}\n         fitted: avg ${pct(a.trimmed)} win ${pct(a.win, 0)} | UNSEEN: avg ${pct(b.trimmed)} (median ${pct(b.median)}) win ${pct(b.win, 0)} profit factor ${b.pf.toFixed(2)} worst-10% ${pct(b.p10, 0)}`);
  };
  console.log("\nREFERENCE");
  row("default", baseline);
  row("hold 24h", hold24);
  console.log("\nBEST RULES ON THE FITTED PART, and how they did on calls they never saw");
  for (const r of ranked.slice(0, 8)) row("fit #" + (ranked.indexOf(r) + 1), r.p);

  // is the best fitted rule really better than the default on unseen calls? bootstrap on the test calls
  const best = ranked[0]?.p;
  if (best) {
    const a = run(test, best), b = run(test, baseline);
    const d: number[] = [];
    for (let i = 0; i < 400; i++) { let s = 0; for (let k = 0; k < a.length; k++) { const j = Math.floor(Math.random() * a.length); s += a[j] - b[j]; } d.push(s / a.length); }
    d.sort((x, y) => x - y);
    const lo = d[Math.floor(d.length * 0.025)], hi = d[Math.floor(d.length * 0.975)];
    console.log(`\nbest fitted rule vs the app default on UNSEEN calls: ${pct(a.reduce((s, v) => s + v, 0) / a.length - b.reduce((s, v) => s + v, 0) / b.length)} better per trade (95% range ${pct(lo)} to ${pct(hi)}) ${lo > 0 ? "<- REAL" : "<- not proven"}`);
  }
  // how much of the picture is the stop vs the take-profit? simple marginals on the fitted set
  const marg = (key: keyof Policy, vals: number[]) => vals.map((v) => { const g = trainRes.filter((r) => r.p[key] === v && r.st.n >= 40); return `${key} ${v}: avg ${pct(g.reduce((s, r) => s + r.st.trimmed, 0) / (g.length || 1))}`; }).join("   ");
  console.log("\nAVERAGE over all rules that use each setting (fitted calls):");
  console.log(" ", marg("sl", [0, 15, 20, 30, 40, 50, 60]));
  console.log(" ", marg("tp", [0, 30, 50, 100, 200, 500]));
  console.log(" ", marg("trail", [0, 10, 20, 30, 40]));
}
main();
