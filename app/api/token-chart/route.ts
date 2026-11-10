// app/api/token-chart/route.ts
// OHLCV candles for one Solana token.
//
// What was wrong before (why charts "never loaded"):
//   * the browser aborted after 2.5s while this route waited up to 8s on
//     Birdeye + Gecko (and on-chain RPC walks that take minutes) -> empty chart
//   * every request re-resolved the pool through a separate Gecko call and
//     burned the free rate limit (30/min) -> 429 -> circuit breaker -> nothing
//   * candles had holes wherever nobody traded, so the chart looked broken
//
// Now:
//   1. pool resolved once per mint (DexScreener, Gecko fallback) and cached
//   2. GeckoTerminal OHLCV is the fast path; Birdeye races it as backup
//   3. on-chain pump.fun reconstruction only runs if both fail, and is capped
//   4. gaps are forward-filled and the series is extended to "now"
//   5. last good series is served (marked stale) if every provider fails

import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { Connection } from "@solana/web3.js";
import { fromPumpFunOnChain } from "@/lib/onchain-pumpfun";
import { SOLANA_MINT_RE } from "@/lib/market";
import { getDb } from "@/lib/mongoClient";
import {
  arr,
  GECKO,
  GECKO_HEADERS,
  getJson,
  getSolUsd,
  INC,
  num,
  obj,
  resolvePool,
} from "@/lib/marketProviders";
import { getSandboxToken, sandboxCandles } from "@/lib/devnetTokens";
import { fetchTokenSwaps, swapsToCandles } from "@/lib/heliusSwaps";
import { candlesFromOwnTrades, noteWatch } from "@/lib/ownTrades";

interface Candle {
  t: number; // bucket start, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // USD volume
}

interface Tf {
  geckoTf: "minute" | "hour" | "day";
  geckoAgg: number;
  birdeyeType: string;
  sec: number;
  limit: number;
}

const TF: Record<string, Tf> = {
  "1m": { geckoTf: "minute", geckoAgg: 1, birdeyeType: "1m", sec: 60, limit: 300 },
  "5m": { geckoTf: "minute", geckoAgg: 5, birdeyeType: "5m", sec: 300, limit: 300 },
  "15m": { geckoTf: "minute", geckoAgg: 15, birdeyeType: "15m", sec: 900, limit: 300 },
  "1h": { geckoTf: "hour", geckoAgg: 1, birdeyeType: "1H", sec: 3600, limit: 300 },
  "4h": { geckoTf: "hour", geckoAgg: 4, birdeyeType: "4H", sec: 14400, limit: 300 },
  "1d": { geckoTf: "day", geckoAgg: 1, birdeyeType: "1D", sec: 86400, limit: 300 },
};

const MAX_POINTS = 400;
const CACHE_MS = 10_000;
const STALE_MS = 30 * 60_000;
const ONCHAIN_BUDGET_MS = 12_000;

const cache = new Map<string, { candles: Candle[]; source: string; ts: number }>();
const lastGood = new Map<string, { candles: Candle[]; source: string; ts: number }>();
const inflight = new Map<string, Promise<{ candles: Candle[]; source: string } | null>>();
// After every provider failed for a token, answer "nothing yet" for a short while instead of hitting them all again on the
// next poll (the chart polls every few seconds, which is what used up the GeckoTerminal budget).
const EMPTY_TTL_MS = 20_000;
const emptyUntil = new Map<string, number>();

// ── circuit breaker (per provider) ──────────────────────────────────────
const downUntil: Record<string, number> = { gecko: 0, birdeye: 0, paprika: 0 };
const isDown = (k: string) => Date.now() < (downUntil[k] ?? 0);
const markDown = (k: string, ms = 60_000) => {
  downUntil[k] = Date.now() + ms;
};

let _conn: Connection | null = null;
function connection(): Connection {
  if (!_conn) {
    const url =
      process.env.SOLANA_RPC_URL ||
      process.env.NEXT_PUBLIC_SOLANA_RPC ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com";
    _conn = new Connection(url, { disableRetryOnRateLimit: true });
  }
  return _conn;
}

// ── providers ───────────────────────────────────────────────────────────
async function fromGecko(mint: string, tf: Tf): Promise<Candle[] | null> {
  if (isDown("gecko")) return null;
  const pool = await resolvePool(mint);
  if (!pool) return null;
  try {
    const url =
      `${GECKO}/pools/${pool}/ohlcv/${tf.geckoTf}?aggregate=${tf.geckoAgg}` +
      `&limit=${tf.limit}&currency=usd&token=base&include_empty_intervals=false`;
    const payload = obj(await getJson(url, GECKO_HEADERS, 5000));
    const list = arr(obj(obj(payload.data).attributes).ohlcv_list);
    const candles: Candle[] = [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 6) continue;
      candles.push({ t: num(row[0]) * 1000, o: num(row[1]), h: num(row[2]), l: num(row[3]), c: num(row[4]), v: num(row[5]) });
    }
    return candles.length ? candles : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[token-chart] gecko ohlcv failed:", msg);
    if (msg.startsWith("429")) markDown("gecko", 45_000);
    return null;
  }
}

// DexPaprika: free, no key. Used when GeckoTerminal is rate-limited or has nothing. The response is parsed
// defensively and anything unexpected simply returns null, so the other sources still apply.
const PAPRIKA = "https://api.dexpaprika.com";
const PAP_INT: Record<string, { i: string; mult: number }> = {
  "1m": { i: "1m", mult: 1 }, "5m": { i: "5m", mult: 1 }, "15m": { i: "15m", mult: 1 },
  "1h": { i: "1h", mult: 1 }, "4h": { i: "1h", mult: 4 }, "1d": { i: "24h", mult: 1 },
};
async function fromPaprika(mint: string, tf: Tf): Promise<Candle[] | null> {
  if (isDown("paprika")) return null;
  const key = Object.keys(TF).find((k) => TF[k] === tf) ?? "15m";
  const m = PAP_INT[key];
  const pool = await resolvePool(mint);
  if (!pool) return null;
  const baseSec = tf.sec / m.mult;
  const limit = Math.min(360, tf.limit * m.mult);
  const start = new Date(Date.now() - baseSec * 1000 * limit).toISOString();
  try {
    const payload = await getJson(
      `${PAPRIKA}/networks/solana/pools/${pool}/ohlcv?start=${encodeURIComponent(start)}&limit=${limit}&interval=${m.i}`,
      undefined,
      6000,
    );
    const list = Array.isArray(payload) ? payload : arr(obj(payload).ohlcv ?? obj(payload).data ?? obj(payload).candles);
    const rows: Candle[] = [];
    for (const raw of list) {
      const r = obj(raw);
      const tv = r.time_open ?? r.time ?? r.timestamp;
      const t = typeof tv === "string" ? Date.parse(tv) : num(tv) < 1e12 ? num(tv) * 1000 : num(tv);
      const c: Candle = { t, o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.close), v: num(r.volume) };
      if (Number.isFinite(t) && c.o > 0 && c.c > 0) rows.push(c);
    }
    if (!rows.length) return null;
    return m.mult > 1 ? resample(rows, tf.sec) : rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[token-chart] dexpaprika failed:", msg);
    if (msg.startsWith("429")) markDown("paprika", 2 * 60_000);
    if (msg.startsWith("402")) markDown("paprika", 30 * 60_000); // payment required: stop asking for a while
    return null;
  }
}

async function fromBirdeye(mint: string, tf: Tf): Promise<Candle[] | null> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key || isDown("birdeye")) return null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - tf.sec * tf.limit;
  try {
    const payload = obj(
      await getJson(
        `https://public-api.birdeye.so/defi/ohlcv?address=${mint}&type=${tf.birdeyeType}&time_from=${from}&time_to=${now}`,
        { "X-API-KEY": key, "x-chain": "solana" },
        5000,
      ),
    );
    const items = arr(obj(payload.data).items).map(obj);
    const candles = items.map((i) => ({ t: num(i.unixTime) * 1000, o: num(i.o), h: num(i.h), l: num(i.l), c: num(i.c), v: num(i.v) * num(i.c) }));
    return candles.length ? candles : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[token-chart] birdeye failed:", msg);
    // 400 here has meant "compute units usage limit exceeded" (monthly quota): no point asking again for an hour.
    if (msg.startsWith("400") || msg.startsWith("401") || msg.startsWith("403")) markDown("birdeye", 60 * 60_000);
    else if (msg.startsWith("429")) markDown("birdeye", 5 * 60_000);
    return null;
  }
}

// Helius parsed swaps -> candles. Independent of every candle indexer, so a rate-limited Gecko/Birdeye never blanks the chart.
async function fromHelius(mint: string, tf: Tf): Promise<Candle[] | null> {
  const swaps = await fetchTokenSwaps(mint, 3);
  if (!swaps || swaps.length < 1) { console.warn("[token-chart] helius: no swaps for", mint.slice(0, 6)); return null; }
  const rows = await swapsToCandles(swaps, tf.sec);
  return rows.length ? rows : null;
}

async function fromOnChain(mint: string, tf: Tf): Promise<Candle[] | null> {
  if (!mint.endsWith("pump")) return null; // on-chain reconstruction only understands pump.fun curves/pools
  const work = fromPumpFunOnChain(mint, { pumpIntervalSec: tf.sec }, connection(), getSolUsd).then((rows) =>
    rows ? rows.map((r) => ({ ...r, v: 0 })) : null,
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ONCHAIN_BUDGET_MS));
  return Promise.race([work, timeout]).catch(() => null);
}

// ── resampling: build a coarser timeframe from finer candles we already hold ──
function resample(rows: Candle[], sec: number): Candle[] {
  const step = sec * 1000;
  const out = new Map<number, Candle>();
  for (const r of [...rows].sort((a, b) => a.t - b.t)) {
    const t = Math.floor(r.t / step) * step;
    const cur = out.get(t);
    if (!cur) out.set(t, { ...r, t });
    else {
      cur.h = Math.max(cur.h, r.h);
      cur.l = Math.min(cur.l, r.l);
      cur.c = r.c;
      cur.v += r.v;
    }
  }
  return [...out.values()];
}
const FINER: Record<string, string[]> = {
  "5m": ["1m"], "15m": ["5m", "1m"], "1h": ["15m", "5m", "1m"], "4h": ["1h", "15m", "5m"], "1d": ["4h", "1h", "15m"],
};
async function deriveFromFiner(mint: string, tfKey: string, sec: number): Promise<{ candles: Candle[]; source: string } | null> {
  for (const fk of FINER[tfKey] ?? []) {
    const k = `${mint}:${fk}`;
    const src = cache.get(k) ?? lastGood.get(k) ?? (await readSaved(k));
    if (src && src.candles.length >= 3) {
      const candles = clean(resample(src.candles, sec), sec);
      if (candles.length >= 3) return { candles, source: `derived-${fk}` };
    }
  }
  return null;
}

// ── cleaning ────────────────────────────────────────────────────────────
function clean(rows: Candle[], sec: number): Candle[] {
  const byT = new Map<number, Candle>();
  for (const r of rows) {
    if (![r.t, r.o, r.h, r.l, r.c].every(Number.isFinite) || r.o <= 0 || r.h <= 0 || r.l <= 0 || r.c <= 0) continue;
    const t = Math.floor(r.t / (sec * 1000)) * sec * 1000;
    const body = { hi: Math.max(r.o, r.c), lo: Math.min(r.o, r.c) };
    // A single bad print can make a wick 1000x the body and flatten the whole chart.
    const h = r.h > body.hi * 100 ? body.hi : Math.max(r.h, body.hi);
    const l = r.l < body.lo / 100 ? body.lo : Math.min(r.l, body.lo);
    byT.set(t, { t, o: r.o, h, l, c: r.c, v: Number.isFinite(r.v) && r.v > 0 ? r.v : 0 });
  }
  const sorted = [...byT.values()].sort((a, b) => a.t - b.t);
  if (!sorted.length) return sorted;

  // Chain candles: open = previous close so there are no visual gaps.
  const filled: Candle[] = [];
  const step = sec * 1000;
  const nowBucket = Math.floor(Date.now() / step) * step;
  let prev: Candle | null = null;
  const lastT = Math.max(sorted[sorted.length - 1].t, nowBucket);
  const byTime = new Map(sorted.map((c) => [c.t, c]));
  for (let t = sorted[0].t; t <= lastT && filled.length < 5000; t += step) {
    const real = byTime.get(t);
    if (real) {
      const o = prev ? prev.c : real.o;
      filled.push({ ...real, o, h: Math.max(real.h, o), l: Math.min(real.l, o) });
      prev = filled[filled.length - 1];
    } else if (prev) {
      filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      prev = filled[filled.length - 1];
    }
  }
  return filled.slice(-MAX_POINTS);
}

// ── orchestration ───────────────────────────────────────────────────────
const MIN_GOOD = 3;
const OWN_WIN_MIN = 30; // our own recorded trades must cover this many candles to beat the indexers outright

async function load(mint: string, tf: Tf, onCurve = false): Promise<{ candles: Candle[]; source: string } | null> {
  // Race Gecko and Birdeye simultaneously — take the first provider that returns
  // MIN_GOOD candles.  This avoids waiting for Gecko to time-out (8 s on 429)
  // before we even look at the Birdeye result that was ready 6 s earlier.
  const geckoJob = fromGecko(mint, tf);
  const birdeyeJob = fromBirdeye(mint, tf);
  // When Gecko is already known to be limited, start the fallback source immediately.
  const papJob = isDown("gecko") ? fromPaprika(mint, tf) : null;
  // Our own recorded trades first (free). Helius is only asked when they are not enough, so its credits are not burned.
  const ownJob = candlesFromOwnTrades(mint, tf.sec, tf.limit);
  const helJob = ownJob.then((own) => (own && own.length >= OWN_WIN_MIN ? null : fromHelius(mint, tf)));

  type Tagged = { rows: Candle[]; source: string };
  const toTagged = (rows: Candle[] | null, src: string): Tagged | null =>
    rows && rows.length >= MIN_GOOD ? { rows, source: src } : null;

  const winner = await Promise.any([
    geckoJob.then((r) => {
      const t = toTagged(r, "geckoterminal");
      if (!t) throw new Error("gecko: insufficient");
      return t;
    }),
    birdeyeJob.then((r) => {
      const t = toTagged(r, "birdeye");
      if (!t) throw new Error("birdeye: insufficient");
      return t;
    }),
    (async () => {
      const r = await ownJob;
      if (!r || r.length < OWN_WIN_MIN) throw new Error("own: insufficient"); // shorter than this: only used as a last resort (sparse)
      // Our worker only knows trades since it started watching, so give the indexers a short head start for longer history.
      await new Promise((res) => setTimeout(res, isDown("gecko") ? 0 : 250));
      return { rows: r, source: "wraith-trades" } as Tagged;
    })(),
    (async () => {
      // Give the indexers a head start (they carry longer history); Helius answers fast when they do not.
      await new Promise((r) => setTimeout(r, isDown("gecko") ? 0 : 350));
      const r = await helJob;
      // 1-2 candles built from the last few trades is a stub, not a chart: only accept it as a last resort below
      if (!r || r.length < MIN_GOOD) throw new Error("helius: insufficient");
      return { rows: r, source: "helius" } as Tagged;
    })(),
    (async () => {
      if (!papJob) throw new Error("paprika idle");
      const r = await papJob;
      if (!r || r.length < MIN_GOOD) throw new Error("paprika: insufficient");
      return { rows: r, source: "dexpaprika" } as Tagged;
    })(),
    // pump.fun tokens (esp. bonding curve) often have no indexer candles: start the on-chain rebuild
    // in parallel after a short head start instead of only after both providers finish/time out.
    (async () => {
      if (!mint.endsWith("pump") || !onCurve) throw new Error("not on curve");
      await new Promise((r) => setTimeout(r, 1200));
      const rows = await fromOnChain(mint, tf);
      const t = rows && rows.length ? { rows, source: "pumpfun-onchain" } : null;
      if (!t) throw new Error("onchain: empty");
      return t;
    })(),
  ]).catch(() => null as Tagged | null);

  if (winner) {
    const candles = clean(winner.rows, tf.sec);
    if (candles.length) return { candles, source: winner.source };
  }

  // Gecko answered nothing usable: try DexPaprika before the slow on-chain rebuild.
  const pap = papJob ? await papJob : await fromPaprika(mint, tf);
  if (pap && pap.length >= MIN_GOOD) {
    const candles = clean(pap, tf.sec);
    if (candles.length) return { candles, source: "dexpaprika" };
  }

  // On-chain fallback (pump.fun tokens only, capped to ONCHAIN_BUDGET_MS).
  const onchain = onCurve ? await fromOnChain(mint, tf) : null; // graduated tokens: curve history is useless and burns RPC credits
  if (onchain && onchain.length) {
    const candles = clean(onchain, tf.sec);
    if (candles.length) return { candles, source: "pumpfun-onchain" };
  }

  // Sparse-but-real beats nothing (brand-new token with 1-2 trades).
  const [gecko, birdeye, hel, own] = await Promise.all([geckoJob, birdeyeJob, helJob, ownJob]);
  const sparse = [gecko, birdeye, own, hel].find((x) => x && x.length);
  if (sparse) {
    const candles = clean(sparse, tf.sec);
    if (candles.length) return { candles, source: "sparse" };
  }
  return null;
}

// ── persistent history (MongoDB) ────────────────────────────────────────
// Every good provider result is merged into Mongo. After a restart / on a cold instance / when a provider is
// rate-limited, the chart opens instantly from here and refreshes in the background.
const SAVED_MAX_AGE_MS = 24 * 3600_000;
const SAVED_KEEP = 800; // ~70KB per saved chart; the UI never asks for more than 300 candles
async function readSaved(key: string): Promise<{ candles: Candle[]; source: string; ts: number } | null> {
  try {
    const db = await Promise.race([getDb(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("db timeout")), 1500))]);
    const doc = await db.collection("chart_candles").findOne({ _id: key as never });
    if (!doc || !Array.isArray(doc.candles) || !doc.candles.length) return null;
    const ts = typeof doc.ts === "number" ? doc.ts : 0;
    if (Date.now() - ts > SAVED_MAX_AGE_MS) return null;
    return { candles: doc.candles as Candle[], source: String(doc.source ?? "saved"), ts };
  } catch {
    return null;
  }
}
function persist(key: string, fresh: Candle[], source: string) {
  void (async () => {
    try {
      const db = await getDb();
      const col = db.collection("chart_candles");
      const prev = await col.findOne({ _id: key as never });
      const byT = new Map<number, Candle>();
      if (prev && Array.isArray(prev.candles)) for (const c of prev.candles as Candle[]) byT.set(c.t, c);
      for (const c of fresh) byT.set(c.t, c);
      const merged = [...byT.values()].sort((a, b) => a.t - b.t).slice(-SAVED_KEEP);
      await col.updateOne({ _id: key as never }, { $set: { candles: merged, source, ts: Date.now(), at: new Date() } }, { upsert: true });
    } catch { /* optional */ }
  })();
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("address") ?? req.nextUrl.searchParams.get("mint") ?? "";
  const tfKey = req.nextUrl.searchParams.get("tf") ?? "15m";
  if (!SOLANA_MINT_RE.test(mint)) {
    return NextResponse.json({ candles: [], error: "Invalid Solana mint" }, { status: 400 });
  }
  const tf = TF[tfKey] ?? TF["15m"];
  const sandboxTok = await getSandboxToken(mint);
  if (sandboxTok) {
    const solUsd = await getSolUsd();
    return NextResponse.json({ candles: sandboxCandles(sandboxTok.priceSol * solUsd, tf.sec), source: "sandbox", intervalSec: tf.sec, updatedAt: Date.now() });
  }
  const key = `${mint}:${tfKey in TF ? tfKey : "15m"}`;
  noteWatch(mint); // the ingest worker starts recording this token's trades

  let hit = cache.get(key);
  let fromSaved = false;
  if (!hit) {
    const saved = await readSaved(key);
    if (saved) { hit = saved; fromSaved = true; }
  }
  if (hit && Date.now() - hit.ts < CACHE_MS) {
    return edge(NextResponse.json({ candles: hit.candles, source: hit.source, intervalSec: tf.sec, updatedAt: hit.ts }), 5, 30);
  }

  // Stale-while-revalidate: anything we've seen in the last 30 min is served instantly, refreshed in the background.
  if (hit && (fromSaved || Date.now() - hit.ts < STALE_MS)) {
    if (!inflight.has(key)) {
      const bg = load(mint, tf, req.nextUrl.searchParams.get("curve") === "1")
        .then((r) => {
          if (r) { cache.set(key, { ...r, ts: Date.now() }); persist(key, r.candles, r.source); }
          return r;
        })
        .catch(() => null)
        .finally(() => inflight.delete(key));
      inflight.set(key, bg);
    }
    return NextResponse.json({ candles: hit.candles, source: hit.source, ...(Date.now() - hit.ts > 120_000 ? { stale: true } : {}), intervalSec: tf.sec, updatedAt: hit.ts });
  }

  if ((emptyUntil.get(key) ?? 0) > Date.now() && !inflight.has(key)) {
    const stale = lastGood.get(key);
    if (stale && Date.now() - stale.ts < STALE_MS) return NextResponse.json({ candles: stale.candles, source: stale.source, stale: true, intervalSec: tf.sec, updatedAt: stale.ts });
    return NextResponse.json({ candles: [], source: "none", intervalSec: tf.sec });
  }

  const t0 = Date.now();
  let job = inflight.get(key);
  if (!job) {
    job = load(mint, tf, req.nextUrl.searchParams.get("curve") === "1")
      .catch((e) => {
        console.error("[token-chart] load threw", e);
        return null;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const result = await job;
  console.log(`[token-chart] ${mint.slice(0, 6)} ${tfKey} ${result ? result.source : "none"} ${Date.now() - t0}ms`);

  if (result) {
    const entry = { ...result, ts: Date.now() };
    emptyUntil.delete(key);
    cache.set(key, entry);
    if (result.source !== "sparse" || !lastGood.has(key)) persist(key, result.candles, result.source);
    // Never let a thin result overwrite a richer one we already served.
    const prev = lastGood.get(key);
    if (!prev || result.candles.length >= prev.candles.length * 0.5 || result.source !== "sparse") {
      lastGood.set(key, entry);
    }
    if (cache.size > 400) {
      for (const [k, v] of cache) if (Date.now() - v.ts > 120_000) cache.delete(k);
    }
    return edge(NextResponse.json({ candles: result.candles, source: result.source, intervalSec: tf.sec, updatedAt: entry.ts }), 5, 30);
  }

  const stale = lastGood.get(key);
  if (stale && Date.now() - stale.ts < STALE_MS) {
    return NextResponse.json({ candles: stale.candles, source: stale.source, stale: true, intervalSec: tf.sec, updatedAt: stale.ts });
  }
  // Every provider failed: build this timeframe from a finer one we already have, so the chart never opens empty.
  const derived = await deriveFromFiner(mint, tfKey in TF ? tfKey : "15m", tf.sec);
  if (derived) {
    cache.set(key, { ...derived, ts: Date.now() - CACHE_MS + 3000 });
    return NextResponse.json({ candles: derived.candles, source: derived.source, derived: true, stale: true, intervalSec: tf.sec, updatedAt: Date.now() });
  }
  emptyUntil.set(key, Date.now() + EMPTY_TTL_MS);
  if (emptyUntil.size > 500) for (const [k, v] of emptyUntil) if (v < Date.now()) emptyUntil.delete(k);
  return NextResponse.json({ candles: [], source: "none", intervalSec: tf.sec });
}
