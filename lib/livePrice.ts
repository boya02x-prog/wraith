// lib/livePrice.ts (client)
// A fresh USD price for auto-exits. getTokenPrice() keeps a 45 second cache and reads DexScreener pair data, which is fine for
// a screen but far too slow for a stop-loss on a token that can move 30% in seconds. This goes straight to Jupiter's price
// (the price swaps actually execute at) with no cache.

export async function getLiveUsdPrice(mint: string): Promise<number> {
  try {
    const res = await fetch(`/api/jupiter?endpoint=price&ids=${encodeURIComponent(mint)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return 0;
    const data = await res.json();
    const p = Number(data?.[mint]?.usdPrice ?? data?.data?.[mint]?.usdPrice ?? data?.data?.[mint]?.price ?? 0);
    return Number.isFinite(p) && p > 0 ? p : 0;
  } catch {
    return 0;
  }
}
