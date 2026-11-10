// app/api/signal-prices/route.ts
// Batch market-cap lookup (DexScreener, up to 30 mints) for the Wins board.

import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, getJson, getSolUsd, obj, parseDexPair } from "@/lib/marketProviders";

export async function GET(req: NextRequest) {
  const mints = (req.nextUrl.searchParams.get("mints") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m, i, a) => SOLANA_MINT_RE.test(m) && a.indexOf(m) === i)
    .slice(0, 30);
  if (!mints.length) return NextResponse.json({ prices: {} });
  try {
    const solUsd = await getSolUsd();
    const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`, undefined, 10000));
    const best = new Map<string, { mcap: number; priceUsd: number; liquidity: number; symbol: string; name: string; imageUrl?: string }>();
    for (const p of pairs) {
      const t = parseDexPair(obj(p), solUsd);
      if (!t || !(t.mcap > 0)) continue;
      const old = best.get(t.address);
      if (!old || t.liquidity > old.liquidity) best.set(t.address, { mcap: t.mcap, priceUsd: t.priceUsd, liquidity: t.liquidity, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl });
    }
    return edge(NextResponse.json({ prices: Object.fromEntries(best) }), 3, 10);
  } catch {
    return NextResponse.json({ prices: {}, error: "price lookup failed" }, { status: 502 });
  }
}
