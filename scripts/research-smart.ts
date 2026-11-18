/**
 * lore.trade tracks "smart money". Do OUR calls where proven wallets were already buying do better?   npx tsx scripts/research-smart.ts   (read-only)
 * Uses the intel the scanner recorded AT the call (smart = proven wallets buying, dumpers = known dumpers, flowBuyers = distinct fresh buyers).
 * Groups public calls (24h+ old) and compares 2x / 5x / collapse with 95% ranges. Only a gap with non-overlapping ranges is a finding.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
const wilson = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
(async () => {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } }, { projection: { features: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await cli.close();
  type R = { f: Record<string, number | null | undefined>; hit2: boolean; hit5: boolean; coll: boolean };
  const rows: R[] = docs.map((d) => { const m = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap), Number(d.lastMcap)) / m, end = Number(d.lastMcap) / m; return { f: (d.features ?? {}) as R["f"], hit2: peak >= 2, hit5: peak >= 5, coll: end < 0.2 }; });
  const line = (name: string, xs: R[]) => { const k = xs.filter((x) => x.hit2).length, [lo, hi] = wilson(k, xs.length);
    console.log(`${name.padEnd(38)} n=${String(xs.length).padStart(4)}  2x ${pct(k / (xs.length || 1)).padStart(4)} (${pct(lo)}-${pct(hi)})  5x ${pct(xs.filter((x) => x.hit5).length / (xs.length || 1)).padStart(3)}  collapsed ${pct(xs.filter((x) => x.coll).length / (xs.length || 1)).padStart(4)}`); };
  const has = (r: R, k: string) => r.f[k] !== null && r.f[k] !== undefined;
  console.log(`public calls: ${rows.length}\n`);
  line("ALL", rows);
  line("intel recorded (smart known)", rows.filter((r) => has(r, "smart")));
  line("1+ proven wallet buying (smart>=1)", rows.filter((r) => (r.f.smart ?? 0) >= 1));
  line("2+ proven wallets buying (smart>=2)", rows.filter((r) => (r.f.smart ?? 0) >= 2));
  line("no proven wallet (smart=0, intel known)", rows.filter((r) => has(r, "smart") && (r.f.smart ?? 0) === 0));
  line("a known dumper present (dumpers>=1)", rows.filter((r) => (r.f.dumpers ?? 0) >= 1));
  line("no dumper (intel known)", rows.filter((r) => has(r, "dumpers") && (r.f.dumpers ?? 0) === 0));
  line("15+ distinct fresh buyers", rows.filter((r) => (r.f.flowBuyers ?? 0) >= 15));
  line("under 15 fresh buyers (intel known)", rows.filter((r) => has(r, "flowBuyers") && (r.f.flowBuyers ?? 0) < 15));
  console.log("\n(read a group against ALL: only a clear gap with non-overlapping ranges is a finding)");
})();
