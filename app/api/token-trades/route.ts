// app/api/token-trades/route.ts
// Recent swaps for a token (last ~50 on its deepest pool) from GeckoTerminal.
// Feeds the "Swaps" tab + live trade tape on the token page.

import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, GECKO, GECKO_HEADERS, getJson, getSolUsd, num, obj, resolvePool } from "@/lib/marketProviders";
import { getSandboxToken } from "@/lib/devnetTokens";
import { getDb } from "@/lib/mongoClient";
import { fetchTokenSwaps } from "@/lib/heliusSwaps";

export interface ApiTrade {
  id: string;
  ts: number; // ms
  side: "buy" | "sell";
  usd: number;
  tokens: number;
  priceUsd: number;
  wallet: string;
  tx: string;
}

const CACHE_MS = 25_000;
const cache = new Map<string, { trades: ApiTrade[]; ts: number }>();
const inflight = new Map<string, Promise<ApiTrade[] | null>>();

// Fallback when GeckoTerminal is rate-limiting: DexPaprika pool transactions (parsed defensively; response shape unverified).
async function fromPaprika(mint: string, pool: string): Promise<ApiTrade[] | null> {
  try {
    const payload = obj(await getJson(`https://api.dexpaprika.com/networks/solana/pools/${pool}/transactions?limit=50`, undefined, 6000));
    const rows = arr(payload.transactions ?? payload.data ?? payload).map(obj);
    const idOf = (v: unknown) => (typeof v === "string" ? v : String(obj(v).id ?? obj(v).address ?? ""));
    const out: ApiTrade[] = [];
    for (const r of rows) {
      const t0 = idOf(r.token_0), t1 = idOf(r.token_1);
      const idx = t0 === mint ? 0 : t1 === mint ? 1 : -1;
      if (idx < 0) continue;
      const amt = num(r[idx === 0 ? "amount_0" : "amount_1"]);
      if (!amt) continue;
      const side: "buy" | "sell" = amt > 0 ? "sell" : "buy"; // pool received the token = user sold it
      const px = num(r[idx === 0 ? "price_0_usd" : "price_1_usd"]);
      const ts = Date.parse(String(r.created_at ?? r.block_timestamp ?? ""));
      if (!Number.isFinite(ts)) continue;
      out.push({ id: String(r.id ?? `${r.transaction_id}-${ts}`), ts, side, usd: Math.abs(amt) * px, tokens: Math.abs(amt), priceUsd: px, wallet: String(r.sender ?? r.recipient ?? ""), tx: String(r.transaction_id ?? r.id ?? "") });
    }
    return out.length ? out.sort((a, b) => b.ts - a.ts).slice(0, 60) : null;
  } catch {
    return null;
  }
}

async function loadHelius(mint: string): Promise<ApiTrade[] | null> {
  const swaps = await fetchTokenSwaps(mint, 1);
  if (!swaps || !swaps.length) return null;
  const solUsd = await getSolUsd();
  return swaps.slice(0, 60).map((s) => ({ id: s.sig, ts: s.ts, side: s.side, usd: s.sol * solUsd, tokens: s.tokens, priceUsd: s.priceSol * solUsd, wallet: s.wallet, tx: s.sig }));
}

async function load(mint: string): Promise<ApiTrade[] | null> {
  const fast = await loadHelius(mint);
  if (fast) return fast;
  const pool = await resolvePool(mint);
  if (!pool) return null;
  try {
    const payload = obj(await getJson(`${GECKO}/pools/${pool}/trades`, GECKO_HEADERS, 8000));
    const out: ApiTrade[] = [];
    for (const row of arr(payload.data).map(obj)) {
      const a = obj(row.attributes);
      const side = a.kind === "sell" ? "sell" : a.kind === "buy" ? "buy" : null;
      if (!side) continue;
      const ts = Date.parse(String(a.block_timestamp ?? ""));
      if (!Number.isFinite(ts)) continue;
      const tokens = num(side === "buy" ? a.to_token_amount : a.from_token_amount);
      const priceUsd = num(side === "buy" ? a.price_to_in_usd : a.price_from_in_usd);
      out.push({
        id: String(row.id ?? `${a.tx_hash}-${ts}`),
        ts,
        side,
        usd: num(a.volume_in_usd),
        tokens,
        priceUsd,
        wallet: String(a.tx_from_address ?? ""),
        tx: String(a.tx_hash ?? ""),
      });
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
  } catch (e) {
    console.warn("[token-trades]", e instanceof Error ? e.message : e);
    return fromPaprika(mint, pool);
  }
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) {
    return NextResponse.json({ trades: [], error: "Invalid Solana mint" }, { status: 400 });
  }
  const sandboxTok = await getSandboxToken(mint);
  if (sandboxTok) {
    const solUsd = await getSolUsd();
    const docs = await (await getDb()).collection("devnet_trades").find({ mint, tokens: { $exists: true } }).sort({ at: -1 }).limit(60).toArray();
    const trades: ApiTrade[] = docs.map((d) => ({
      id: String(d._id),
      ts: Number(d.at),
      side: d.side === "sell" ? "sell" : "buy",
      usd: Number(d.sol) * solUsd,
      tokens: Number(d.tokens),
      priceUsd: sandboxTok.priceSol * solUsd,
      wallet: String(d.wallet ?? ""),
      tx: String(d._id),
    }));
    return edge(NextResponse.json({ trades }), 4, 15);
  }

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < CACHE_MS) return edge(NextResponse.json({ trades: hit.trades }), 4, 15);

  let job = inflight.get(mint);
  if (!job) {
    job = load(mint).finally(() => inflight.delete(mint));
    inflight.set(mint, job);
  }
  const trades = await job;
  if (trades) {
    cache.set(mint, { trades, ts: Date.now() });
    return edge(NextResponse.json({ trades }), 4, 15);
  }
  if (hit) return NextResponse.json({ trades: hit.trades, stale: true });
  return NextResponse.json({ trades: [] });
}
