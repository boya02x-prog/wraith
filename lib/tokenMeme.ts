import type { MemeTrend } from "@/app/app/page";
import type { MarketToken } from "@/lib/market";
import { fmtAge } from "@/lib/market";

/** Convert a market row into the MemeTrend shape the rest of the app navigates with. */
export function toMeme(t: MarketToken): MemeTrend {
  return {
    keyword: t.symbol,
    score: t.change.h1 ?? t.change.h24 ?? 0,
    posts: t.txns.buys + t.txns.sells,
    source: t.chain && t.chain !== "solana" ? t.chain : "market",
    contractAddress: t.address,
    tokenImageUrl: t.imageUrl,
    mcap: t.mcap || undefined,
    liquidity: t.liquidity || undefined,
    volume: t.volume.h24 || undefined,
    isNewCoin: t.createdAt ? Date.now() - t.createdAt < 3_600_000 : false,
    ageLabel: t.createdAt ? fmtAge(t.createdAt) : undefined,
  };
}
