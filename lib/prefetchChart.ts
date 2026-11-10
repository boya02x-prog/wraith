"use client";

import { seedCandles, type Candle } from "@/lib/candleCache";

// last token snapshot per mint: TokenPanel paints from it instantly, then revalidates
export const snapCache = new Map<string, { data: unknown; ts: number }>();

let timer: ReturnType<typeof setTimeout> | null = null;
let lastFire = 0;
const seen = new Map<string, number>();

/**
 * Warm the server's chart cache when the pointer rests on a row (350ms dwell), so the chart opens fast.
 * Passing over rows cancels earlier ones, and fires are spaced out so we never burn the shared
 * GeckoTerminal allowance (30 req/min) just by moving the mouse.
 */
export function prefetchChart(mint: string, onCurve = false, immediate = false) {
  if (typeof window === "undefined" || !mint) return;
  if (timer) clearTimeout(timer);
  // snapshot is cheap (server-cached): warm it immediately on hover, no dwell
  if (Date.now() - (snapCache.get(mint)?.ts ?? 0) > 5000) {
    void fetch(`/api/token-price?mint=${encodeURIComponent(mint)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) snapCache.set(mint, { data: d, ts: Date.now() }); })
      .catch(() => undefined);
  }
  // a finger touching a row is a much stronger signal than the mouse passing over it: no dwell, no spacing
  timer = setTimeout(() => {
    timer = null;
    const now = Date.now();
    if (now - (seen.get(mint) ?? 0) < 60_000) return;
    if (!immediate && now - lastFire < 4000) return;
    lastFire = now;
    seen.set(mint, now);
    if (seen.size > 200) seen.clear();
    void fetch(`/api/token-chart?address=${encodeURIComponent(mint)}&tf=15m${onCurve ? "&curve=1" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { candles?: Candle[] } | null) => { if (d?.candles?.length) seedCandles(mint, "15m", d.candles); })
      .catch(() => undefined);
  }, immediate ? 0 : 350);
}
