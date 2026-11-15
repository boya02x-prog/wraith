/**
 * Do tokens whose creator linked an X post / website / Telegram do better?   npx tsx scripts/research-links.ts   (read-only)
 * For every public call (24h+ old) it asks Jupiter's token info what the token links to TODAY, then compares 2x / 5x / collapse rates
 * by group, with 95% ranges. Links are set by the creator at launch, so they are mostly the same at call time, but a few can be added
 * later: a small leak, stated. Peaks are the corrected ones (audit-peaks).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

interface Info { id: string; twitter?: string; website?: string; telegram?: string; organicScore?: number; isVerified?: boolean; holderCount?: number }
const wilson = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } },
      { projection: { address: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await cli.close();
  const addrs = [...new Set(docs.map((d) => String(d.address)))];
  console.log(`public calls: ${docs.length}, tokens: ${addrs.length}`);
  const info = new Map<string, Info>();
  for (let i = 0; i < addrs.length; i += 40) {
    try {
      const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${addrs.slice(i, i + 40).join(",")}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) for (const t of (await r.json()) as Info[]) if (t.id) info.set(t.id, t);
    } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`token info found for ${info.size} tokens\n`);
  type Row = { g: Record<string, boolean>; hit2: boolean; hit5: boolean; coll: boolean };
  const rows: Row[] = [];
  for (const d of docs) {
    const t = info.get(String(d.address));
    if (!t) continue;
    const s = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap), Number(d.lastMcap)) / s, end = Number(d.lastMcap) / s;
    const tw = t.twitter ?? "", web = t.website ?? "", tg = t.telegram ?? "";
    rows.push({
      g: {
        "X linked": !!tw, "X linked to a specific post": /\/status\//i.test(tw), "X linked to an account (no post)": !!tw && !/\/status\//i.test(tw),
        "website linked": !!web, "Telegram linked": !!tg, "all three linked": !!tw && !!web && !!tg, "nothing linked": !tw && !web && !tg,
        "organic score >= 50": (t.organicScore ?? 0) >= 50, "organic score < 20": (t.organicScore ?? 100) < 20,
      },
      hit2: peak >= 2, hit5: peak >= 5, coll: end < 0.2,
    });
  }
  const line = (name: string, xs: Row[]) => {
    const k = xs.filter((x) => x.hit2).length, [lo, hi] = wilson(k, xs.length);
    console.log(`${name.padEnd(36)} n=${String(xs.length).padStart(4)}  2x ${pct(k / (xs.length || 1)).padStart(4)} (${pct(lo)}-${pct(hi)})  5x ${pct(xs.filter((x) => x.hit5).length / (xs.length || 1)).padStart(3)}  collapsed ${pct(xs.filter((x) => x.coll).length / (xs.length || 1)).padStart(4)}`);
  };
  line("ALL calls with token info", rows);
  for (const key of Object.keys(rows[0]?.g ?? {})) { line(key, rows.filter((r) => r.g[key])); }
  console.log("\n(read a group against ALL: only a clear gap with non-overlapping ranges is a finding)");
}
void main();
