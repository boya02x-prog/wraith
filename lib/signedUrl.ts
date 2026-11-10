// HMAC-signed query strings for server-generated public URLs (Telegram share banners).
//
// /api/banner draws a PNG from whatever is in the query string and has to stay publicly fetchable (Telegram downloads it itself), so
// anyone could previously mint a "WRAITH WIN 100x" banner for any token on wraith.farm's own domain and burn server CPU doing it.
// The server that really makes the banners (the alert cron) now signs the query, and the route refuses anything unsigned or edited.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  return process.env.BANNER_SECRET || process.env.CRON_SECRET || process.env.TELEGRAM_BOT_TOKEN || null;
}

function canonical(sp: URLSearchParams): string {
  const pairs = [...sp.entries()].filter(([k]) => k !== "sig").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(pairs).toString();
}

/** Signature for the query (everything except `sig`). Empty string when no secret is configured. */
export function signQuery(sp: URLSearchParams): string {
  const key = secret();
  if (!key) return "";
  return createHmac("sha256", key).update(canonical(sp)).digest("base64url").slice(0, 32);
}

/** True only when the query carries a valid `sig` for its current contents. */
export function verifyQuery(sp: URLSearchParams): boolean {
  const want = signQuery(sp);
  const got = sp.get("sig") ?? "";
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
