import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ─── REDIS CONNECTION ─────────────────────────────────────────────────────────
// Fails fast at startup if UPSTASH_REDIS_REST_URL / TOKEN are missing
// retry:false + 1s abort: if Upstash is unreachable we fail open immediately instead of stalling every request ~4-5s.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL ?? "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  retry: false,
  signal: () => AbortSignal.timeout(1000),
});

// ─── SAFE LIMIT HELPER ────────────────────────────────────────────────────────
// Wraps every limiter.limit() call so a Redis outage never crashes an API route.
// Pass failOpen=true (default) to allow requests through during outages.
// Pass failOpen=false on sensitive routes (e.g. scan) to block during outages.
export async function checkLimit(
  limiter: Ratelimit,
  id: string,
  failOpen = true,
): Promise<{ success: boolean; limit: number; remaining: number }> {
  try {
    return await limiter.limit(id);
  } catch (err) {
    console.error("[ratelimit] Redis unavailable:", err);
    return {
      success: failOpen,
      limit: 0,
      remaining: 0,
    };
  }
}

// ─── LIMITERS ─────────────────────────────────────────────────────────────────

// Scan: 6 per 10 minutes — expensive AI + multi-source scan
export const scanLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(6, "10 m"),
  prefix: "wraith_scan",
});

// Jupiter swaps/quotes: 30 per minute
export const jupiterLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  prefix: "wraith_jupiter",
});

// RPC proxy: 100 per minute
export const rpcLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(900, "1 m"),
  prefix: "wraith_rpc",
});

// Position saves: 60 per 10 minutes — frequent auto-saves from PaperTrader
export const positionLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "10 m"),
  prefix: "wraith_positions",
});

// Trade appends: 30 per 10 minutes — one per actual buy/sell
export const tradeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  prefix: "wraith_trades",
});

// Analyze: 30 per 10 minutes — one call per token selection
export const analyzeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "10 m"),
  prefix: "wraith_analyze",
});

// ─── ABUSE LIMITERS (security audit) ─────────────────────────────────────────
// Every route that writes to the database, spends server money (gas, RPC, third-party quota) or fans out to other users gets a
// budget. Keys are the signed-in user id, or the caller IP for anonymous endpoints. Use checkLimit(limiter, id, false) on routes
// that move money so an Upstash outage blocks them instead of opening them.
type Win = `${number} ${"s" | "m" | "h" | "d"}`;
const make = (tokens: number, window: Win, prefix: string) =>
  new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `wraith_${prefix}` });

export const calloutPostLimiter = make(8, "10 m", "callout_post");    // posting a callout
export const calloutReadLimiter = make(240, "1 m", "callout_read");   // feed polling
export const reactLimiter = make(60, "1 m", "react");                 // heart, repost, follow, bookmark
export const commentLimiter = make(20, "5 m", "comment");             // callout comments
export const pushSubscribeLimiter = make(20, "1 h", "push_sub");      // registering a device for push
export const pushTestLimiter = make(5, "10 m", "push_test");          // "send me a test notification"
export const gasDripLimiter = make(6, "1 h", "gas_drip");             // treasury gas top-ups (real money)
export const airdropLimiter = make(6, "1 h", "airdrop");              // devnet faucet
export const activityLimiter = make(90, "1 m", "activity");           // on-chain activity pings
export const bannerLimiter = make(40, "1 m", "banner");               // server-rendered share images (CPU heavy), per IP
export const publicReadLimiter = make(60, "1 m", "public_read");      // anonymous search / lookup endpoints, per IP
export const telegramChatLimiter = make(20, "1 m", "tg_chat");        // bot commands per Telegram chat
export const telegramLinkLimiter = make(10, "1 h", "tg_link");        // generating Telegram link codes
export const syncLimiter = make(12, "10 m", "sync");                  // chain re-scan (dozens of RPC calls per request)
export const quoteLimiter = make(40, "1 m", "quote");                 // swap quotes (paid third-party quota)
export const lightWriteLimiter = make(120, "10 m", "light_write");    // history / scoring / small writes
