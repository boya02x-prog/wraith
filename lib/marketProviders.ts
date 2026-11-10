// lib/marketProviders.ts
// Server-only: GeckoTerminal + DexScreener fetch/parse helpers shared by the
// market feed, token snapshot and chart routes.

import { isNum, SOLANA_MINT_RE, type MarketToken } from "@/lib/market";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const IGNORED_MINTS = new Set([
  SOL_MINT,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFmCqLMqMHhM9gFm", // USDT
]);
export const IGNORED_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT"]);
const GRADUATION_SOL = 410; // approx. SOL-denominated mcap where pump.fun curves complete

// ── tiny helpers ────────────────────────────────────────────────────────
export function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
export type Json = Record<string, unknown>;
export function obj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// GeckoTerminal's free tier allows ~30 requests/min per IP, shared by EVERYTHING that calls it (scanner pool lists
// as well as chart candles). Two lanes: chart candles/trades get priority (they carry the history users see),
// everything else (scanner lists) is slowed so it cannot eat the whole budget. A real 429 pauses both lanes.
const GECKO_ANY = /^https:\/\/api\.geckoterminal\.com\//;
const GECKO_HIGH = /\/pools\/[^/?]+\/(ohlcv|trades)/;
const GECKO_GAP_HIGH_MS = 2600;
const GECKO_GAP_LOW_MS = 5000;
const GECKO_MAX_WAIT_MS = 9000;
let geckoNextHigh = 0;
let geckoNextLow = 0;
let geckoPauseUntil = 0;
async function geckoSlot(high: boolean): Promise<void> {
  const now = Date.now();
  const base = Math.max(now, geckoPauseUntil);
  const at = high ? Math.max(base, geckoNextHigh) : Math.max(base, geckoNextHigh, geckoNextLow);
  if (at - now > GECKO_MAX_WAIT_MS) throw new Error("gecko queue full");
  if (high) geckoNextHigh = at + GECKO_GAP_HIGH_MS;
  else geckoNextLow = at + GECKO_GAP_LOW_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function getJson(url: string, headers?: Record<string, string>, ms = 9000): Promise<unknown> {
  const paced = GECKO_ANY.test(url);
  if (paced) await geckoSlot(GECKO_HIGH.test(url));
  const res = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(ms),
    cache: "no-store",
  });
  if (paced && res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    geckoPauseUntil = Math.max(geckoPauseUntil, Date.now() + (Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 15_000));
  }
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json();
}

// ── SOL price (for bonding-curve progress estimate) ─────────────────────
let solCache: { price: number; ts: number } | null = null;
export async function getSolUsd(): Promise<number> {
  if (solCache && Date.now() - solCache.ts < 60_000) return solCache.price;
  try {
    const data = obj(await getJson(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`, undefined, 5000));
    const best = arr(data.pairs)
      .map(obj)
      .filter((p) => p.chainId === "solana" && obj(p.quoteToken).symbol === "USDC")
      .sort((a, b) => num(obj(b.liquidity).usd) - num(obj(a.liquidity).usd))[0];
    const price = num(best?.priceUsd);
    if (price > 0) {
      solCache = { price, ts: Date.now() };
      return price;
    }
  } catch {
    /* fall through */
  }
  return solCache?.price ?? 150;
}

export function classify(address: string, dex: string | null, mcap: number, solUsd: number) {
  const d = (dex ?? "").toLowerCase();
  const isPumpMint = address.endsWith("pump");
  const onCurve = d === "pump-fun" || d === "pumpfun";
  const graduated = isPumpMint && !onCurve;
  const curveProgress = onCurve && mcap > 0 ? Math.min(1, mcap / (GRADUATION_SOL * solUsd)) : null;
  return { onCurve, graduated, curveProgress };
}

// ── GeckoTerminal ───────────────────────────────────────────────────────
export function parseGecko(payload: unknown, solUsd: number): MarketToken[] {
  const root = obj(payload);
  const tokenById = new Map<string, Json>();
  const dexById = new Map<string, string>();
  for (const inc of arr(root.included).map(obj)) {
    const id = String(inc.id ?? "");
    if (inc.type === "token") tokenById.set(id, obj(inc.attributes));
    if (inc.type === "dex") dexById.set(id, String(obj(inc.attributes).name ?? id));
  }

  const out: MarketToken[] = [];
  for (const pool of arr(root.data).map(obj)) {
    const a = obj(pool.attributes);
    const rel = obj(pool.relationships);
    const baseId = String(obj(obj(rel.base_token).data).id ?? "");
    const dexId = String(obj(obj(rel.dex).data).id ?? "");
    const tok = tokenById.get(baseId) ?? {};
    const address = String(tok.address ?? baseId.replace(/^solana_/, ""));
    if (!SOLANA_MINT_RE.test(address) || IGNORED_MINTS.has(address)) continue;

    const name = String(a.name ?? "");
    const symbol = String(tok.symbol ?? name.split(" / ")[0] ?? "").trim();
    if (!symbol || IGNORED_SYMBOLS.has(symbol.toUpperCase())) continue;

    const priceUsd = num(a.base_token_price_usd);
    if (priceUsd <= 0) continue;
    const mcap = num(a.market_cap_usd) || num(a.fdv_usd);

    const vol = obj(a.volume_usd);
    const chg = obj(a.price_change_percentage);
    const tx24 = obj(obj(a.transactions).h24);
    const img = typeof tok.image_url === "string" && /^https?:\/\//.test(tok.image_url) ? tok.image_url : undefined;
    const created = a.pool_created_at ? Date.parse(String(a.pool_created_at)) : NaN;
    const dex = dexById.get(dexId) ? dexId : dexId || null;

    out.push({
      address,
      symbol,
      name: String(tok.name ?? symbol),
      imageUrl: img,
      priceUsd,
      mcap,
      liquidity: num(a.reserve_in_usd),
      volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
      change: { m5: numOrNull(chg.m5), h1: numOrNull(chg.h1), h6: numOrNull(chg.h6), h24: numOrNull(chg.h24) },
      txns: { buys: num(tx24.buys), sells: num(tx24.sells) },
      createdAt: Number.isFinite(created) ? created : null,
      dex,
      pairAddress: typeof a.address === "string" ? a.address : null,
      ...classify(address, dex, mcap, solUsd),
    });
  }
  return out;
}

export const GECKO_HEADERS = { accept: "application/json;version=20230302" };
export const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";
export const INC = "include=base_token,dex";

export async function geckoPages(path: string, pages: number[], solUsd: number): Promise<MarketToken[]> {
  const results = await Promise.allSettled(
    pages.map((p) => getJson(`${GECKO}/${path}${path.includes("?") ? "&" : "?"}${INC}&page=${p}`, GECKO_HEADERS)),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === "fulfilled");
  if (!ok.length) throw new Error("gecko: all requests failed");
  return ok.flatMap((r) => parseGecko(r.value, solUsd));
}

// ── DexScreener ─────────────────────────────────────────────────────────
export function parseDexPair(p: Json, solUsd: number): MarketToken | null {
  if (p.chainId !== "solana") return null;
  const base = obj(p.baseToken);
  const address = String(base.address ?? "");
  if (!SOLANA_MINT_RE.test(address) || IGNORED_MINTS.has(address)) return null;
  const priceUsd = num(p.priceUsd);
  if (priceUsd <= 0) return null;
  const mcap = num(p.marketCap) || num(p.fdv);
  const vol = obj(p.volume);
  const chg = obj(p.priceChange);
  const tx24 = obj(obj(p.txns).h24);
  const dex = typeof p.dexId === "string" ? p.dexId : null;
  const img = obj(p.info).imageUrl;
  return {
    address,
    symbol: String(base.symbol ?? "?"),
    name: String(base.name ?? base.symbol ?? "?"),
    imageUrl: typeof img === "string" ? img : undefined,
    priceUsd,
    mcap,
    liquidity: num(obj(p.liquidity).usd),
    volume: { m5: num(vol.m5), h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    change: { m5: numOrNull(chg.m5), h1: numOrNull(chg.h1), h6: numOrNull(chg.h6), h24: numOrNull(chg.h24) },
    txns: { buys: num(tx24.buys), sells: num(tx24.sells) },
    createdAt: isNum(p.pairCreatedAt) ? (p.pairCreatedAt as number) : null,
    dex,
    pairAddress: typeof p.pairAddress === "string" ? p.pairAddress : null,
    ...classify(address, dex, mcap, solUsd),
  };
}


const poolCache = new Map<string, { pool: string | null; ts: number }>();
const POOL_TTL_MS = 5 * 60_000;

// ── pool resolution ─────────────────────────────────────────────────────
export async function resolvePool(mint: string): Promise<string | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.ts < POOL_TTL_MS) return hit.pool;

  let pool: string | null = null;
  try {
    const data = obj(await getJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, undefined, 5000));
    const best = arr(data.pairs)
      .map(obj)
      .filter((p) => p.chainId === "solana" && obj(p.baseToken).address === mint && typeof p.pairAddress === "string")
      .sort((a, b) => num(obj(b.liquidity).usd) - num(obj(a.liquidity).usd))[0];
    if (best) pool = String(best.pairAddress);
  } catch {
    /* fall through to Gecko */
  }

  if (!pool) {
    try {
      const payload = await getJson(`${GECKO}/tokens/${encodeURIComponent(mint)}/pools?${INC}&page=1`, GECKO_HEADERS, 6000);
      const best = parseGecko(payload, 150)
        .filter((t) => t.address === mint && t.pairAddress)
        .sort((a, b) => b.liquidity - a.liquidity)[0];
      pool = best?.pairAddress ?? null;
    } catch {
      /* no pool found */
    }
  }

  // Only cache negatives briefly so a brand-new token is retried quickly.
  poolCache.set(mint, { pool, ts: pool ? Date.now() : Date.now() - POOL_TTL_MS + 15_000 });
  return pool;
}

