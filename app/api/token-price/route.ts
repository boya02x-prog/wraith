// app/api/token-price/route.ts
// Full live snapshot for ONE token. Backwards compatible with the old shape
// (TokenTradeDock reads priceUsd / marketCap / liquidity / priceChange / ...)
// plus the extra fields the new token page needs (image, pair, multi-window
// txns + volume, socials, bonding-curve state).
//
// Sources: DexScreener first (socials, image, boosts), GeckoTerminal second.
// A 3s server cache + in-flight de-dupe means 50 viewers polling the same
// token cost ONE upstream request.

import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE, type MarketToken } from "@/lib/market";
import {
  arr,
  GECKO,
  GECKO_HEADERS,
  getJson,
  getSolUsd,
  INC,
  num,
  obj,
  parseDexPair,
  parseGecko,
  type Json,
} from "@/lib/marketProviders";
import { getSandboxToken, sandboxSnapshot } from "@/lib/devnetTokens";

type Snapshot = Record<string, unknown>;
const CACHE_MS = 3_000;
const cache = new Map<string, { data: Snapshot; ts: number }>();
const inflight = new Map<string, Promise<Snapshot | null>>();

function httpsUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
function text(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function windowTxns(p: Json) {
  const t = obj(p.txns);
  const w = (k: string) => ({ buys: num(obj(t[k]).buys), sells: num(obj(t[k]).sells) });
  return { m5: w("m5"), h1: w("h1"), h6: w("h6"), h24: w("h24") };
}

function snapshotFrom(token: MarketToken, extra: { pair?: Json; txns?: ReturnType<typeof windowTxns> }): Snapshot {
  const pair = extra.pair ?? {};
  const info = obj(pair.info);
  const socials = arr(info.socials).map(obj);
  const social = (type: string) =>
    socials
      .filter((s) => typeof s.type === "string" && s.type.toLowerCase() === type)
      .map((s) => httpsUrl(s.url))
      .find(Boolean) ?? null;
  const website = arr(info.websites).map((w) => httpsUrl(obj(w).url)).find(Boolean) ?? null;
  const txns = extra.txns ?? { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: token.txns };
  const supply = token.mcap > 0 && token.priceUsd > 0 ? token.mcap / token.priceUsd : null;

  return {
    // ── legacy keys ──
    mint: token.address,
    priceUsd: token.priceUsd,
    name: token.name,
    symbol: token.symbol,
    description: text(info.description),
    marketCap: token.mcap > 0 ? token.mcap : null,
    liquidity: token.liquidity,
    volume24h: token.volume.h24,
    buys24h: txns.h24.buys,
    sells24h: txns.h24.sells,
    priceChange: token.change,
    dexId: token.dex,
    pairCreatedAt: token.createdAt,
    website,
    twitter: social("twitter"),
    telegram: social("telegram"),
    updatedAt: new Date().toISOString(),
    // ── new keys ──
    imageUrl: token.imageUrl ?? null,
    pairAddress: token.pairAddress,
    supply,
    volume: token.volume,
    txns,
    onCurve: token.onCurve,
    graduated: token.graduated,
    curveProgress: token.curveProgress,
  };
}

async function fromDexScreener(mint: string, solUsd: number): Promise<Snapshot | null> {
  const data = obj(await getJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, undefined, 4000));
  const pairs = arr(data.pairs)
    .map(obj)
    .filter((p) => p.chainId === "solana" && num(p.priceUsd) > 0 && obj(p.baseToken).address === mint)
    .sort((a, b) => num(obj(b.liquidity).usd) - num(obj(a.liquidity).usd));
  const best = pairs[0];
  if (!best) return null;
  const token = parseDexPair(best, solUsd);
  if (!token) return null;
  // Age: a graduated token's best pool is newer than the token, so use the oldest pool we can see.
  const created = pairs.map((p) => num(p.pairCreatedAt)).filter((n) => n > 0);
  if (created.length) token.createdAt = Math.min(...created);
  // Aggregate volume across ALL pools of the token — otherwise a graduated
  // token only shows the volume of one pool.
  if (pairs.length > 1) {
    for (const k of ["m5", "h1", "h6", "h24"] as const) {
      token.volume[k] = pairs.reduce((sum, p) => sum + num(obj(p.volume)[k]), 0);
    }
  }
  return snapshotFrom(token, { pair: best, txns: windowTxns(best) });
}

async function fromGecko(mint: string, solUsd: number): Promise<Snapshot | null> {
  const payload = await getJson(`${GECKO}/tokens/${encodeURIComponent(mint)}/pools?${INC}&page=1`, GECKO_HEADERS, 8000);
  const tokens = parseGecko(payload, solUsd)
    .filter((t) => t.address === mint)
    .sort((a, b) => b.liquidity - a.liquidity);
  if (!tokens[0]) return null;
  return snapshotFrom(tokens[0], {});
}

async function build(mint: string): Promise<Snapshot | null> {
  // SOL price only feeds the curve-progress estimate: never let it hold the snapshot up.
  const solUsd = await Promise.race([getSolUsd(), new Promise<number>((r) => setTimeout(() => r(150), 1200))]);
  try {
    const snap = await fromDexScreener(mint, solUsd);
    if (snap) {
      // DexScreener rarely lags, but backfill a missing logo from Gecko when needed.
      return snap;
    }
  } catch (e) {
    console.warn("[token-price] dexscreener failed:", e instanceof Error ? e.message : e);
  }
  try {
    return await fromGecko(mint, solUsd);
  } catch (e) {
    console.warn("[token-price] gecko failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) {
    return NextResponse.json({ error: "Invalid Solana mint" }, { status: 400 });
  }

  const sandboxTok = await getSandboxToken(mint);
  if (sandboxTok) return NextResponse.json(await sandboxSnapshot(sandboxTok));

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < CACHE_MS) return edge(NextResponse.json(hit.data), 2, 3);
  // Stale-while-revalidate: answer instantly from the last good snapshot and refresh behind the scenes.
  if (hit && Date.now() - hit.ts < 10 * 60_000 && !inflight.has(mint)) {
    const bg = build(mint).then((d) => { if (d) cache.set(mint, { data: d, ts: Date.now() }); return d; }).catch(() => null).finally(() => inflight.delete(mint));
    inflight.set(mint, bg);
    // background refresh is already running: only call it "stale" when it is genuinely old (a 3s-old snapshot is not delayed)
    return NextResponse.json(Date.now() - hit.ts > 45_000 ? { ...hit.data, stale: true } : hit.data);
  }

  let job = inflight.get(mint);
  if (!job) {
    job = build(mint)
      .catch((e) => {
        console.error("[token-price]", e);
        return null;
      })
      .finally(() => inflight.delete(mint));
    inflight.set(mint, job);
  }
  const data = await job;
  if (data) {
    cache.set(mint, { data, ts: Date.now() });
    if (cache.size > 500) {
      const cutoff = Date.now() - 60_000;
      for (const [k, v] of cache) if (v.ts < cutoff) cache.delete(k);
    }
    return edge(NextResponse.json(data), 2, 3);
  }
  // Serve a recent snapshot rather than an error flash while providers hiccup.
  if (hit && Date.now() - hit.ts < 120_000) return NextResponse.json({ ...hit.data, stale: true });
  return NextResponse.json({ error: "Token price unavailable" }, { status: 404 });
}
