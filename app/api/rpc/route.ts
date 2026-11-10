import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { rpcLimiter } from "@/lib/ratelimit";
import { hedgedRpc } from "@/lib/rpcHedge";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const RPC_URLS = [
  // SOLANA_RPC_URLS="https://a,https://b": extra free-tier keys tried in order when the first one rate-limits
  ...(process.env.SOLANA_RPC_URLS ? process.env.SOLANA_RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean) : []),
  ...[process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC].filter((u): u is string => !!u),
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

const PER_RPC_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 20_000;
const LOCAL_RATE_WINDOW_MS = 60_000;
const LOCAL_RATE_LIMIT = 900;
const localRateWindows = new Map<string, number[]>();
let warnedAboutRateLimitFallback = false;

// ─── METHOD ALLOWLIST ─────────────────────────────────────────────────────────
const ALLOWED_METHODS = new Set([
  "getBalance",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "simulateTransaction",
  "getAccountInfo",
  "getFeeForMessage",
  "getTransaction",
  "getTokenSupply",
  "getTokenAccountBalance",
  "getMultipleAccounts",
  // "getProgramAccounts" ← REMOVED: exposes all token holders + wallet positions
  "getMinimumBalanceForRentExemption",
  "getRecentPrioritizationFees",
]);

const SENSITIVE_METHODS = new Set([
  "sendTransaction",
  "sendRawTransaction",
  "requestAirdrop",
  "setLogFilter",
  "validatorExit",
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function applyLocalRateLimit(userId: string): boolean {
  const now = Date.now();
  const recentRequests = (localRateWindows.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < LOCAL_RATE_WINDOW_MS,
  );
  if (recentRequests.length >= LOCAL_RATE_LIMIT) {
    localRateWindows.set(userId, recentRequests);
    return false;
  }

  recentRequests.push(now);
  localRateWindows.set(userId, recentRequests);

  if (localRateWindows.size > 5_000) {
    for (const [id, timestamps] of localRateWindows) {
      if (timestamps.every((timestamp) => now - timestamp >= LOCAL_RATE_WINDOW_MS)) {
        localRateWindows.delete(id);
      }
    }
  }
  return true;
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── AUTH ──────────────────────────────────────────────────────────────────
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── RATE LIMIT ────────────────────────────────────────────────────────────
  try {
    const rateLimitResult = await rpcLimiter.limit(session.user.id);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }
  } catch (error) {
    if (!warnedAboutRateLimitFallback) {
      console.error("[RPC] Redis rate limiter unavailable; using local limits.", error);
      warnedAboutRateLimitFallback = true;
    }
    if (!applyLocalRateLimit(session.user.id)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      );
    }
  }

  // ── BODY SIZE GUARD ───────────────────────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // ── PARSE ─────────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // content-length can be missing (chunked uploads), so measure what was actually parsed too
  if (JSON.stringify(body ?? null).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("method" in body) ||
    typeof (body as Record<string, unknown>).method !== "string"
  ) {
    return NextResponse.json({ error: "Invalid RPC request" }, { status: 400 });
  }

  const method = (body as Record<string, string>).method;

  // ── METHOD VALIDATION ─────────────────────────────────────────────────────
  if (SENSITIVE_METHODS.has(method)) {
    console.warn(
      `[RPC] Blocked sensitive method: ${method} | user: ${session.user.id}`,
    );
    return NextResponse.json(
      { error: "Method not permitted" },
      { status: 403 },
    );
  }

  if (!ALLOWED_METHODS.has(method)) {
    console.warn(
      `[RPC] Blocked unknown method: ${method} | user: ${session.user.id}`,
    );
    return NextResponse.json({ error: "Method not allowed" }, { status: 403 });
  }

  // ── FORWARD TO RPC ────────────────────────────────────────────────────────
  // Hedged: the first endpoint (the paid key) is asked alone; the next one only starts if it is slow (700 ms) or failed. The old code
  // raced every endpoint on every call, which charged the paid key for each request AND for the duplicates.
  try {
    const { data } = await hedgedRpc(RPC_URLS, body, { timeoutMs: PER_RPC_TIMEOUT_MS, hedgeMs: 700 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    console.error("[RPC] All endpoints failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "RPC unavailable" }, { status: 503 });
  }
}
