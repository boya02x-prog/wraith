// GET /api/token-lookalikes?mint=&name=&symbol= -> other Solana tokens with the same or a near-identical name/ticker ("GTA Dollar" vs
// "GTA Dollars"), biggest first. Copycats and lookalikes are common right after a narrative starts, and the one that gets called
// is often not the one the crowd ends up in. This only lists them with their size and age; it does not claim which is "original".
import { NextRequest, NextResponse } from "next/server";
import { SOLANA_MINT_RE } from "@/lib/market";

export const dynamic = "force-dynamic";

interface Pair {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

/** "GTA Dollars", "gta$ dollar", "$GTA DOLLAR" -> "gtadollar": letters and digits only, plural s dropped. */
const norm =(s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
const similar = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
};

const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  const name = (req.nextUrl.searchParams.get("name") ?? "").slice(0, 60);
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").slice(0, 24);
  if (!SOLANA_MINT_RE.test(mint) || (!name && !symbol)) return NextResponse.json({ items: [] }, { status: 400 });
  const key = `${mint}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return NextResponse.json(hit.body);
  try {
    const queries = [...new Set([name, symbol].filter((q) => q.trim().length >= 3))];
    const found = new Map<string, Pair>();
    for (const q of queries) {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(9000), headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const d = (await r.json()) as { pairs?: Pair[] };
      for (const p of d.pairs ?? []) {
        const a = p.baseToken?.address;
        if (p.chainId !== "solana" || !a || a === mint) continue;
        if (!similar(name, p.baseToken?.name ?? "") && !similar(symbol, p.baseToken?.symbol ?? "") && !similar(name, p.baseToken?.symbol ?? "")) continue;
        const cur = found.get(a);
        if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) found.set(a, p);
      }
    }
    const items = [...found.entries()].map(([address, p]) => ({
      address,
      name: p.baseToken?.name ?? "",
      symbol: p.baseToken?.symbol ?? "",
      mcap: Number(p.marketCap ?? p.fdv ?? 0) || 0,
      liquidity: Number(p.liquidity?.usd ?? 0) || 0,
      volume24h: Number(p.volume?.h24 ?? 0) || 0,
      txns24h: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
      createdAt: p.pairCreatedAt ?? null,
      image: p.info?.imageUrl ?? null,
    })).filter((x) => (x.liquidity >= 500 || x.mcap >= 3000) && !(x.mcap > 5e6 && x.liquidity < x.mcap / 200)).sort((a, b) => b.mcap - a.mcap).slice(0, 6);
    // who stands behind each one: linked X post / website / Telegram, holder count, dev wallet (Jupiter's token info, one batch call)
    type Info = { id?: string; icon?: string; twitter?: string; website?: string; telegram?: string; holderCount?: number; dev?: string; organicScore?: number; isVerified?: boolean; firstPool?: { createdAt?: string } };
    const ids = [mint, ...items.map((i) => i.address)].join(",");
    const infoMap = new Map<string, Info>();
    try {
      const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${ids}`, { signal: AbortSignal.timeout(7000), headers: { Accept: "application/json" } });
      if (r.ok) for (const t of (await r.json()) as Info[]) if (t.id) infoMap.set(t.id, t);
    } catch { /* socials are a bonus: the list still works without them */ }
    const pick = (a: string) => {
      const t = infoMap.get(a);
      return t ? { twitter: t.twitter ?? null, website: t.website ?? null, telegram: t.telegram ?? null, holders: t.holderCount ?? null, dev: t.dev ?? null, organic: t.organicScore ?? null } : null;
    };
    // a market cap far out of line with the pool behind it is a pricing artefact, not a real big token: drop it (found $6.8B on a 26-minute-old token)
    const sane = items.filter((i) => {
      const h = infoMap.get(i.address)?.holderCount;
      return !(h != null && h < 100 && i.mcap > 1e6);
    });
    const body = { items: sane.map((i) => ({ ...i, image: i.image ?? infoMap.get(i.address)?.icon ?? null, links: pick(i.address) })), self: pick(mint) };
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(body);
  } catch (e) {
    console.error("[token-lookalikes]", e);
    return NextResponse.json({ items: [] });
  }
}
