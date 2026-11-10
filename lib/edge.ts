// lib/edge.ts  (server only)
// Shared-data routes (market, signals, prices, charts...) answer the same JSON to everybody. Letting Vercel's CDN keep a
// copy for a few seconds means 1,000 phones polling cost a handful of upstream calls instead of 1,000, and the answer
// comes from the nearest edge instead of a cold function. stale-while-revalidate keeps it instant while it refreshes.
// proxy.ts (the sign-in gate) runs BEFORE the CDN, so only signed-in users are ever served a cached copy.
// Only 200s are touched: errors and empty answers are never cached. Never use this on per-user data.
export function edge<T extends Response>(res: T, sMaxAge: number, swr = 0): T {
  if (res.status === 200) {
    res.headers.set("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}${swr > 0 ? `, stale-while-revalidate=${swr}` : ""}`);
  }
  return res;
}
