// ─── SHARED CANDLE CACHE ────────────────────────────────────────────────────
// TokenPanel's fetchCandles() hits /api/token-chart fresh on every mount,
// which is fine for the main chart (user just clicked, expects a beat of
// load time) but wrong for a hover preview — a hover needs to feel instant,
// the way Telemetry's does, not fire a 3-source fallback chain on mouseenter.
//
// This module gives every consumer (hover preview, main chart, anything
// else) one in-memory cache keyed by `${address}:${tf}`, plus a prefetch()
// you can fire the moment a token becomes visible in a list — well before
// the user's mouse ever gets there. By the time they hover, the data's
// already sitting here and the hover chart just reads it, no network wait.
//
// This does NOT replace your server-side 15s cache in route.ts — it sits in
// front of it. Server cache = shared across users/tabs. This = shared across
// components in one tab, so MemeScanner and TokenPanel and the hover preview
// never redundantly fetch the same token+timeframe within a few seconds of
// each other.

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface CandleCacheEntry {
  candles: Candle[];
  ts: number;
  promise?: Promise<Candle[]>;
}

const _candleCache = new Map<string, CandleCacheEntry>();

// Shorter than the server cache (15s) on purpose — this is just meant to
// dedupe near-simultaneous requests within one tab, not to be a long-lived
// source of truth. Anything older than this re-fetches (and will likely hit
// the still-warm server cache anyway, so it's cheap).
const CLIENT_CACHE_MS = 12_000;

function cacheKey(address: string, tf: string) {
  return `${address}:${tf}`;
}

async function rawFetchCandles(address: string, tf: string): Promise<Candle[]> {
  try {
    const res = await fetch(`/api/token-chart?address=${address}&tf=${tf}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.candles) ? data.candles : [];
  } catch {
    return [];
  }
}

/**
 * Fire-and-forget: warm the cache for a token+timeframe without waiting on
 * or caring about the result. Call this the moment a token row renders in
 * a visible list (e.g. top N rows of the scanner feed), NOT on hover.
 */
export function prefetchCandles(address: string, tf: string = "5m") {
  if (!address) return;
  const key = cacheKey(address, tf);
  const existing = _candleCache.get(key);
  if (existing && Date.now() - existing.ts < CLIENT_CACHE_MS) return;
  if (existing?.promise) return; // already in flight

  const promise = rawFetchCandles(address, tf);
  _candleCache.set(key, {
    candles: existing?.candles ?? [],
    ts: existing?.ts ?? 0,
    promise,
  });

  promise.then((candles) => {
    if (candles.length) {
      _candleCache.set(key, { candles, ts: Date.now() });
    } else {
      // keep stale data if we had any rather than wiping it on an empty poll
      const cur = _candleCache.get(key);
      _candleCache.set(key, { candles: cur?.candles ?? [], ts: Date.now() });
    }
  });
}

/**
 * Read + fetch. Returns cached candles instantly if warm, otherwise awaits
 * a fetch (and caches it for next time). This is what the hover component
 * and the main chart should both call instead of hitting the API directly.
 */
export async function getCandles(
  address: string,
  tf: string = "5m",
): Promise<Candle[]> {
  const key = cacheKey(address, tf);
  const existing = _candleCache.get(key);

  if (existing && Date.now() - existing.ts < CLIENT_CACHE_MS) {
    return existing.candles;
  }

  if (existing?.promise) {
    return existing.promise;
  }

  const promise = rawFetchCandles(address, tf);
  _candleCache.set(key, { candles: existing?.candles ?? [], ts: 0, promise });

  const candles = await promise;
  _candleCache.set(key, { candles, ts: Date.now() });
  return candles;
}

/**
 * Synchronous peek — returns whatever's cached right now (possibly empty),
 * without triggering a fetch. Useful for an instant first paint while a
 * background getCandles() call fills in / refreshes.
 */
export function peekCandles(address: string, tf: string = "5m"): Candle[] {
  return _candleCache.get(cacheKey(address, tf))?.candles ?? [];
}

/** Seed the cache from a response someone else already fetched (hover prefetch) so the chart paints instantly. */
export function seedCandles(address: string, tf: string, candles: Candle[]) {
  if (!address || !candles.length) return;
  _candleCache.set(cacheKey(address, tf), { candles, ts: Date.now() });
}
