import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getAppSession } from "@/lib/session";
import { rpcLimiter } from "@/lib/ratelimit";
import { getSandboxToken } from "@/lib/devnetTokens";
import { devnetConnection } from "@/lib/devnet";
import { PublicKey } from "@solana/web3.js";
import { heliusRpcUrl } from "@/lib/heliusSwaps";

// Exact-ish holder count from Helius DAS (paged, unique owners with a balance). Caps at 10 pages = 10,000.
async function heliusCount(mint: string): Promise<number | null> {
  const url = heliusRpcUrl();
  if (!url) return null;
  const owners = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "h", method: "getTokenAccounts", params: { mint, page, limit: 1000, displayOptions: {} } }), signal: AbortSignal.timeout(7000), cache: "no-store" });
      const j = (await res.json()) as { result?: { token_accounts?: { owner?: string; amount?: number }[] } };
      const rows = j.result?.token_accounts;
      if (!rows) return owners.size ? owners.size : null;
      for (const r of rows) if (r.owner && (r.amount ?? 0) > 0) owners.add(r.owner);
      if (rows.length < 1000) return owners.size;
    } catch { return owners.size ? owners.size : null; }
  }
  return owners.size;
}

const CACHE_MS = 60_000;
const holderCache = new Map<string, { count: number; expiresAt: number }>();

export async function GET(request: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mint = request.nextUrl.searchParams.get("mint") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ error: "Invalid Solana mint" }, { status: 400 });
  }
  if (await getSandboxToken(mint)) {
    try {
      const accs = await devnetConnection().getTokenLargestAccounts(new PublicKey(mint));
      const count = accs.value.filter((a) => Number(a.amount) > 0).length;
      return NextResponse.json({ mint, holderCount: count, source: "devnet" });
    } catch {
      return NextResponse.json({ mint, holderCount: 0, source: "devnet" });
    }
  }
  const cached = holderCache.get(mint);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { mint, holderCount: cached.count, source: "Birdeye" },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  }

  try {
    const rateLimit = await rpcLimiter.limit(session.user.id);
    if (!rateLimit.success) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  } catch (error) {
    console.error("[token holder count] Rate limiter unavailable", error);
    return NextResponse.json({ error: "Holder count temporarily unavailable" }, { status: 503 });
  }

  const viaHelius = await heliusCount(mint);
  if (viaHelius != null) {
    holderCache.set(mint, { count: viaHelius, expiresAt: Date.now() + CACHE_MS });
    return NextResponse.json({ mint, holderCount: viaHelius, source: "Helius" }, { headers: { "Cache-Control": "private, max-age=60" } });
  }
  if (!env.BIRDEYE_API_KEY) {
    return NextResponse.json({ error: "Holder count unavailable" }, { status: 503 });
  }

  try {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
      {
        headers: {
          "X-API-KEY": env.BIRDEYE_API_KEY,
          "x-chain": "solana",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      console.error("[token holder count] Birdeye request failed", response.status);
      return NextResponse.json({ error: "Holder count unavailable" }, { status: 502 });
    }
    const payload: unknown = await response.json();
    const data =
      typeof payload === "object" && payload !== null && "data" in payload &&
      typeof payload.data === "object" && payload.data !== null
        ? payload.data
        : null;
    const holderCount = data && "holder" in data ? data.holder : null;
    if (typeof holderCount !== "number" || !Number.isSafeInteger(holderCount) || holderCount < 0) {
      console.error("[token holder count] Birdeye response did not include a valid holder count");
      return NextResponse.json({ error: "Holder count unavailable" }, { status: 502 });
    }

    holderCache.set(mint, { count: holderCount, expiresAt: Date.now() + CACHE_MS });
    if (holderCache.size > 1000) {
      const now = Date.now();
      for (const [address, entry] of holderCache) {
        if (entry.expiresAt <= now) holderCache.delete(address);
      }
    }
    return NextResponse.json(
      { mint, holderCount, source: "Birdeye" },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    console.error("[token holder count]", error);
    return NextResponse.json({ error: "Holder count unavailable" }, { status: 502 });
  }
}
