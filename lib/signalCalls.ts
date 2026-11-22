// lib/signalCalls.ts  (server only)
// Shared, server-side record of every token Wraith flagged. One copy for all
// users, so spotted / now / peak are identical everywhere and keep updating
// whenever anyone has the app open.

import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, getJson, getSolUsd, obj, parseDexPair } from "@/lib/marketProviders";
import { liveEvmMcaps } from "@/lib/evmScan";
import { EVM_ADDR_RE } from "@/lib/chains";
import { learnMatured } from "@/lib/walletLearn";
import type { SignalIntel } from "@/lib/signalIntel";

export interface SignalCall {
  address: string;
  chain?: string;
  symbol: string;
  name?: string;
  imageUrl?: string;
  spottedAt: number;
  spottedMcap: number;
  peakMcap: number;
  lastMcap: number;
  lastCheck: number;
  tier: "HOT" | "WATCH";
  score: number;
  /** true = tracked only to learn from (never shown, never counted in the public record, never alerted) */
  shadow?: boolean;
  /** which scanner version made the call (missing = original scanner) */
  engine?: number;
  /** numeric snapshot of every indicator at call time (see featuresOf), used by /api/signal-lab */
  features?: Record<string, number | null>;
  /** wallets that were buying when the call was made, for the wallet scoreboard (server only) */
  buyers?: string[];
  learned?: boolean;
  /** the price source stopped returning this token for hours: treated as collapsed (rug / pulled liquidity) */
  rugged?: boolean;
  misses?: number;
  lastSeenAt?: number;
  /** when the stored peak was last compared with the real chart candles (see healPeaks) */
  peakCheckedAt?: number;
  /** the peak the price feed had claimed before the chart showed it was too high (kept so a correction can be traced) */
  peakWas?: number;
}

const COLLECTION = "signal_calls";
const WINDOW_MS = 7 * 24 * 3_600_000;
const REFRESH_EVERY_MS = 8_000;
/** calls re-priced per run (30 per DexScreener request, all requests in parallel) */
const REFRESH_BATCH = 270;
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;
let indexed = false;

async function col() {
  const db = await getDb();
  const c = db.collection<SignalCall>(COLLECTION);
  if (!indexed) {
    indexed = true;
    await c.createIndex({ address: 1 }, { unique: true }).catch(() => undefined);
    await c.createIndex({ spottedAt: -1 }).catch(() => undefined);
  }
  return c;
}

/** Live market caps straight from DexScreener (batched, <= 30 mints). */

/** Largest rise the REAL candles show since a call: highest price after the call divided by the price at the call (Jupiter's chart data,
 *  the same source as the chart on the token page). Used to check a claimed 10x+ peak: the market-cap feed can return a wrong number for
 *  a thin or wrong pool (LOS was "recorded" at 14M market cap and a 396x win while its chart peaked near 2.7x). null = could not check. */
export async function chartRise(mint: string, fromMs: number): Promise<number | null> {
  try {
    const r = await fetch(`https://datapi.jup.ag/v2/charts/${mint}?interval=15_MINUTE&to=${Date.now()}&candles=300&type=price&quote=usd`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { candles?: { time: number; high: number; close: number }[] };
    const cs = (j.candles ?? []).filter((c) => c.high > 0);
    if (cs.length < 3) return null;
    const t0 = fromMs / 1000;
    // the chart only reaches back about 3 days: a call older than that has no price at the call to compare against
    if (cs[0].time > t0 + 1800) return null;
    const at = cs.find((c) => c.time + 900 > t0);
    if (!at) return null;
    const base = at.close > 0 ? at.close : at.high;
    const hi = Math.max(...cs.filter((c) => c.time + 900 > t0).map((c) => c.high));
    return base > 0 ? hi / base : null;
  } catch { return null; }
}

/**
 * The highest market cap the REAL candles show since a call, so a peak the price feed claims can be compared with what a person sees when they
 * open the chart (it is the same Jupiter data). pump.fun tokens always have exactly 1,000,000,000 supply, so price x 1B is exact and the margin is
 * small; for any other token the candle rise since the call is applied to the called market cap (rougher, so the margin is wider).
 * `margin` = how far above `peakMcap` a claim may be before it counts as wrong. null = could not check (no candles, or the chart does not reach
 * back to the call).
 *
 * This exists because one wrong reading was kept forever as the "peak": CI was called at $11.2K, its chart topped out near $74K (6.6x), yet the
 * record said $131.8K (11.7x) and the bell announced "hit 10x" for a token that never did.
 */
export async function chartPeak(mint: string, fromMs: number, spottedMcap: number): Promise<{ peakMcap: number; margin: number; hiAt: number } | null> {
  try {
    const r = await fetch(`https://datapi.jup.ag/v2/charts/${mint}?interval=15_MINUTE&to=${Date.now()}&candles=300&type=price&quote=usd`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { candles?: { time: number; high: number; close: number }[] };
    const cs = (j.candles ?? []).filter((c) => c.high > 0);
    if (cs.length < 3) return null;
    const t0 = fromMs / 1000;
    if (cs[0].time > t0 + 1800) return null; // the chart only reaches back about 3 days
    const after = cs.filter((c) => c.time + 900 > t0);
    if (!after.length) return null;
    const top = after.reduce((a, b) => (b.high > a.high ? b : a), after[0]);
    if (mint.endsWith("pump")) return { peakMcap: top.high * 1e9, margin: 1.25, hiAt: top.time * 1000 };
    const base = after[0].close > 0 ? after[0].close : after[0].high;
    return base > 0 && spottedMcap > 0 ? { peakMcap: spottedMcap * (top.high / base), margin: 1.6, hiAt: top.time * 1000 } : null;
  } catch { return null; }
}

/**
 * Re-checks the stored peak of recent calls that claim 2x or more (2x is where the public record counts a win) against the real candles, a few per run, each at most every 6 hours, and
 * lowers the ones the chart does not support. Peaks only ever went up (`$max`), so a single bad reading from before the check above existed
 * stayed in the record, the Wins list and the bell until now.
 */
async function healPeaks(c: Awaited<ReturnType<typeof col>>) {
  const now = Date.now();
  const rows = await c.find(
    {
      engine: 2, shadow: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $gt: now - 70 * 3_600_000 },
      $expr: { $gte: ["$peakMcap", { $multiply: ["$spottedMcap", 2] }] },
      $or: [{ peakCheckedAt: { $exists: false } }, { peakCheckedAt: { $lt: now - 6 * 3_600_000 } }],
    },
    { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } },
  ).sort({ spottedAt: -1 }).limit(4).toArray();
  await Promise.all(rows.map(async (d) => {
    const real = await chartPeak(d.address, d.spottedAt, d.spottedMcap);
    // could not check (no chart for it): look again in 30 minutes instead of every run, so the same few rows do not block the others
    if (!real) return c.updateOne({ address: d.address }, { $set: { peakCheckedAt: now - 5.5 * 3_600_000 } }).catch(() => undefined);
    if (d.peakMcap <= real.peakMcap * real.margin) return c.updateOne({ address: d.address }, { $set: { peakCheckedAt: now } }).catch(() => undefined);
    const fixed = Math.max(real.peakMcap, d.spottedMcap);
    return c.updateOne(
      { address: d.address },
      { $set: { peakMcap: fixed, peakWas: d.peakMcap, peakAt: real.hiAt, peakCheckedAt: now }, ...(fixed < d.spottedMcap * 2 ? { $unset: { hit2xAt: "" } } : {}) },
    ).catch(() => undefined);
  }));
}

export async function liveMcaps(items: ({ address: string; chain?: string } | string)[]): Promise<Map<string, number>> {
  const norm = items.map((i) => (typeof i === "string" ? { address: i, chain: undefined } : i));
  const evmItems = norm.filter((i) => i.chain && i.chain !== "solana").map((i) => ({ address: i.address, chain: i.chain as string }));
  const evm = evmItems.length ? await liveEvmMcaps(evmItems) : new Map<string, number>();
  const mints = norm.filter((i) => !i.chain || i.chain === "solana").map((i) => i.address);
  const sol = await liveSolMcaps(mints);
  for (const [k, v] of evm) sol.set(k, v);
  return sol;
}

async function liveSolMcaps(mints: string[]): Promise<Map<string, number>> {
  const list = mints.filter((m, i, a) => SOLANA_MINT_RE.test(m) && a.indexOf(m) === i).slice(0, 30);
  const out = new Map<string, number>();
  if (!list.length) return out;
  try {
    const solUsd = await getSolUsd();
    const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${list.join(",")}`, undefined, 9000));
    const bestLiq = new Map<string, number>();
    for (const p of pairs) {
      const t = parseDexPair(obj(p), solUsd);
      if (!t || !(t.mcap > 0)) continue;
      if ((bestLiq.get(t.address) ?? -1) < t.liquidity) {
        bestLiq.set(t.address, t.liquidity);
        out.set(t.address, t.mcap);
      }
    }
  } catch {
    /* caller keeps previous values */
  }
  return out;
}

export interface RecordInput {
  token: { address: string; chain?: string; symbol: string; name: string; imageUrl?: string; mcap: number };
  score: number;
  tier: "HOT" | "WATCH";
  intel?: SignalIntel;
  features?: Record<string, number | null>;
}

const SHADOW_MIN_SCORE = 40;
const ENGINE = 2;

/**
 * HOT signals become public calls (shown, counted in the record, alerted). Vetted lower-ranked candidates are tracked as
 * "shadow" calls: never shown or counted, but their outcomes teach the wallet scoreboard and the calibration report.
 */
export async function recordSignals(signals: RecordInput[]) {
  const live = signals.filter((s) => s.token.mcap > 0);
  const pub = live.filter((s) => s.tier === "HOT").slice(0, 6);
  const pubSet = new Set(pub.map((s) => s.token.address));
  const shadow = live.filter((s) => !pubSet.has(s.token.address) && s.intel && s.score >= SHADOW_MIN_SCORE).slice(0, 20);
  const cands = [...pub.map((s) => ({ s, shadow: false })), ...shadow.map((s) => ({ s, shadow: true }))];
  if (!cands.length) { void learnMatured().catch(() => undefined); return; }
  const c = await col();
  const existing = new Map(
    (await c.find({ address: { $in: cands.map((x) => x.s.token.address) } }, { projection: { address: 1, shadow: 1 } }).toArray()).map((d) => [d.address, d.shadow === true]),
  );
  // already a public call -> nothing to do; already a shadow call -> only promote if it now qualifies as public
  const fresh = cands.filter((x) => !existing.has(x.s.token.address) || (existing.get(x.s.token.address) === true && !x.shadow));
  if (fresh.length) {
    // The market cache can be ~30s old: re-read the live market cap so "spotted" is the real price at spot time.
    const liveCaps = await liveMcaps(fresh.map((x) => ({ address: x.s.token.address, chain: x.s.token.chain })));
    const now = Date.now();
    for (const { s, shadow: isShadow } of fresh) {
      const mcap = liveCaps.get(s.token.address) ?? s.token.mcap;
      if (!(mcap > 0) || !Number.isFinite(mcap)) continue; // never record a call with no price
      const base = {
        chain: s.token.chain && s.token.chain !== "solana" ? s.token.chain : "solana",
        symbol: s.token.symbol.toUpperCase(),
        name: s.token.name,
        imageUrl: s.token.imageUrl,
        spottedAt: now, spottedMcap: mcap, peakMcap: mcap, lastMcap: mcap, lastCheck: now,
        tier: s.tier, score: s.score, shadow: isShadow, engine: ENGINE,
        ...(s.features ? { features: s.features } : {}),
        ...(s.intel?.buyers?.length ? { buyers: s.intel.buyers.slice(-80) } : {}),
      };
      if (existing.has(s.token.address)) {
        // promotion: the price it is called at is the price NOW, not when it was only being watched
        await c.updateOne({ address: s.token.address }, { $set: base }).catch(() => undefined);
      } else {
        await c.updateOne({ address: s.token.address }, { $setOnInsert: { address: s.token.address, ...base } }, { upsert: true }).catch(() => undefined);
      }
    }
  }
  void learnMatured().catch(() => undefined);
}

export async function refreshCalls(force = false) {
  if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  if (refreshing) return refreshing;
  lastRefresh = Date.now();
  refreshing = (async () => {
    try {
      const c = await col();
      const t0 = Date.now();
      // Who needs a fresh price NOW. Young calls move fast and are where peaks happen, so they are re-priced almost every run; older
      // ones less often. This used to be "the 90 least recently checked", which left the median tracked call unpriced for 5+ hours:
      // peaks were missed and real winners were stored as non-winners, which is bad food for the learning model.
      const MIN = 60_000, HR = 3_600_000;
      const active = { $or: [{ shadow: { $ne: true }, engine: 2, spottedAt: { $gt: t0 - WINDOW_MS } }, { shadow: true, spottedAt: { $gt: t0 - 24 * HR } }] };
      const stale = {
        $or: [
          { spottedAt: { $gt: t0 - 6 * HR }, lastCheck: { $lt: t0 - 45_000 } },
          { spottedAt: { $gt: t0 - 48 * HR, $lte: t0 - 6 * HR }, lastCheck: { $lt: t0 - 8 * MIN } },
          { spottedAt: { $lte: t0 - 48 * HR }, lastCheck: { $lt: t0 - 45 * MIN } },
        ],
      };
      const due = await c
        .find(
          { $and: [active, stale] },
          { projection: { address: 1, chain: 1, lastMcap: 1, spottedMcap: 1, pendingMcap: 1, misses: 1, lastSeenAt: 1, rugged: 1, spottedAt: 1, peakMcap: 1, hit2xAt: 1, hitHalfAt: 1 } },
        )
        .sort({ lastCheck: 1 })
        .limit(REFRESH_BATCH)
        .toArray();
      if (!due.length) {
        if (force) await healPeaks(c).catch((e) => console.error("[heal peaks]", e instanceof Error ? e.message : e));
        return;
      }
      const chunks: typeof due[] = [];
      for (let k = 0; k < due.length; k += 30) chunks.push(due.slice(k, k + 30));
      const live = new Map<string, number>();
      for (const part of await Promise.all(chunks.map((ch) => liveMcaps(ch.map((d) => ({ address: d.address, chain: d.chain })))))) {
        for (const [k, v] of part) live.set(k, v);
      }
      const now = Date.now();
      const prior = new Map(due.map((d) => [d.address, d as { lastMcap?: number; spottedMcap?: number; pendingMcap?: number }]));
      // A rugged token disappears from the price source. It used to keep its last pre-rug price forever and look alive for days.
      // When the source IS answering (other tokens came back) but this one has been missing for hours, record it as collapsed.
      const GONE_AFTER_MISSES = 3, GONE_AFTER_MS = 45 * 60_000;
      const goneOps = live.size >= 3 ? due.filter((d) => !live.has(d.address) && !(d as { rugged?: boolean }).rugged).map((d) => {
        const x = d as { address: string; spottedMcap?: number; lastMcap?: number; misses?: number; lastSeenAt?: number; spottedAt?: number };
        const misses = (x.misses ?? 0) + 1;
        const seen = x.lastSeenAt ?? x.spottedAt ?? now;
        if (misses >= GONE_AFTER_MISSES && now - seen >= GONE_AFTER_MS && x.spottedMcap && x.spottedMcap > 0) {
          const floor = x.spottedMcap * 0.01;
          return c.updateOne({ address: x.address }, { $set: { lastMcap: Math.min(x.lastMcap ?? floor, floor), lastCheck: now, rugged: true, misses } }).catch(() => undefined);
        }
        return c.updateOne({ address: x.address }, { $set: { lastCheck: now, misses } }).catch(() => undefined);
      }) : [];
      await Promise.all(goneOps);
      await Promise.all(
        [...live.entries()].map(async ([address, mcap]) => {
          if (!(mcap > 0) || !Number.isFinite(mcap)) return undefined;
          const d = prior.get(address);
          const prev = d?.lastMcap && d.lastMcap > 0 ? d.lastMcap : d?.spottedMcap ?? 0;
          // A bad reading (wrong pair, wrong supply, a glitchy tick) used to be written as-is, and the peak is kept forever, so one
          // bad number became a fake "100,000x win". A jump of 25x either way must show up on the NEXT reading too before it counts.
          const jump = prev > 0 ? mcap / prev : 1;
          if (jump > 25 || jump < 1 / 25) {
            const confirmed = d?.pendingMcap && Math.abs(mcap / d.pendingMcap - 1) < 0.3;
            if (!confirmed) return c.updateOne({ address }, { $set: { pendingMcap: mcap, lastCheck: now } }).catch(() => undefined);
          }
          // A new peak is checked against the real candles before it is kept forever (the peak only ever goes up): the feed can return a
          // wrong market cap for a thin pool or a pair that just changed, and one wrong number became a "396x win" notification, and later
          // an "11.7x" for CI whose chart never passed 6.6x. Any reading 2x or more above the call that sets a new high (or would be the first
          // 2x, the line the public record counts as a win) is compared with the highest candle since the call (see chartPeak); a reading well
          // above it is dropped and the next reading decides.
          const pd = d as { spottedMcap?: number; spottedAt?: number; peakMcap?: number; hit2xAt?: number; hitHalfAt?: number } | undefined;
          const sm = pd?.spottedMcap ?? 0;
          const oldPeak = pd?.peakMcap ?? sm;
          if (sm > 0 && mcap >= sm * 2 && (mcap > oldPeak * 1.1 || !pd?.hit2xAt)) {
            const real = await chartPeak(address, pd?.spottedAt ?? now - 24 * 3600e3, sm);
            if (real && mcap > real.peakMcap * real.margin) return c.updateOne({ address }, { $set: { lastCheck: now, badTick: mcap } }).catch(() => undefined);
          }
          // Path, not only the end points: WHEN it first doubled and WHEN it first lost half. "Doubled before losing half" is the
          // question a trader actually cares about, and it is learnable from these timestamps (peak/last alone cannot tell the order).
          const path: Record<string, number> = {};
          if (sm > 0) {
            if (!pd?.hit2xAt && mcap >= sm * 2) path.hit2xAt = now;
            if (!pd?.hitHalfAt && mcap <= sm * 0.5) path.hitHalfAt = now;
            if (mcap > (pd?.peakMcap ?? sm)) path.peakAt = now;
          }
          return c.updateOne({ address }, { $set: { lastMcap: mcap, lastCheck: now, lastSeenAt: now, misses: 0, ...path }, $max: { peakMcap: mcap }, $min: { troughMcap: mcap }, $unset: { pendingMcap: "", rugged: "" } }).catch(() => undefined);
        }),
      );
      // the scheduled run (force) also re-checks old peaks that the check above did not exist for
      if (force) await healPeaks(c).catch((e) => console.error("[heal peaks]", e instanceof Error ? e.message : e));
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** `range`: "week" = the last 7 days (the live record, default), "last" = the 7 days before that, "month" = 30 days, "all" = everything kept. Calls are never deleted, so older weeks stay readable. */
export type CallRange = "week" | "last" | "month" | "all";
export async function listCalls(limit = 120, mint?: string, range: CallRange = "week"): Promise<SignalCall[]> {
  const c = await col();
  const filter = mint
    ? { address: EVM_ADDR_RE.test(mint) ? mint.toLowerCase() : mint, shadow: { $ne: true }, engine: 2, badData: { $ne: true } }
    : { ...(range === "all" ? {} : { spottedAt: range === "last" ? { $gt: Date.now() - 2 * WINDOW_MS, $lte: Date.now() - WINDOW_MS } : { $gt: Date.now() - (range === "month" ? 30 * 24 * 3_600_000 : WINDOW_MS) } }), shadow: { $ne: true }, engine: 2, badData: { $ne: true } };
  const docs = await c.find(filter, { projection: { _id: 0, features: 0, buyers: 0 } }).sort({ spottedAt: -1 }).limit(limit).toArray();
  return docs as SignalCall[];
}
