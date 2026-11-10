// GET /api/ticker?t=<address>|<chain>,…  → majors (BTC, ETH, SOL, BNB) + live mcap/24h for pinned tokens. 30s cache.
import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { arr, getJson, num, obj } from "@/lib/marketProviders";
import { EVM_ADDR_RE, chainOf } from "@/lib/chains";
import { SOLANA_MINT_RE } from "@/lib/market";

const MAJORS = [
  { id: "bitcoin", sym: "BTC" },
  { id: "ethereum", sym: "ETH" },
  { id: "solana", sym: "SOL" },
  { id: "binancecoin", sym: "BNB" },
];
let majorsCache: { ts: number; rows: { sym: string; price: number; change: number | null }[] } | null = null;
const tokCache = new Map<string, { ts: number; row: { address: string; chain: string; mcap: number; change: number | null } | null }>();

async function majors() {
  if (majorsCache && Date.now() - majorsCache.ts < 30_000) return majorsCache.rows;
  try {
    const data = obj(await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${MAJORS.map((m) => m.id).join(",")}&vs_currencies=usd&include_24hr_change=true`, undefined, 8000));
    const rows = MAJORS.flatMap((m) => {
      const d = obj(data[m.id]);
      return num(d.usd) > 0 ? [{ sym: m.sym, price: num(d.usd), change: d.usd_24h_change === undefined ? null : num(d.usd_24h_change) }] : [];
    });
    if (rows.length) majorsCache = { ts: Date.now(), rows };
  } catch { /* keep stale */ }
  return majorsCache?.rows ?? [];
}

async function pinned(address: string, chain: string) {
  const key = `${chain}:${address}`;
  const hit = tokCache.get(key);
  if (hit && Date.now() - hit.ts < 30_000) return hit.row;
  let row: { address: string; chain: string; mcap: number; change: number | null } | null = null;
  try {
    const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`, undefined, 8000));
    let best = -1;
    for (const p of pairs) {
      const o = obj(p);
      const liq = num(obj(o.liquidity).usd);
      const mcap = num(o.marketCap) || num(o.fdv);
      if (mcap > 0 && liq > best) { best = liq; row = { address, chain, mcap, change: obj(o.priceChange).h24 === undefined ? null : num(obj(o.priceChange).h24) }; }
    }
  } catch { /* leave null */ }
  tokCache.set(key, { ts: Date.now(), row });
  return row;
}

export async function GET(req: NextRequest) {
  const items = (req.nextUrl.searchParams.get("t") ?? "")
    .split(",").map((s) => s.split("|")).slice(0, 6)
    .flatMap(([address, chainRaw]) => {
      const chain = !chainRaw || chainRaw === "solana" ? "solana" : chainOf(chainRaw)?.key ?? "";
      const ok = chain === "solana" ? SOLANA_MINT_RE.test(address ?? "") : EVM_ADDR_RE.test(address ?? "");
      return ok && chain ? [{ address, chain }] : [];
    });
  const [m, tokens] = await Promise.all([majors(), Promise.all(items.map((i) => pinned(i.address, i.chain)))]);
  return edge(NextResponse.json({ majors: m, tokens: tokens.filter(Boolean), ok: m.length > 0 }), 30, 120);
}
