/**
 * Would a stricter "publish only if ..." rule have made the public calls better?  Read-only:  npx tsx scripts/backtest-filter.ts
 * Public calls only (engine 2, not shadow), old enough to have had 24h to play out. For every single-feature rule the cut-off is
 * CHOSEN on the earlier 60% of calls and JUDGED on the later 40% (walk-forward), so a rule cannot look good just because it was
 * fitted to the same calls. Outcomes per call: reached 2x (peak >= 2x the called mcap), ended below half, ended below 20%.
 * Honest limits: outcomes use the recorded peak/last/trough (the refresh job's checks, denser since Nov 8); this measures what
 * happens to the CALLS that survive the rule, not trading profit; fewer calls means wider ranges.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

interface Call { at: number; score: number; f: Record<string, number | null>; hit2: boolean; half: boolean; coll: boolean; ratioEnd: number }

const FEATURES = ["score", "liq", "liqRatio", "mcap", "ageMin", "holders", "organic", "topHolders", "traders1h", "buyShare", "volRatio", "h1", "h6", "h24", "m5"] as const;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const rate = (xs: Call[], k: "hit2" | "half" | "coll") => (xs.length ? xs.filter((x) => x[k]).length / xs.length : 0);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const val = (c: Call, f: string) => (f === "score" ? c.score : c.f[f] ?? null);

async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } },
      { projection: { score: 1, features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).sort({ spottedAt: 1 }).toArray();
  await cli.close();
  const calls: Call[] = docs.map((d) => {
    const s = Number(d.spottedMcap), peak = Number(d.peakMcap ?? s), last = Number(d.lastMcap ?? s);
    return { at: Number(d.spottedAt), score: Number(d.score), f: (d.features ?? {}) as Call["f"], hit2: peak >= 2 * s, half: last < 0.5 * s, coll: last < 0.2 * s, ratioEnd: last / s };
  });
  const cut = Math.floor(calls.length * 0.6);
  const train = calls.slice(0, cut), test = calls.slice(cut);
  console.log(`public calls with 24h+ of history: ${calls.length} (train ${train.length}, test ${test.length})`);
  const line = (name: string, xs: Call[]) => {
    const h = xs.filter((x) => x.hit2).length, [lo, hi] = wilson(h, xs.length);
    console.log(`${name.padEnd(34)} n=${String(xs.length).padStart(4)}  hit2x ${pct(rate(xs, "hit2")).padStart(4)} (${pct(lo)}-${pct(hi)})  ended<50% ${pct(rate(xs, "half")).padStart(4)}  ended<20% ${pct(rate(xs, "coll")).padStart(4)}  median end ${median(xs.map((x) => x.ratioEnd)).toFixed(2)}x`);
  };
  console.log("\n== all public calls =="); line("train (earlier 60%)", train); line("test  (later 40%)", test);

  type Rule = { f: string; dir: ">=" | "<="; q: number; cutoff: number; trainHit: number; trainColl: number };
  const rules: Rule[] = [];
  for (const f of FEATURES) {
    const vals = train.map((c) => val(c, f)).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    if (vals.length < train.length * 0.5) continue; // feature mostly missing: skip
    for (const q of [0.25, 0.5, 0.75]) {
      const cutoff = vals[Math.floor(vals.length * q)];
      for (const dir of [">=", "<="] as const) {
        const keep = train.filter((c) => { const v = val(c, f); return v !== null && (dir === ">=" ? v >= cutoff : v <= cutoff); });
        if (keep.length < 40) continue;
        rules.push({ f, dir, q, cutoff, trainHit: rate(keep, "hit2"), trainColl: rate(keep, "coll") });
      }
    }
  }
  const pass = (r: Rule, c: Call) => { const v = val(c, r.f); return v !== null && (r.dir === ">=" ? v >= r.cutoff : v <= r.cutoff); };
  console.log("\n== best single rules on TRAIN, judged on TEST (top 8 by train 2x rate, then top 6 by train collapse cut) ==");
  const show = (rs: Rule[]) => rs.forEach((r) => { const t = test.filter((c) => pass(r, c)); line(`${r.f} ${r.dir} ${+r.cutoff.toFixed(3)}`, t); });
  show([...rules].sort((a, b) => b.trainHit - a.trainHit).slice(0, 8));
  console.log("-- by lowest train collapse rate --");
  show([...rules].sort((a, b) => a.trainColl - b.trainColl).slice(0, 6));
  // best 2-rule combination from the top 12 train rules by 2x rate, judged on test
  const top = [...rules].sort((a, b) => b.trainHit - a.trainHit).slice(0, 12);
  let best: [Rule, Rule] | null = null, bestScore = -1;
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    if (top[i].f === top[j].f) continue;
    const keep = train.filter((c) => pass(top[i], c) && pass(top[j], c));
    if (keep.length < 40) continue;
    const sc = rate(keep, "hit2");
    if (sc > bestScore) { bestScore = sc; best = [top[i], top[j]]; }
  }
  if (best) {
    console.log("\n== best 2-rule combo from train ==");
    const nm = (r: Rule) => `${r.f} ${r.dir} ${+r.cutoff.toFixed(3)}`;
    line(`TRAIN ${nm(best[0])} & ${nm(best[1]).slice(0, 18)}`, train.filter((c) => pass(best![0], c) && pass(best![1], c)));
    line(`TEST  (same rule)`, test.filter((c) => pass(best![0], c) && pass(best![1], c)));
    console.log(`  rule: ${nm(best[0])}  AND  ${nm(best[1])}`);
  }
  console.log("\nRead it like this: a rule is only worth shipping if its TEST 2x rate beats the all-calls TEST rate with the ranges not overlapping, and it keeps enough calls to be worth publishing.");
}
void main();
