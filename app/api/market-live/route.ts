import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE, type MarketToken } from "@/lib/market";
import { arr, getJson, getSolUsd, obj, parseDexPair } from "@/lib/marketProviders";

export const dynamic = "force-dynamic";

const CACHE_MS = 3000;
const cache = new Map<string, { ts: number; data: Record<string, Partial<MarketToken>> }>();

/** Light price refresh for the mints currently on screen (one batched DexScreener call, cached 3s for everyone). */
export async function GET(req: NextRequest) {
  const mints = (req.nextUrl.searchParams.get("mints") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => SOLANA_MINT_RE.test(m))
    .slice(0, 30)
    .sort();
  if (!mints.length) return NextResponse.json({ prices: {} });
  const key = mints.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return edge(NextResponse.json({ prices: hit.data }), 3, 6);
  try {
    const [solUsd, raw] = await Promise.all([
      getSolUsd(),
      getJson(`https://api.dexscreener.com/tokens/v1/solana/${key}`, undefined, 5000),
    ]);
    const best = new Map<string, { liq: number; tok: MarketToken }>();
    for (const p of arr(raw).map(obj)) {
      const tok = parseDexPair(p, solUsd);
      if (!tok) continue;
      const cur = best.get(tok.address);
      if (!cur || tok.liquidity > cur.liq) best.set(tok.address, { liq: tok.liquidity, tok });
    }
    const data: Record<string, Partial<MarketToken>> = {};
    for (const [mint, { tok }] of best) {
      data[mint] = { priceUsd: tok.priceUsd, mcap: tok.mcap, liquidity: tok.liquidity, volume: tok.volume, change: tok.change, txns: tok.txns };
    }
    cache.set(key, { ts: Date.now(), data });
    if (cache.size > 200) cache.clear();
    return edge(NextResponse.json({ prices: data }), 3, 6);
  } catch {
    return NextResponse.json({ prices: {} }, { status: 502 });
  }
}
