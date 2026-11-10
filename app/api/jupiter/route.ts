import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { jupiterLimiter, checkLimit } from "@/lib/ratelimit";
import { solanaFeeEnabled, feeBpsForUser, feeMintFor, feeAta } from "@/lib/solanaFee";

const JUP_BASE = "https://api.jup.ag/swap/v1";
const JUP_PRICE_BASE = "https://api.jup.ag/price/v3";
const TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 10_000;


const ALLOWED_ENDPOINTS = new Set(["quote", "swap", "price", "tokens"]);

const QUOTE_ALLOWED_PARAMS = new Set([
  "inputMint",
  "outputMint",
  "amount",
  "slippageBps",
  "swapMode",
  "onlyDirectRoutes",
  "asLegacyTransaction",
  "ids", // Price v3 — comma-separated mints
]);

const SWAP_ALLOWED_FIELDS = new Set([
  "quoteResponse",
  "userPublicKey",
  "wrapAndUnwrapSol",
  "computeUnitPriceMicroLamports",
  "asLegacyTransaction",
  "useSharedAccounts",
  "feeAccount",
  "trackingAccount",
  "prioritizationFeeLamports",
  "dynamicComputeUnitLimit",
  "platformFeeBps",
]);

async function fetchWithTimeout(url: string, options: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await checkLimit(jupiterLimiter, session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") ?? "quote";

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const forwardedParams = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (QUOTE_ALLOWED_PARAMS.has(key)) forwardedParams.set(key, value);
  }

  // Server-side platform fee (tier based). The client cannot choose or remove it.
  if (endpoint === "quote" && solanaFeeEnabled()) {
    const im = forwardedParams.get("inputMint") ?? "";
    const om = forwardedParams.get("outputMint") ?? "";
    if (feeMintFor(im, om)) {
      const bps = await feeBpsForUser(session.user.id);
      if (bps > 0) forwardedParams.set("platformFeeBps", String(bps));
    }
  }

  const upstreamUrl =
    endpoint === "price"
      ? `${JUP_PRICE_BASE}?${forwardedParams.toString()}`
      : `${JUP_BASE}/${endpoint}?${forwardedParams.toString()}`;

  try {
    const res = await fetchWithTimeout(
      upstreamUrl,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": process.env.JUPITER_API_KEY ?? "",
        },
      },
      TIMEOUT_MS,
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Jupiter returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return NextResponse.json(
      {
        error: isTimeout
          ? "Jupiter quote timed out after 30s"
          : "Jupiter unreachable",
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const { success } = await checkLimit(jupiterLimiter, session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") ?? "swap";

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filteredBody: Record<string, unknown> = {};
  for (const key of SWAP_ALLOWED_FIELDS) {
    if (key in rawBody) filteredBody[key] = rawBody[key];
  }

  if (
    typeof filteredBody.userPublicKey !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(filteredBody.userPublicKey)
  ) {
    return NextResponse.json(
      { error: "Invalid userPublicKey" },
      { status: 400 },
    );
  }

  // ── FEE ACCOUNT (the bps were already applied to the quote on the server) ──
  if (endpoint === "swap" && solanaFeeEnabled()) {
    const q = rawBody.quoteResponse as { inputMint?: string; outputMint?: string; platformFee?: { amount?: string } | null } | undefined;
    if (q?.platformFee && Number(q.platformFee.amount ?? 0) > 0) {
      const mint = feeMintFor(q.inputMint ?? "", q.outputMint ?? "");
      if (mint) filteredBody.feeAccount = feeAta(mint);
    }
  }

  const upstreamUrl = `${JUP_BASE}/${endpoint}`;

  try {
    const res = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": process.env.JUPITER_API_KEY ?? "",
        },
        body: JSON.stringify(filteredBody),
      },
      TIMEOUT_MS,
    );

    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Jupiter returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return NextResponse.json(
      {
        error: isTimeout
          ? "Jupiter swap timed out after 30s"
          : "Jupiter unreachable",
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
