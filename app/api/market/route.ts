// app/api/market/route.ts
// Server-side market feed for the Discover board + token sidebar.
//
// Why server-side: the old board called DexScreener from every browser tab
// (CORS flakiness, per-IP rate limits, 45s polling x N tabs). Now ONE server
// cache feeds everybody, and two independent providers back each other up:
//   primary   GeckoTerminal (rich pool data: txns, volume, change, age)
//   secondary DexScreener   (boosts / profiles -> batched token lookup)
// If both fail we serve the last good snapshot (marked stale) instead of an
// empty board.

import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { cleanSym, cleanName } from "@/lib/cleanText";
function scrub<T extends { symbol?: string; name?: string }>(t: T[]): T[] { return t.map((x) => ({ ...x, symbol: cleanSym(x.symbol), name: cleanName(x.name) })); }
import { SOLANA_MINT_RE, type MarketCategory, type MarketToken } from "@/lib/market";
import {
  arr,
  geckoPages,
  getJson,
  getSolUsd,
  obj,
  parseDexPair,
} from "@/lib/marketProviders";


const CACHE_MS = 60_000; // GeckoTerminal free tier is ~30 req/min across ALL users
const STALE_MS = 10 * 60_000;

type Entry = { tokens: MarketToken[]; ts: number; source: string };
const cache = new Map<MarketCategory, Entry>();
const inflight = new Map<MarketCategory, Promise<Entry | null>>();

async function dexScreenerList(category: MarketCategory, solUsd: number): Promise<MarketToken[]> {
  const sources =
    category === "new"
      ? ["token-profiles/latest/v1", "token-boosts/latest/v1"]
      : ["token-boosts/top/v1", "token-boosts/latest/v1", "token-profiles/latest/v1"];
  const lists = await Promise.allSettled(sources.map((s) => getJson(`https://api.dexscreener.com/${s}`, undefined, 8000)));
  const addresses: string[] = [];
  for (const r of lists) {
    if (r.status !== "fulfilled") continue;
    for (const item of arr(r.value).map(obj)) {
      const a = String(item.tokenAddress ?? "");
      if (item.chainId === "solana" && SOLANA_MINT_RE.test(a) && !addresses.includes(a)) addresses.push(a);
    }
  }
  if (!addresses.length) throw new Error("dexscreener: no candidates");
  const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${addresses.slice(0, 30).join(",")}`, undefined, 10000));
  const best = new Map<string, MarketToken>();
  for (const p of pairs) {
    const t = parseDexPair(obj(p), solUsd);
    if (!t) continue;
    const old = best.get(t.address);
    if (!old || t.liquidity > old.liquidity) best.set(t.address, t);
  }
  return [...best.values()];
}

// ── merge + rank ────────────────────────────────────────────────────────
function merge(primary: MarketToken[], secondary: MarketToken[]): MarketToken[] {
  const map = new Map<string, MarketToken>();
  for (const t of primary) if (!map.has(t.address)) map.set(t.address, t);
  for (const t of secondary) {
    const have = map.get(t.address);
    if (!have) {
      map.set(t.address, t);
    } else if (!have.imageUrl && t.imageUrl) {
      have.imageUrl = t.imageUrl;
    }
  }
  return [...map.values()];
}

function rank(category: MarketCategory, tokens: MarketToken[]): MarketToken[] {
  const live = tokens.filter((t) => t.priceUsd > 0 && (t.liquidity >= 500 || t.onCurve));
  switch (category) {
    case "new":
      return live
        .filter((t) => t.createdAt)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    case "volume":
      return live.sort((a, b) => b.volume.h24 - a.volume.h24);
    case "gainers":
      return live
        .filter((t) => t.liquidity >= 3000 && t.volume.h1 >= 1000 && (t.change.h1 ?? 0) > 0)
        .sort((a, b) => (b.change.h1 ?? 0) - (a.change.h1 ?? 0));
    default:
      return live; // trending: provider order is the ranking
  }
}

async function build(category: MarketCategory): Promise<Entry | null> {
  const solUsd = await getSolUsd();

  const geckoJob = (async () => {
    switch (category) {
      case "new":
        return geckoPages("new_pools", [1, 2], solUsd);
      case "volume":
        return geckoPages("pools?sort=h24_volume_usd_desc", [1, 2], solUsd);
      case "gainers": {
        const [a, b] = await Promise.allSettled([
          geckoPages("trending_pools?duration=1h", [1, 2], solUsd),
          geckoPages("trending_pools?duration=24h", [1], solUsd),
        ]);
        const list = [a, b].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        if (!list.length) throw new Error("gecko: gainers empty");
        return merge(list, []);
      }
      default:
        return geckoPages("trending_pools?duration=1h", [1, 2], solUsd);
    }
  })();
  const dexJob = dexScreenerList(category, solUsd);

  const [g, d] = await Promise.allSettled([geckoJob, dexJob]);
  const primary = g.status === "fulfilled" ? g.value : [];
  const secondary = d.status === "fulfilled" ? d.value : [];
  if (g.status === "rejected") console.warn("[market] gecko failed:", g.reason instanceof Error ? g.reason.message : g.reason);
  if (d.status === "rejected") console.warn("[market] dexscreener failed:", d.reason instanceof Error ? d.reason.message : d.reason);

  // Gecko is authoritative for ordering; Dex only fills gaps/images. If Gecko is
  // down, Dex becomes the whole list.
  const merged = primary.length ? merge(primary, secondary.length >= 5 ? [] : secondary) : secondary;
  // Still let Dex images patch Gecko tokens that have no logo.
  if (primary.length && secondary.length) {
    const byAddr = new Map(secondary.map((t) => [t.address, t]));
    for (const t of merged) if (!t.imageUrl) t.imageUrl = byAddr.get(t.address)?.imageUrl;
  }

  // Providers answered but nothing matched this tab's filters -> a valid empty
  // list, not an outage. Only a total provider failure counts as an error.
  if (!merged.length) return null;
  const ranked = rank(category, merged).slice(0, 60);
  return { tokens: ranked, ts: Date.now(), source: primary.length ? "geckoterminal" : "dexscreener" };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("category") ?? "trending";
  const category: MarketCategory = (["trending", "new", "volume", "gainers"] as const).includes(raw as MarketCategory)
    ? (raw as MarketCategory)
    : "trending";

  const hit = cache.get(category);
  if (hit && Date.now() - hit.ts < CACHE_MS) {
    return edge(NextResponse.json({ tokens: scrub(hit.tokens), category, source: hit.source, updatedAt: hit.ts, stale: false }), 15, 120);
  }

  let job = inflight.get(category);
  if (!job) {
    job = build(category)
      .catch((e) => {
        console.error("[market] build threw", e);
        return null;
      })
      .finally(() => inflight.delete(category));
    inflight.set(category, job);
  }
  const fresh = await job;
  if (fresh) {
    cache.set(category, fresh);
    return edge(NextResponse.json({ tokens: scrub(fresh.tokens), category, source: fresh.source, updatedAt: fresh.ts, stale: false }), 15, 120);
  }

  if (hit && Date.now() - hit.ts < STALE_MS) {
    return NextResponse.json({ tokens: scrub(hit.tokens), category, source: hit.source, updatedAt: hit.ts, stale: true });
  }
  return NextResponse.json({ tokens: [], category, error: "Market data providers are unreachable right now." }, { status: 502 });
}
