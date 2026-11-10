// ─── STARTUP ENV VALIDATION ───────────────────────────────────────────────────
// Called once at module init. Throws on missing required vars so the process
// fails fast at cold start rather than silently at runtime per-request.

const REQUIRED_VARS = [
  "MONGODB_URI",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

const OPTIONAL_VARS = [
  "GEMINI_API_KEY",
  "BIRDEYE_API_KEY",
  "TWITTER_BEARER_TOKEN",
  "X_OAUTH_CLIENT_ID",
  "X_OAUTH_CLIENT_SECRET",
  "X_OAUTH_CALLBACK_URL",
  "JUPITER_API_KEY",
  "MONGODB_DB",
  "SOLANA_RPC_URL",
  "TELEGRAM_RSS_BASE",
  "REDDIT_USER_AGENT",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
] as const;

function validateEnv(): void {
  // Only validate on the server — this module should never be imported client-side
  if (typeof window !== "undefined") return;

  const missing: string[] = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required environment variables:\n  ${missing.join("\n  ")}\n` +
        `Add them to .env.local (development) or your deployment environment.`,
    );
  }

  // Warn about missing optional vars at startup so they're visible in logs
  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]) {
      console.warn(
        `[env] Optional var not set: ${key} — related features will be disabled`,
      );
    }
  }
}

validateEnv();

// Re-export typed accessors so callers don't need to null-check required vars
export const env = {
  MONGODB_URI: process.env.MONGODB_URI!,
  MONGODB_DB: process.env.MONGODB_DB || "wraith",
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL!,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN!,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  BIRDEYE_API_KEY: process.env.BIRDEYE_API_KEY || "",
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || "",
  JUPITER_API_KEY: process.env.JUPITER_API_KEY || "",
  TELEGRAM_RSS_BASE:
    process.env.TELEGRAM_RSS_BASE || "https://rsshub.app/telegram/channel",
  REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT || "wraith-scanner/1.0",
} as const;
