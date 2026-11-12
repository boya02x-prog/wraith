/**
 * Chart-shape features for past calls, to test whether the model's accuracy (AUC) can improve.
 *
 * For every past call this reads the token's chart from Jupiter's chart data (the same source the app's charts use) ENDING AT THE MOMENT OF THE
 * CALL and computes numbers about how the price had behaved right before: how far it is from its high, how much it had already run, how
 * volatile, whether volume was picking up. Only candles that were already COMPLETE when the call was made are used, so nothing from the
 * future leaks in. The result is written to scripts/.pilot/cand.json and read by `research-model2.ts cand --paths`.
 *
 *   npx tsx scripts/backfill-candles.ts            resumable: run it again and it continues where it stopped
 * Read-only on the database. Calls Jupiter's public chart endpoint (no key), 3 at a time.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "scripts/.pilot/cand.json";
const H = 3_600_000;
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Row = { ok: boolean; f?: Record<string, number>; why?: string };
const done: Record<string, Row> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function chart(mint: string, toMs: number, interval: "1_MINUTE" | "15_MINUTE", n: number): Promise<Candle[] | null> {
  const url = `https://datapi.jup.ag/v2/charts/${mint}?interval=${interval}&to=${toMs}&candles=${n}&type=price&quote=usd`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!r.ok) return null;
      const j = (await r.json()) as { candles?: Candle[] };
      return Array.isArray(j.candles) ? j.candles.filter((c) => c.close > 0 && c.high > 0 && c.low > 0) : null;
    } catch { await sleep(800); }
  }
  return null;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

/** Pure: the numbers, from candles that had COMPLETELY closed before `spot`. Exported shape is the same as what research-model2 reads. */
export function chartFeatures(c15all: Candle[], c1all: Candle[], spot: number): Record<string, number> | null {
  const a = c15all.filter((c) => c.time * 1000 + 15 * 60_000 <= spot).sort((x, y) => x.time - y.time);
  if (a.length < 5) return null;
  const m1 = c1all.filter((c) => c.time * 1000 + 60_000 <= spot).sort((x, y) => x.time - y.time);
  const n = a.length;
  const pNow = m1.length ? m1[m1.length - 1].close : a[n - 1].close;
  if (!(pNow > 0)) return null;
  const f: Record<string, number> = {};
  f.cN15 = n; // how many 15-minute candles the token had (its age, capped by what was asked for)
  const at = (k: number) => (n - 1 - k >= 0 ? a[n - 1 - k].close : NaN);
  f.cRet1h = pNow / at(3) - 1;
  f.cRet4h = pNow / at(15) - 1;
  f.cRet12h = pNow / at(47) - 1;
  let hi = 0, hiIdx = 0;
  a.forEach((c, i) => { if (c.high > hi) { hi = c.high; hiIdx = i; } });
  f.cAth = pNow / hi; // 1 = at its high, 0.1 = already 90% off it
  f.cAthBars = (n - 1 - hiIdx) / n; // 0 = the high was just now
  const lows = a.slice(-48).map((c) => c.low);
  f.cLowDist = pNow / Math.min(...lows) - 1; // how far above its recent low
  const rets: number[] = [];
  for (let i = Math.max(1, n - 32); i < n; i++) rets.push(Math.log(a[i].close / a[i - 1].close));
  f.cVol = rets.length >= 8 ? sd(rets) : NaN;
  const v4 = a.slice(-4).reduce((s, c) => s + c.volume, 0);
  const vPrev = a.slice(-20, -4).map((c) => c.volume);
  f.cVolPick = vPrev.length >= 8 ? v4 / (mean(vPrev) * 4 + 1e-9) : NaN; // volume now vs before
  const last8 = a.slice(-8);
  f.cUp8 = last8.filter((c) => c.close > c.open).length / last8.length;
  const last4 = a.slice(-4);
  f.cRange1h = (Math.max(...last4.map((c) => c.high)) - Math.min(...last4.map((c) => c.low))) / pNow;
  f.cHigh16 = pNow / Math.max(...a.slice(-16).map((c) => c.close));
  f.c1mMom = m1.length >= 16 ? pNow / m1[m1.length - 16].close - 1 : NaN; // last 15 minutes
  for (const k of Object.keys(f)) if (!Number.isFinite(f[k])) delete f[k]; // missing stays missing (the model fills it in)
  return f;
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, features: { $exists: true }, spottedAt: { $lt: Date.now() - 24 * H }, $or: [{ chain: "solana" }, { chain: { $exists: false } }] },
      { projection: { address: 1, spottedAt: 1 } }).sort({ spottedAt: -1 }).toArray();
  await c.close();
  const todo = calls.filter((d) => !done[d.address as string]);
  console.log(`${calls.length} calls, ${calls.length - todo.length} already done, ${todo.length} to go`);
  let i = 0, ok = 0, fail = 0, saved = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (i < todo.length) {
      const d = todo[i++];
      const mint = d.address as string, spot = d.spottedAt as number;
      const [c15, c1] = await Promise.all([chart(mint, spot, "15_MINUTE", 300), chart(mint, spot, "1_MINUTE", 60)]);
      if (!c15 || c15.length < 5) { done[mint] = { ok: false, why: c15 ? "too few candles" : "no chart" }; fail++; }
      else {
        const f = chartFeatures(c15, c1 ?? [], spot);
        if (f) { done[mint] = { ok: true, f }; ok++; } else { done[mint] = { ok: false, why: "too young" }; fail++; }
      }
      await sleep(120);
      if ((ok + fail) % 100 === 0) {
        writeFileSync(OUT, JSON.stringify(done)); saved = ok + fail;
        const rate = (ok + fail) / ((Date.now() - t0) / 1000);
        console.log(`  ${ok + fail}/${todo.length}  ok ${ok}  none ${fail}  ${rate.toFixed(1)}/s  about ${Math.round((todo.length - ok - fail) / Math.max(0.1, rate) / 60)} min left`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeFileSync(OUT, JSON.stringify(done));
  void saved;
  console.log(`done: ${ok} with chart features, ${fail} without. Next: npx tsx scripts/research-model2.ts cand --paths`);
}
if (process.argv[1] && /backfill-candles/.test(process.argv[1])) void main();
