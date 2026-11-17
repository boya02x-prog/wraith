/** Does a token that PAID DexScreener (profile / boost / ad) BEFORE we called it do better?   npx tsx scripts/research-paid.ts   (read-only)
 * Source: api.dexscreener.com/orders/v1/solana/{mint} (free, has paymentTimestamp). Only payments made before the call count as a
 * "before" signal, so a token that paid after pumping cannot leak in. Peaks are the corrected ones. 95% ranges: only a gap with
 * non-overlapping ranges is a finding. */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
const wilson = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
interface Order { type?: string; status?: string; paymentTimestamp?: number }
async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } }, { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await cli.close();
  console.log(`public calls: ${docs.length}`);
  const orders = new Map<string, Order[] | null>();
  const addrs = [...new Set(docs.map((d) => String(d.address)))];
  for (let i = 0; i < addrs.length; i++) {
    try { const r = await fetch(`https://api.dexscreener.com/orders/v1/solana/${addrs[i]}`, { signal: AbortSignal.timeout(10000) }); orders.set(addrs[i], r.ok ? (((await r.json()) as { orders?: Order[] }).orders ?? []) : null); } catch { orders.set(addrs[i], null); }
    if (i % 100 === 0) console.log(`  looked up ${i}/${addrs.length}`);
    await new Promise((r) => setTimeout(r, 1100));
  }
  type Row = { g: Record<string, boolean>; hit2: boolean; hit5: boolean; coll: boolean };
  const rows: Row[] = [];
  for (const d of docs) {
    const o = orders.get(String(d.address)); if (o === null || o === undefined) continue;
    const t = Number(d.spottedAt), ok = o.filter((x) => x.status === "approved" || x.status === "processing");
    const before = ok.filter((x) => (x.paymentTimestamp ?? Infinity) <= t), anyTime = ok.length > 0;
    const s = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap), Number(d.lastMcap)) / s, end = Number(d.lastMcap) / s;
    rows.push({ g: {
      "paid anything BEFORE the call": before.length > 0,
      "paid profile BEFORE the call": before.some((x) => x.type === "tokenProfile"),
      "paid ad/boost/takeover BEFORE the call": before.some((x) => x.type !== "tokenProfile"),
      "paid nothing before the call": before.length === 0,
      "(leaky) paid anything at any time": anyTime,
    }, hit2: peak >= 2, hit5: peak >= 5, coll: end < 0.2 });
  }
  const line = (name: string, xs: Row[]) => { const k = xs.filter((x) => x.hit2).length, [lo, hi] = wilson(k, xs.length);
    console.log(`${name.padEnd(42)} n=${String(xs.length).padStart(4)}  2x ${pct(k / (xs.length || 1)).padStart(4)} (${pct(lo)}-${pct(hi)})  5x ${pct(xs.filter((x) => x.hit5).length / (xs.length || 1)).padStart(3)}  collapsed ${pct(xs.filter((x) => x.coll).length / (xs.length || 1)).padStart(4)}`); };
  console.log(""); line("ALL calls looked up", rows);
  for (const key of Object.keys(rows[0]?.g ?? {})) line(key, rows.filter((r) => r.g[key]));
}
void main();
