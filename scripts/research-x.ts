/**
 * Does early X chatter BEFORE the call separate winners from collapses?   npx tsx scripts/research-x.ts [maxCalls=450]   (read-only on the database)
 * Source: twitterapi.io advanced search (X_API_KEY in .env.local). For each public call from the last 6 days (24h+ old, so the outcome is known)
 * it fetches ONE page of tweets that contain the token's contract address, posted in the 6 hours BEFORE the call (nothing after the call
 * is used, so no hindsight). Results are kept in scripts/.pilot/x.json, so it can be stopped and resumed. It paces itself to the free
 * plan's one request per 5 seconds and stops BEFORE the free credits run out (it never needs a top-up). Then it compares 2x / 5x / collapse
 * rates between groups, with 95% ranges: only a gap with non-overlapping ranges counts as a finding.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEY = (process.env.X_API_KEY ?? "").trim();
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 450);
const OUT = "scripts/.pilot/x.json";
const STOP_BELOW = 3000; // credits: stop here, leave a reserve
interface Tw { u: string; f: number; t: string }
type Saved = Record<string, { n: number; more: boolean; tw: Tw[] }>;
const wilson = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function credits(): Promise<number> {
  try { const j = (await (await fetch("https://api.twitterapi.io/oapi/my/info", { headers: { "x-api-key": KEY } })).json()) as { recharge_credits?: number; total_bonus_credits?: number }; return (j.recharge_credits ?? 0) + (j.total_bonus_credits ?? 0); } catch { return -1; }
}

async function main() {
  if (!KEY) { console.error("Set X_API_KEY in .env.local"); process.exit(1); }
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3, $gt: Date.now() - 6 * 86400e3 }, spottedMcap: { $gt: 0 } },
      { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).sort({ spottedAt: -1 }).limit(MAX).toArray();
  await cli.close();
  const saved: Saved = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const c0 = await credits();
  console.log(`calls: ${docs.length}, already fetched: ${Object.keys(saved).length}, credits now: ${c0}`);
  let done = 0;
  for (const d of docs) {
    const id = `${d.address}:${d.spottedAt}`;
    if (saved[id]) continue;
    if (done % 20 === 0) { const c = await credits(); console.log(`  fetched ${Object.keys(saved).length}/${docs.length}  credits left: ${c}`); if (c >= 0 && c < STOP_BELOW) { console.log("  free credits nearly used up: stopping here (resume later or top up)."); break; } }
    const t = Math.floor(Number(d.spottedAt) / 1000);
    const q = `"${d.address}" since_time:${t - 6 * 3600} until_time:${t}`;
    let tries = 0;
    while (tries++ < 3) {
      try {
        const r = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?query=${encodeURIComponent(q)}&queryType=Latest`, { headers: { "x-api-key": KEY }, signal: AbortSignal.timeout(25000) });
        if (r.status === 429) { await sleep(6000); continue; }
        if (!r.ok) { console.log("  status", r.status, (await r.text()).slice(0, 120)); await sleep(6000); continue; }
        const j = (await r.json()) as { tweets?: { author?: { userName?: string; followers?: number }; createdAt?: string }[]; has_next_page?: boolean };
        saved[id] = { n: (j.tweets ?? []).length, more: !!j.has_next_page, tw: (j.tweets ?? []).map((x) => ({ u: x.author?.userName ?? "?", f: x.author?.followers ?? 0, t: x.createdAt ?? "" })) };
        break;
      } catch { await sleep(3000); }
    }
    done++;
    if (done % 10 === 0) writeFileSync(OUT, JSON.stringify(saved));
    await sleep(5500);
  }
  writeFileSync(OUT, JSON.stringify(saved));

  type Row = { authors: number; n: number; reach: number; hit2: boolean; hit5: boolean; coll: boolean };
  const rows: Row[] = [];
  for (const d of docs) {
    const s = saved[`${d.address}:${d.spottedAt}`]; if (!s) continue;
    const m = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap), Number(d.lastMcap)) / m, end = Number(d.lastMcap) / m;
    const byUser = new Map<string, number>(); for (const x of s.tw) byUser.set(x.u, Math.max(byUser.get(x.u) ?? 0, x.f));
    rows.push({ authors: byUser.size, n: s.n, reach: [...byUser.values()].reduce((a, b) => a + b, 0), hit2: peak >= 2, hit5: peak >= 5, coll: end < 0.2 });
  }
  console.log(`\ncalls with X data: ${rows.length}\n`);
  const line = (name: string, xs: Row[]) => { const k = xs.filter((x) => x.hit2).length, [lo, hi] = wilson(k, xs.length);
    console.log(`${name.padEnd(34)} n=${String(xs.length).padStart(4)}  2x ${pct(k / (xs.length || 1)).padStart(4)} (${pct(lo)}-${pct(hi)})  5x ${pct(xs.filter((x) => x.hit5).length / (xs.length || 1)).padStart(3)}  collapsed ${pct(xs.filter((x) => x.coll).length / (xs.length || 1)).padStart(4)}`); };
  line("ALL", rows);
  line("no tweets before the call", rows.filter((r) => r.n === 0));
  line("1+ tweets", rows.filter((r) => r.n >= 1));
  line("3+ different authors", rows.filter((r) => r.authors >= 3));
  line("6+ different authors", rows.filter((r) => r.authors >= 6));
  line("authors with 5K+ followers total", rows.filter((r) => r.reach >= 5000));
  line("authors with 50K+ followers total", rows.filter((r) => r.reach >= 50000));
  console.log("\n(read a group against ALL: only a clear gap with non-overlapping ranges is a finding)");
}
void main();
