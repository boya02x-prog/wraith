// lib/scannerSources.ts
// Server-only. Wide candidate funnel for the signal scanner. Every source is
// independent and fails soft (a dead provider just contributes nothing).
//   Jupiter Tokens v2  trending / organic / top-traded / recent  (+ holders, organic score, authorities)
//   DexScreener        boosts, profiles, community takeovers      (batched pair lookup)
// Output is normalised to MarketToken plus an optional ScanMeta with quality data.

import { isNum, SOLANA_MINT_RE, type MarketToken } from "@/lib/market";
import {
  arr, classify, getJson, IGNORED_MINTS, IGNORED_SYMBOLS, num, numOrNull, obj, parseDexPair, type Json,
} from "@/lib/marketProviders";
import { pumpJson } from "@/lib/signalIntel";

export interface ScanMeta {
  holders?: number;
  organicScore?: number;
  mintRevoked?: boolean;
  freezeRevoked?: boolean;
  topHoldersPct?: number;
  devPct?: number;
  traders1h?: number;
  netBuyers1h?: number;
  buyVol1h?: number;
  sellVol1h?: number;
  verified?: boolean;
}
export interface Candidate {
  token: MarketToken;
  meta: ScanMeta;
}

const JUP = "https://lite-api.jup.ag/tokens/v2";

function parseJup(raw: Json, solUsd: number): Candidate | null {
  const address = String(raw.id ?? "");
  if (!SOLANA_MINT_RE.test(address) || IGNORED_MINTS.has(address)) return null;
  const symbol = String(raw.symbol ?? "?");
  if (IGNORED_SYMBOLS.has(symbol.toUpperCase())) return null;
  const priceUsd = num(raw.usdPrice);
  if (priceUsd <= 0) return null;
  const mcap = num(raw.mcap) || num(raw.fdv);
  const s5 = obj(raw.stats5m), s1 = obj(raw.stats1h), s6 = obj(raw.stats6h), s24 = obj(raw.stats24h);
  const vol = (s: Json) => num(s.buyVolume) + num(s.sellVolume);
  const audit = obj(raw.audit);
  const pool = obj(raw.firstPool);
  const created = typeof pool.createdAt === "string" ? Date.parse(pool.createdAt) : NaN;
  const cls = classify(address, null, mcap, solUsd);
  const token: MarketToken = {
    address,
    symbol,
    name: String(raw.name ?? symbol),
    imageUrl: typeof raw.icon === "string" ? raw.icon : undefined,
    priceUsd,
    mcap,
    liquidity: num(raw.liquidity),
    volume: { m5: vol(s5), h1: vol(s1), h6: vol(s6), h24: vol(s24) },
    change: { m5: numOrNull(s5.priceChange), h1: numOrNull(s1.priceChange), h6: numOrNull(s6.priceChange), h24: numOrNull(s24.priceChange) },
    txns: { buys: num(s1.numBuys), sells: num(s1.numSells) },
    createdAt: isNum(created) ? created : null,
    dex: null,
    pairAddress: null,
    ...cls,
  };
  const meta: ScanMeta = {
    holders: numOrNull(raw.holderCount) ?? undefined,
    organicScore: numOrNull(raw.organicScore) ?? undefined,
    mintRevoked: typeof audit.mintAuthorityDisabled === "boolean" ? audit.mintAuthorityDisabled : undefined,
    freezeRevoked: typeof audit.freezeAuthorityDisabled === "boolean" ? audit.freezeAuthorityDisabled : undefined,
    topHoldersPct: numOrNull(audit.topHoldersPercentage) ?? undefined,
    devPct: numOrNull(audit.devBalancePercentage) ?? undefined,
    traders1h: numOrNull(s1.numTraders) ?? undefined,
    netBuyers1h: numOrNull(s1.numNetBuyers) ?? undefined,
    buyVol1h: num(s1.buyVolume) || undefined,
    sellVol1h: num(s1.sellVolume) || undefined,
    verified: raw.isVerified === true,
  };
  return { token, meta };
}

async function jupList(path: string, solUsd: number): Promise<Candidate[]> {
  const data = await getJson(`${JUP}/${path}`, undefined, 8000);
  return arr(data).map((r) => parseJup(obj(r), solUsd)).filter((c): c is Candidate => !!c);
}

/** Wide Jupiter funnel: what is trending, genuinely organic, most traded, and brand new. */
export async function jupiterCandidates(solUsd: number): Promise<Candidate[]> {
  const paths = [
    "toptrending/1h?limit=100",
    "toptrending/5m?limit=50",
    "toptrending/6h?limit=100",
    "toporganicscore/1h?limit=100",
    "toptraded/1h?limit=100",
    "recent?limit=50",
  ];
  const res = await Promise.allSettled(paths.map((p) => jupList(p, solUsd)));
  const out: Candidate[] = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn("[scanner] jupiter", paths[i], "failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  });
  return out;
}

/** Enrich any mints (comma list, max 100) with Jupiter quality data. */
export async function jupiterEnrich(mints: string[], solUsd: number): Promise<Map<string, ScanMeta>> {
  const out = new Map<string, ScanMeta>();
  for (let i = 0; i < mints.length; i += 100) {
    try {
      const data = await getJson(`${JUP}/search?query=${mints.slice(i, i + 100).join(",")}`, undefined, 8000);
      for (const r of arr(data)) {
        const c = parseJup(obj(r), solUsd);
        if (c) out.set(c.token.address, c.meta);
      }
    } catch (e) {
      console.warn("[scanner] jupiter enrich failed:", e instanceof Error ? e.message : e);
      break;
    }
  }
  return out;
}

/** DexScreener promoted / profiled / takeover mints, resolved to real pair data. */
export async function dexCandidates(solUsd: number): Promise<MarketToken[]> {
  const sources = [
    "token-boosts/top/v1",
    "token-boosts/latest/v1",
    "token-profiles/latest/v1",
    "community-takeovers/latest/v1",
  ];
  const lists = await Promise.allSettled(sources.map((s) => getJson(`https://api.dexscreener.com/${s}`, undefined, 8000)));
  const addrs: string[] = [];
  for (const r of lists) {
    if (r.status !== "fulfilled") continue;
    for (const item of arr(r.value).map(obj)) {
      const a = String(item.tokenAddress ?? "");
      if (item.chainId === "solana" && SOLANA_MINT_RE.test(a) && !addrs.includes(a)) addrs.push(a);
    }
  }
  if (!addrs.length) return [];
  const best = new Map<string, MarketToken>();
  for (let i = 0; i < addrs.length && i < 90; i += 30) {
    try {
      const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${addrs.slice(i, i + 30).join(",")}`, undefined, 10000));
      for (const p of pairs) {
        const t = parseDexPair(obj(p), solUsd);
        if (!t) continue;
        const old = best.get(t.address);
        if (!old || t.liquidity > old.liquidity) best.set(t.address, t);
      }
    } catch {
      /* skip this batch */
    }
  }
  return [...best.values()];
}

// ── pump.fun live discovery ───────────────────────────────────────────────────────────────────────────────────
// Aggregators (Jupiter / Gecko) index a launch 1-3 minutes late, and DexScreener's boost / profile lists are paid
// promotions. pump.fun's own list API sees a coin the second it exists and can sort by "traded most recently".
// We only take the MINT LIST from it and let DexScreener supply price / volume / txns, so every number has the same
// shape as the other lanes and the scorer treats them identically. Fails soft: if pump.fun is unreachable or changes
// shape, this lane just returns [].
const PUMP_LISTS = [
  "/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false", // trading right now
  "/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false", // newest launches
  "/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false", // biggest on the curve (near graduation)
];

export async function pumpCandidates(solUsd: number): Promise<MarketToken[]> {
  const lists = await Promise.allSettled(PUMP_LISTS.map((p) => pumpJson(p)));
  const mints: string[] = [];
  for (const r of lists) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const rows = Array.isArray(r.value) ? r.value : arr(obj(r.value).coins);
    for (const raw of rows) {
      const m = obj(raw).mint;
      if (typeof m === "string" && SOLANA_MINT_RE.test(m) && !mints.includes(m)) mints.push(m);
    }
  }
  if (!mints.length) return [];
  const batches: string[][] = [];
  for (let i = 0; i < mints.length && i < 90; i += 30) batches.push(mints.slice(i, i + 30));
  const settled = await Promise.allSettled(
    batches.map((b) => getJson(`https://api.dexscreener.com/tokens/v1/solana/${b.join(",")}`, undefined, 8000)),
  );
  const best = new Map<string, MarketToken>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const p of arr(r.value)) {
      const t = parseDexPair(obj(p), solUsd);
      if (!t) continue;
      const old = best.get(t.address);
      if (!old || t.liquidity > old.liquidity) best.set(t.address, t);
    }
  }
  return [...best.values()];
}
