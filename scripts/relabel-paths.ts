/**
 * Rebuilds the REAL price path after each call from candle data, so labels stop depending on when the refresh job happened to look.
 *   npx tsx scripts/relabel-paths.ts [max=100]      (resumable: results are kept in scripts/.pilot/paths.json)
 * For each call older than 26h it finds the pool (DexScreener) and reads 5-minute candles from 1h before the call to 24h after it
 * (GeckoTerminal's free public endpoint). From those it computes: the true peak and trough,
 * when the price first doubled and when it first lost half, whether it doubled BEFORE losing half ("clean 2x"), and the price at
 * +1h / +6h / +24h. Read-only on the database, no Helius credits.
 *
 * Pace: GeckoTerminal's free public endpoint (no key, no signup) is shared with everything else on this connection (your dev
 * server) and allows only a few requests a minute here, so the job paces itself at about 4 a minute and simply runs for hours.
 * It is resumable, so stopping and restarting loses nothing. (A CoinGecko key was considered and dropped on purpose.)
 * scripts/relabel-helius.ts does the same job from on-chain trades for tokens that are not too busy.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dexPairs, emptyRec, pathStats, seriesOf, type Candle, type PathRec } from "./pathlib";

const OUT = "scripts/.pilot/paths.json";
const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";
const H: Record<string, string> = { accept: "application/json;version=20230302" };
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 100);
const GAP_MS = Number(process.env.GAP_MS ?? 15000);

let nextAt = 0;
async function gecko(url: string): Promise<{ s: number; j: unknown }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = Math.max(0, nextAt - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    nextAt = Date.now() + GAP_MS;
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res) continue;
    if (res.status === 429) { nextAt = Date.now() + 25_000; continue; } // brief pause: the allowance refills quickly
    return { s: res.status, j: await res.json().catch(() => null) };
  }
  return { s: 0, j: null };
}

async function candlesFor(pool: string, t0Sec: number): Promise<Candle[]> {
  const before = t0Sec + 24 * 3600 + 300;
  const u = `${GECKO}/pools/${pool}/ohlcv/minute?aggregate=5&limit=300&currency=usd&token=base&include_empty_intervals=false&before_timestamp=${before}`;
  const r = await gecko(u);
  if (r.s !== 200) return [];
  const list = (((r.j as { data?: { attributes?: { ohlcv_list?: unknown[] } } })?.data?.attributes?.ohlcv_list) ?? []) as unknown[];
  return list.filter((x): x is Candle => Array.isArray(x) && x.length >= 6).sort((a, b) => a[0] - b[0]);
}

async function main() {
  mkdirSync("scripts/.pilot", { recursive: true });
  const done: Record<string, PathRec> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  // calls the on-chain route already answered completely need no candles
  const chain: Record<string, PathRec> = existsSync("scripts/.pilot/paths-helius.json") ? JSON.parse(readFileSync("scripts/.pilot/paths-helius.json", "utf8")) : {};
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 26 * 3_600_000 }, address: { $regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ }, chain: { $in: [null, "solana"] } },
      { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, engine: 1, shadow: 1 } }).sort({ spottedAt: -1 }).toArray();
  await c.close();
  const answered = (a: string) => chain[a]?.ok && (chain[a].coverMin ?? 1440) >= 1380;
  // public engine-2 calls first (they are what the record and the model use), then shadow calls; busy tokens first, since the on-chain route skips them
  const todo = calls.filter((x) => !done[x.address as string] && !answered(x.address as string))
    .sort((a, b) => Number(b.engine === 2 && !b.shadow) - Number(a.engine === 2 && !a.shadow) || Number(chain[b.address as string]?.note === "busy") - Number(chain[a.address as string]?.note === "busy") || (b.spottedAt as number) - (a.spottedAt as number))
    .slice(0, MAX);
  console.log(`${calls.length} eligible calls, ${Object.keys(done).length} already done, doing ${todo.length}`);
  const pairs = await dexPairs(todo.map((x) => x.address as string));
  console.log(`pools found by DexScreener for ${pairs.size}/${todo.length}`);
  let n = 0, noPool = 0, bad = 0;
  const cmp: { rec: number; truth: number }[] = [];
  for (const t of todo) {
    const addr = t.address as string;
    const pool = pairs.get(addr)?.pair ?? null;
    // no pair on DexScreener usually means the token is dead (pool gone): do not spend a scarce candle request on it
    if (!pool) { done[addr] = { ...emptyRec(addr, null), src: "gecko" }; noPool++; continue; }
    const t0s = Math.floor((t.spottedAt as number) / 1000);
    const candles = await candlesFor(pool, t0s);
    const rec = { ...pathStats(addr, pool, candles, t0s), src: "gecko" as const };
    done[addr] = rec;
    if (rec.ok && rec.p0 > 0) {
      appendFileSync("scripts/.pilot/candles.jsonl", JSON.stringify({ addr, at: t.spottedAt, engine: t.engine ?? null, shadow: !!t.shadow, s: seriesOf(candles, rec.p0, t0s) }) + "\n");
    }
    if (!rec.ok) bad++; else cmp.push({ rec: Math.max(t.peakMcap as number, t.lastMcap as number) / (t.spottedMcap as number), truth: rec.peak24h });
    n++;
    if (n % 20 === 0) {
      writeFileSync(OUT, JSON.stringify(done));
      const miss = cmp.filter((x) => x.rec < 2 && x.truth >= 2).length, tw = cmp.filter((x) => x.truth >= 2).length, rw = cmp.filter((x) => x.rec >= 2).length;
      console.log(`  ${n}/${todo.length} done (${noPool} without a pool, ${bad} too few candles) | recorded winners ${rw}, true winners ${tw}, missed by the refresh job ${miss}`);
    }
  }
  writeFileSync(OUT, JSON.stringify(done));
  console.log(`\nfinished: ${n} with candles, ${noPool} without a pool, ${bad} too few candles. Total stored ${Object.keys(done).length}`);
  if (cmp.length >= 10) {
    const recWin = cmp.filter((x) => x.rec >= 2).length, truthWin = cmp.filter((x) => x.truth >= 2).length;
    const missed = cmp.filter((x) => x.rec < 2 && x.truth >= 2).length, phantom = cmp.filter((x) => x.rec >= 2 && x.truth < 2).length;
    console.log(`\nLABEL CHECK on ${cmp.length} calls: recorded as 2x winners ${recWin}, true 2x winners (peak within 24h from candles) ${truthWin}`);
    console.log(`  winners the refresh job MISSED (really doubled, recorded below 2x): ${missed}`);
    console.log(`  recorded as winners but the candles do not show 2x in the first 24h: ${phantom}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
