/** Read-only: which call-time indicators separate calls that later collapse (<20% of call price) from the rest?  npx tsx scripts/research-rugs.ts */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
interface C { spottedAt: number; spottedMcap: number; peakMcap: number; lastMcap: number; tier: string; shadow?: boolean; badData?: boolean; features?: Record<string, number | null> }
async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const all = await c.db(process.env.MONGODB_DB || "wraith").collection<C>("signal_calls").find({ badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true } }).toArray();
  const rows = all.filter((x) => Date.now() - x.spottedAt > 24 * 3_600_000);
  const rug = (x: C) => x.lastMcap / x.spottedMcap <= 0.2;
  const base = rows.filter(rug).length / rows.length;
  console.log(`${rows.length} calls older than 24h with features; collapse rate ${(base * 100).toFixed(0)}%\n`);
  const keys = [...new Set(rows.flatMap((x) => Object.keys(x.features ?? {})))];
  const out: { k: string; lo: number; hi: number; n: number; qs: string }[] = [];
  for (const k of keys) {
    const v = rows.map((x) => ({ x, f: x.features?.[k] })).filter((r) => typeof r.f === "number" && Number.isFinite(r.f as number)) as { x: C; f: number }[];
    if (v.length < 300) continue;
    const s = [...v].sort((a, b) => a.f - b.f);
    const qn = 4, parts: number[] = [];
    let desc = "";
    for (let q = 0; q < qn; q++) {
      const g = s.slice(Math.floor((q * s.length) / qn), Math.floor(((q + 1) * s.length) / qn));
      const r = g.filter((t) => rug(t.x)).length / g.length;
      parts.push(r);
      desc += `${(r * 100).toFixed(0)}% `;
    }
    out.push({ k, lo: Math.min(...parts), hi: Math.max(...parts), n: v.length, qs: desc + `(range ${s[0].f.toFixed(2)}..${s[s.length - 1].f.toFixed(2)})` });
  }
  out.sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo));
  console.log("collapse rate by quartile (low -> high value), widest spread first:");
  for (const o of out.slice(0, 14)) console.log(`  ${o.k.padEnd(14)} n=${o.n}  ${o.qs}`);
  await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
