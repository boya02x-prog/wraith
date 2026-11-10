// lib/evmData.ts  (server only)
// DexScreener pair lookup for any EVM chain, cached. Picks the deepest pool.

import { getJson, num, numOrNull, arr, obj, GECKO_HEADERS } from "@/lib/marketProviders";
import { CHAINS, EVM_ADDR_RE, chainOf } from "@/lib/chains";

export interface EvmSnapshot {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number;
  marketCap: number | null;
  fdv: number | null;
  supply: number | null;
  liquidity: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  pairAddress: string;
  pools: string[];          // top pools by liquidity (chart tries them in order)
  dex: string | null;
  quoteSymbol: string | null;
  createdAt: number | null;
  websites: string[];
  socials: { type: string; url: string }[];
  updatedAt: number;
}

/**
 * GeckoTerminal fallback: brand-new pools (and chains DexScreener does not index yet, e.g. Robinhood / Arc / Monad)
 * show up in the scanner via Gecko but have no DexScreener pair, so the token page used to say "No market found".
 */
async function geckoSnapshot(address: string, wanted: string | null): Promise<EvmSnapshot | null> {
  const chains = wanted ? [CHAINS[wanted]] : Object.values(CHAINS);
  const lookups = chains.filter(Boolean).map(async (c) => {
    const json = obj(await getJson(`https://api.geckoterminal.com/api/v2/networks/${c.gecko}/tokens/${address}/pools?include=base_token,quote_token&page=1`, GECKO_HEADERS, 8000));
    const pools = arr(json.data).map(obj);
    if (!pools.length) throw new Error("none");
    const included = new Map(arr(json.included).map(obj).map((i) => [String(i.id), obj(i.attributes)]));
    return { c, pools, included };
  });
  const found = await Promise.any(lookups).catch(() => null);
  if (!found) return null;
  const { c, pools, included } = found;
  const rows = pools
    .map((pl) => ({ pl, a: obj(pl.attributes), rel: obj(pl.relationships) }))
    .filter((x) => String(obj(obj(x.rel.base_token).data).id ?? "").toLowerCase().endsWith(address.toLowerCase()))
    .sort((x, y) => num(y.a.reserve_in_usd) - num(x.a.reserve_in_usd));
  if (!rows.length) return null;
  const { pl, a, rel } = rows[0];
  const base = included.get(String(obj(obj(rel.base_token).data).id)) ?? {};
  const quote = included.get(String(obj(obj(rel.quote_token).data).id)) ?? {};
  const vol = obj(a.volume_usd);
  const chg = obj(a.price_change_percentage);
  const tx = obj(a.transactions);
  const t1 = obj(tx.h1);
  const t24 = obj(tx.h24);
  const priceUsd = num(a.base_token_price_usd);
  const mc = numOrNull(a.market_cap_usd);
  const fdv = numOrNull(a.fdv_usd);
  const img = typeof base.image_url === "string" && base.image_url.startsWith("http") ? base.image_url : null;
  return {
    chain: c.key,
    address,
    symbol: String(base.symbol ?? String(a.name ?? "?").split("/")[0].trim()),
    name: String(base.name ?? base.symbol ?? "?"),
    imageUrl: img,
    priceUsd,
    marketCap: mc && mc > 0 ? mc : null,
    fdv: fdv && fdv > 0 ? fdv : null,
    supply: (mc && mc > 0 ? mc : fdv && fdv > 0 ? fdv : 0) > 0 && priceUsd > 0 ? (mc && mc > 0 ? mc : (fdv as number)) / priceUsd : null,
    liquidity: num(a.reserve_in_usd),
    volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    change: { m5: numOrNull(chg.m5), h1: numOrNull(chg.h1), h6: numOrNull(chg.h6), h24: numOrNull(chg.h24) },
    txns: { h1: { buys: num(t1.buys), sells: num(t1.sells) }, h24: { buys: num(t24.buys), sells: num(t24.sells) } },
    pairAddress: String(a.address ?? ""),
    pools: rows.slice(0, 4).map((x) => String(x.a.address ?? "")).filter(Boolean),
    dex: String(obj(obj(pl.relationships).dex).data ? obj(obj(obj(pl.relationships).dex).data).id ?? "" : "") || null,
    quoteSymbol: typeof quote.symbol === "string" ? quote.symbol : null,
    createdAt: typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) || null : null,
    websites: [],
    socials: [],
    updatedAt: Date.now(),
  };
}

const cache = new Map<string, { ts: number; snap: EvmSnapshot }>();
const TTL = 4_000;

export async function getEvmSnapshot(address: string, chainKey?: string | null): Promise<EvmSnapshot | null> {
  if (!EVM_ADDR_RE.test(address)) return null;
  const wanted = chainOf(chainKey)?.key ?? null;
  const key = `${wanted ?? "any"}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.snap;

  const url = wanted
    ? `https://api.dexscreener.com/tokens/v1/${wanted}/${address}`
    : `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  let data: unknown;
  try {
    data = await getJson(url, undefined, 8000);
  } catch (e) {
    if (hit) return hit.snap;
    throw e;
  }
  const pairs = (Array.isArray(data) ? data : arr(obj(data).pairs))
    .map(obj)
    .filter((p) => chainOf(String(p.chainId)) && String(obj(p.baseToken).address).toLowerCase() === address.toLowerCase());
  if (!pairs.length) {
    const g = await geckoSnapshot(address, wanted).catch(() => null);
    if (g) { cache.set(key, { ts: Date.now(), snap: g }); return g; }
    return hit?.snap ?? null;
  }
  pairs.sort((a, b) => num(obj(b.liquidity).usd) - num(obj(a.liquidity).usd));
  const p = pairs[0];
  const base = obj(p.baseToken);
  const quote = obj(p.quoteToken);
  const vol = obj(p.volume);
  const chg = obj(p.priceChange);
  const tx = obj(p.txns);
  const t1 = obj(tx.h1);
  const t24 = obj(tx.h24);
  const info = obj(p.info);
  const priceUsd = num(p.priceUsd);
  const marketCap = numOrNull(p.marketCap);
  const fdv = numOrNull(p.fdv);
  const mc = marketCap && marketCap > 0 ? marketCap : fdv && fdv > 0 ? fdv : null;
  const snap: EvmSnapshot = {
    chain: String(p.chainId),
    address,
    symbol: String(base.symbol ?? "?"),
    name: String(base.name ?? base.symbol ?? "?"),
    imageUrl: typeof info.imageUrl === "string" ? info.imageUrl : null,
    priceUsd,
    marketCap: marketCap && marketCap > 0 ? marketCap : null,
    fdv: fdv && fdv > 0 ? fdv : null,
    supply: mc && priceUsd > 0 ? mc / priceUsd : null,
    liquidity: num(obj(p.liquidity).usd),
    volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    change: { m5: numOrNull(chg.m5), h1: numOrNull(chg.h1), h6: numOrNull(chg.h6), h24: numOrNull(chg.h24) },
    txns: { h1: { buys: num(t1.buys), sells: num(t1.sells) }, h24: { buys: num(t24.buys), sells: num(t24.sells) } },
    pairAddress: String(p.pairAddress ?? ""),
    pools: pairs.slice(0, 4).map((x) => String(x.pairAddress ?? "")).filter(Boolean),
    dex: typeof p.dexId === "string" ? p.dexId : null,
    quoteSymbol: typeof quote.symbol === "string" ? quote.symbol : null,
    createdAt: typeof p.pairCreatedAt === "number" ? p.pairCreatedAt : null,
    websites: arr(info.websites).map((w) => String(obj(w).url ?? "")).filter(Boolean),
    socials: arr(info.socials).map((s) => ({ type: String(obj(s).type ?? ""), url: String(obj(s).url ?? "") })).filter((s) => s.url),
    updatedAt: Date.now(),
  };
  cache.set(key, { ts: Date.now(), snap });
  return snap;
}
