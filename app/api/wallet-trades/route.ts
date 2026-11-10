// GET /api/wallet-trades?address=<solana wallet>: the tokens a wallet has been trading lately, with names and pictures.
import { NextRequest, NextResponse } from "next/server";
import { SOLANA_MINT_RE } from "@/lib/market";
import { walletHistory } from "@/lib/walletHistory";
import { assetMeta } from "@/lib/walletAssets";
import { getSolUsd } from "@/lib/marketProviders";

export const dynamic = "force-dynamic";
export const maxDuration = 40;

interface Meta { symbol: string; name: string; image: string | null; mcap: number | null }

async function dexMeta(mints: string[]): Promise<Map<string, Meta>> {
  const out = new Map<string, Meta>();
  if (!mints.length) return out;
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(0, 30).join(",")}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return out;
    const pairs = (await res.json()) as { baseToken?: { address?: string; symbol?: string; name?: string }; info?: { imageUrl?: string }; marketCap?: number; liquidity?: { usd?: number } }[];
    const best = new Map<string, (typeof pairs)[number]>();
    for (const p of pairs) {
      const m = p.baseToken?.address;
      if (m && (!best.has(m) || (p.liquidity?.usd ?? 0) > (best.get(m)!.liquidity?.usd ?? 0))) best.set(m, p);
    }
    for (const [m, p] of best) out.set(m, { symbol: p.baseToken?.symbol ?? "", name: p.baseToken?.name ?? "", image: p.info?.imageUrl ?? null, mcap: Number(p.marketCap) > 0 ? Number(p.marketCap) : null });
  } catch { /* optional */ }
  return out;
}

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
  if (!SOLANA_MINT_RE.test(address)) return NextResponse.json({ error: "Not a Solana wallet address" }, { status: 400 });
  const [hist, solUsd] = await Promise.all([walletHistory(address), getSolUsd().catch(() => 0)]);
  if (!hist) return NextResponse.json({ tokens: [], swaps: 0, solUsd: solUsd || null, historyOk: false });
  const mints = hist.tokens.slice(0, 30).map((t) => t.mint);
  // names and pictures: DexScreener for live tokens, on-chain metadata for everything else (dead tokens still have a logo on-chain)
  const [dex, chain] = await Promise.all([dexMeta(mints), assetMeta(mints)]);
  const tokens = hist.tokens.slice(0, 30).map((t) => {
    const d = dex.get(t.mint), c = chain.get(t.mint);
    return {
      ...t,
      symbol: d?.symbol || c?.symbol || `${t.mint.slice(0, 4)}…`,
      name: d?.name || c?.name || "",
      image: d?.image || c?.image || null,
      mcap: d?.mcap ?? null,
      pnlSol: t.sells > 0 && t.buys > 0 ? t.sellSol - t.buySol : null,
    };
  });
  return NextResponse.json({ tokens, swaps: hist.swaps, solUsd: solUsd || null, historyOk: true }, { headers: { "Cache-Control": "private, max-age=120" } });
}
