// Warm up a token's data the moment it is picked (a tap on a row), BEFORE the page opens: the first requests of a cold server
// are the slow ones (several seconds), and by the time the token page mounts the answers are already cached. Fire-and-forget,
// once per token per 25 seconds, low priority, errors ignored.
const seen = new Map<string, number>();

export function prefetchToken(mint: string) {
  if (typeof window === "undefined" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
  const now = Date.now();
  if ((seen.get(mint) ?? 0) > now - 25_000) return;
  seen.set(mint, now);
  if (seen.size > 80) seen.delete(seen.keys().next().value as string);
  const m = encodeURIComponent(mint);
  const urls = [`/api/token-price?mint=${m}`, `/api/token-trades?mint=${m}`, `/api/token-holders?mint=${m}`, `/api/token-chart?address=${m}&tf=15m`, `/api/token-age?mint=${m}`, `/api/token-holder-count?mint=${m}`];
  for (const u of urls) {
    try { void fetch(u, { priority: "low" } as RequestInit).catch(() => undefined); } catch { /* ignore */ }
  }
}
