// lib/evmScan.ts  (server only)
// Scanner candidates for every non-Solana chain Wraith supports (lib/chains.ts).
//   GeckoTerminal trending + new pools per chain (one call each, cached 90s to stay inside rate limits)
//   DexScreener boosts / profiles / takeovers, filtered to our chains and resolved to real pair data
// Output matches the Solana scanner: MarketToken (with chain) + ScanMeta.

import { isNum, type MarketToken } from "@/lib/market";
import { arr, getJson, GECKO_HEADERS, num, numOrNull, obj, type Json } from "@/lib/marketProviders";
import { CHAINS, chainOf, EVM_ADDR_RE } from "@/lib/chains";
import type { Candidate } from "@/lib/scannerSources";

const SKIP = new Set(["ETH", "WETH", "BNB", "WBNB", "MON", "WMON", "USDC", "USDT", "USDG", "DAI", "USDE", "USD1", "FDUSD", "WBTC", "BTCB", "CBBTC", "STETH", "WSTETH"]);
const CACHE_MS = 90_000;
let cache: { ts: number; list: Candidate[] } | null = null;
let inflight: Promise<Candidate[]> | null = null;

function build(chain: string, address: string, p: {
  symbol: string; name: string; imageUrl?: string; priceUsd: number; mcap: number; liquidity: number;
  volume: MarketToken["volume"]; change: MarketToken["change"]; buys: number; sells: number;
  createdAt: number | null; dex: string | null; pairAddress: string | null; buyers?: number; sellers?: number;
}): Candidate | null {
  const addr = address.toLowerCase();
  if (!EVM_ADDR_RE.test(addr) || !(p.priceUsd > 0) || SKIP.has(p.symbol.toUpperCase())) return null;
  const token: MarketToken = {
    address: addr, chain, symbol: p.symbol, name: p.name, imageUrl: p.imageUrl, priceUsd: p.priceUsd,
    mcap: p.mcap, liquidity: p.liquidity, volume: p.volume, change: p.change,
    txns: { buys: p.buys, sells: p.sells }, createdAt: p.createdAt, dex: p.dex, pairAddress: p.pairAddress,
    graduated: false, onCurve: false, curveProgress: null,
  };
  const traders = (p.buyers ?? 0) + (p.sellers ?? 0);
  return { token, meta: traders > 0 ? { traders1h: traders, netBuyers1h: (p.buyers ?? 0) - (p.sellers ?? 0) } : {} };
}

/** DexScreener pair -> candidate (any supported chain). */
export function parseDexEvm(p: Json): Candidate | null {
  const chain = chainOf(String(p.chainId ?? ""));
  if (!chain) return null;
  const base = obj(p.baseToken);
  const vol = obj(p.volume), chg = obj(p.priceChange), tx = obj(obj(p.txns).h1);
  const mcap = num(p.marketCap) || num(p.fdv);
  const img = obj(p.info).imageUrl;
  return build(chain.key, String(base.address ?? ""), {
    symbol: String(base.symbol ?? "?"), name: String(base.name ?? base.symbol ?? "?"),
    imageUrl: typeof img === "string" ? img : undefined,
    priceUsd: num(p.priceUsd), mcap, liquidity: num(obj(p.liquidity).usd),
    volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    change: { m5: numOrNull(chg.m5), h1: numOrNull(chg.h1), h6: numOrNull(chg.h6), h24: numOrNull(chg.h24) },
    buys: num(tx.buys), sells: num(tx.sells),
    createdAt: isNum(p.pairCreatedAt) ? (p.pairCreatedAt as number) : null,
    dex: typeof p.dexId === "string" ? p.dexId : null,
    pairAddress: typeof p.pairAddress === "string" ? p.pairAddress : null,
  });
}

function parseGeckoPools(payload: unknown, chainKey: string): Candidate[] {
  const root = obj(payload);
  const tokenById = new Map<string, Json>();
  for (const inc of arr(root.included).map(obj)) if (inc.type === "token") tokenById.set(String(inc.id), obj(inc.attributes));
  const out: Candidate[] = [];
  for (const d of arr(root.data).map(obj)) {
    const a = obj(d.attributes);
    const baseId = String(obj(obj(obj(d.relationships).base_token).data).id ?? "");
    const tok = tokenById.get(baseId);
    const address = String(tok?.address ?? baseId.split("_")[1] ?? "");
    const symbol = String(tok?.symbol ?? String(a.name ?? "?").split("/")[0].trim());
    const v = obj(a.volume_usd), c = obj(a.price_change_percentage), t1 = obj(obj(a.transactions).h1);
    const created = typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : NaN;
    const price = num(a.base_token_price_usd);
    const mcap = num(a.market_cap_usd) || num(a.fdv_usd);
    const cand = build(chainKey, address, {
      symbol, name: String(tok?.name ?? symbol), imageUrl: typeof tok?.image_url === "string" && tok.image_url !== "missing.png" ? tok.image_url : undefined,
      priceUsd: price, mcap, liquidity: num(a.reserve_in_usd),
      volume: { m5: num(v.m5), h1: num(v.h1), h6: num(v.h6), h24: num(v.h24) },
      change: { m5: numOrNull(c.m5), h1: numOrNull(c.h1), h6: numOrNull(c.h6), h24: numOrNull(c.h24) },
      buys: num(t1.buys), sells: num(t1.sells), buyers: num(t1.buyers), sellers: num(t1.sellers),
      createdAt: isNum(created) ? created : null, dex: null, pairAddress: typeof a.address === "string" ? a.address : null,
    });
    if (cand) out.push(cand);
  }
  return out;
}

async function geckoFeeds(): Promise<Candidate[]> {
  const jobs: { chain: string; url: string }[] = [];
  for (const c of Object.values(CHAINS)) {
    const base = `https://api.geckoterminal.com/api/v2/networks/${c.gecko}`;
    jobs.push({ chain: c.key, url: `${base}/trending_pools?include=base_token&duration=1h` });
    jobs.push({ chain: c.key, url: `${base}/new_pools?include=base_token` });
  }
  const res = await Promise.allSettled(jobs.map((j) => getJson(j.url, GECKO_HEADERS, 9000)));
  const out: Candidate[] = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(...parseGeckoPools(r.value, jobs[i].chain));
    else console.warn("[scanner] evm gecko", jobs[i].url.split("/networks/")[1]?.split("?")[0], "failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return out;
}

async function dexFeeds(): Promise<Candidate[]> {
  const sources = ["token-boosts/top/v1", "token-boosts/latest/v1", "token-profiles/latest/v1", "community-takeovers/latest/v1"];
  const lists = await Promise.allSettled(sources.map((s) => getJson(`https://api.dexscreener.com/${s}`, undefined, 8000)));
  const byChain = new Map<string, string[]>();
  for (const r of lists) {
    if (r.status !== "fulfilled") continue;
    for (const item of arr(r.value).map(obj)) {
      const chain = chainOf(String(item.chainId ?? ""));
      const a = String(item.tokenAddress ?? "");
      if (!chain || !EVM_ADDR_RE.test(a)) continue;
      const list = byChain.get(chain.key) ?? [];
      if (!list.includes(a)) list.push(a);
      byChain.set(chain.key, list);
    }
  }
  const best = new Map<string, Candidate>();
  await Promise.all([...byChain.entries()].map(async ([chain, addrs]) => {
    for (let i = 0; i < addrs.length && i < 60; i += 30) {
      try {
        const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/${chain}/${addrs.slice(i, i + 30).join(",")}`, undefined, 10000));
        for (const p of pairs) {
          const c = parseDexEvm(obj(p));
          if (!c) continue;
          const old = best.get(c.token.address);
          if (!old || c.token.liquidity > old.token.liquidity) best.set(c.token.address, c);
        }
      } catch { /* skip batch */ }
    }
  }));
  return [...best.values()];
}

/** All non-Solana candidates, merged by address (deepest liquidity wins). Cached. */
export async function evmCandidates(): Promise<Candidate[]> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.list;
  if (!inflight) {
    inflight = (async () => {
      const [g, d] = await Promise.all([geckoFeeds().catch(() => []), dexFeeds().catch(() => [])]);
      const m = new Map<string, Candidate>();
      for (const c of [...g, ...d]) {
        const old = m.get(c.token.address);
        if (!old) m.set(c.token.address, c);
        else {
          if (c.token.liquidity > old.token.liquidity) m.set(c.token.address, { token: { ...c.token, imageUrl: c.token.imageUrl ?? old.token.imageUrl }, meta: { ...old.meta, ...c.meta } });
          else if (!old.token.imageUrl && c.token.imageUrl) old.token.imageUrl = c.token.imageUrl;
        }
      }
      const list = [...m.values()];
      if (list.length) cache = { ts: Date.now(), list };
      return list;
    })().finally(() => { inflight = null; });
  }
  try { return await inflight; } catch { return cache?.list ?? []; }
}

/** Live mcaps for tracked EVM calls, grouped per chain (DexScreener, <=30 per request). */
export async function liveEvmMcaps(items: { address: string; chain: string }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const byChain = new Map<string, string[]>();
  for (const it of items) {
    if (!chainOf(it.chain) || !EVM_ADDR_RE.test(it.address)) continue;
    byChain.set(it.chain, [...(byChain.get(it.chain) ?? []), it.address]);
  }
  await Promise.all([...byChain.entries()].map(async ([chain, addrs]) => {
    for (let i = 0; i < addrs.length; i += 30) {
      try {
        const best = new Map<string, number>();
        const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/${chain}/${addrs.slice(i, i + 30).join(",")}`, undefined, 9000));
        for (const p of pairs) {
          const c = parseDexEvm(obj(p));
          if (!c || !(c.token.mcap > 0)) continue;
          if ((best.get(c.token.address) ?? -1) < c.token.liquidity) { best.set(c.token.address, c.token.liquidity); out.set(c.token.address, c.token.mcap); }
        }
      } catch { /* keep previous */ }
    }
  }));
  return out;
}
