// Parsed on-chain swaps via Helius (the RPC you already pay for). Fast, includes pump.fun curve + PumpSwap + Raydium etc.
// Used as the primary source for the Swaps tab and as an OHLCV source when GeckoTerminal / Birdeye are limited.
import { PublicKey } from "@solana/web3.js";
import { getSolUsd, resolvePool } from "@/lib/marketProviders";

export interface Swap {
  sig: string;
  ts: number; // ms
  side: "buy" | "sell";
  tokens: number;
  sol: number;
  priceSol: number;
  wallet: string;
}

const WSOL = "So11111111111111111111111111111111111111112";
export function heliusKey(): string | null {
  const urls = [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC].filter(Boolean) as string[];
  for (const u of urls) {
    try { const k = new URL(u).searchParams.get("api-key"); if (k) return k; } catch { /* next */ }
  }
  return process.env.HELIUS_API_KEY ?? null;
}
export function heliusRpcUrl(): string | null {
  const urls = [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC].filter(Boolean) as string[];
  return urls.find((u) => u.includes("helius-rpc.com")) ?? null;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const n = (v: unknown): number => { const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(x) ? x : 0; };
const tokAmt = (t: Obj): number => {
  const raw = o(t.rawTokenAmount);
  if (raw.tokenAmount !== undefined) return n(raw.tokenAmount) / 10 ** n(raw.decimals);
  return n(t.tokenAmount);
};

function parseSwapEvent(tx: Obj, mint: string): Swap | null {
  const sw = o(o(tx.events).swap);
  const ins = a(sw.tokenInputs).map(o), outs = a(sw.tokenOutputs).map(o);
  const nIn = n(o(sw.nativeInput).amount) / 1e9, nOut = n(o(sw.nativeOutput).amount) / 1e9;
  const wIn = ins.filter((t) => t.mint === WSOL).reduce((s, t) => s + tokAmt(t), 0);
  const wOut = outs.filter((t) => t.mint === WSOL).reduce((s, t) => s + tokAmt(t), 0);
  const bought = outs.filter((t) => t.mint === mint).reduce((s, t) => s + tokAmt(t), 0);
  const sold = ins.filter((t) => t.mint === mint).reduce((s, t) => s + tokAmt(t), 0);
  const ts = n(tx.timestamp) * 1000;
  const sig = String(tx.signature ?? "");
  if (!ts || !sig) return null;
  const wallet = String(tx.feePayer ?? "");
  if (bought > 0 && sold === 0) {
    const sol = nIn || wIn;
    return sol > 0 ? { sig, ts, side: "buy", tokens: bought, sol, priceSol: sol / bought, wallet } : null;
  }
  if (sold > 0 && bought === 0) {
    const sol = nOut || wOut;
    return sol > 0 ? { sig, ts, side: "sell", tokens: sold, sol, priceSol: sol / sold, wallet } : null;
  }
  return null;
}

/**
 * One transaction -> one trade of `mint`. Helius gives a clean swap breakdown for AMM trades, but NOT for pump.fun bonding-curve
 * trades (most fresh tokens), which used to be dropped: only about 4% of calls ever got buyer data. For those, read the trader's own
 * token and SOL movements instead (same method as lib/walletHistory.ts).
 */
function parse(tx: Obj, mint: string): Swap | null {
  const viaEvent = parseSwapEvent(tx, mint);
  if (viaEvent) return viaEvent;
  const wallet = String(tx.feePayer ?? "");
  const ts = n(tx.timestamp) * 1000;
  const sig = String(tx.signature ?? "");
  if (!wallet || !ts || !sig) return null;
  const moves = a(tx.tokenTransfers).map(o).filter((t) => t.mint === mint);
  const got = moves.filter((t) => t.toUserAccount === wallet).reduce((s, t) => s + n(t.tokenAmount), 0);
  const gave = moves.filter((t) => t.fromUserAccount === wallet).reduce((s, t) => s + n(t.tokenAmount), 0);
  const change = n(a(tx.accountData).map(o).find((d) => d.account === wallet)?.nativeBalanceChange) / 1e9; // includes the fee
  const fee = n(tx.fee) / 1e9;
  if (got > 0 && gave === 0 && change < -0.002) { const sol = -change - fee; return sol > 0 ? { sig, ts, side: "buy", tokens: got, sol, priceSol: sol / got, wallet } : null; }
  if (gave > 0 && got === 0 && change > 0.002) { const sol = change + fee; return sol > 0 ? { sig, ts, side: "sell", tokens: gave, sol, priceSol: sol / gave, wallet } : null; }
  return null;
}

// Shared throttle: Helius rate-limits per second, so never run more than a few requests at once and
// stop calling for a few seconds after a 429 instead of hammering it.
const MAX_PARALLEL = 2;
let running = 0;
let cooldownUntil = 0;
let lastWarn = 0;
const waiters: Array<() => void> = [];
// Measured on the production key: this API answers about 5 requests a second (a burst of 8 gets one 429; one every 250ms never does).
// Requests start at most every 400ms, two at a time, so a busy scanner round no longer trips the limit and loses whole tokens to the 4s pause.
const MIN_GAP_MS = 400;
let nextStart = 0;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  running++;
  const now = Date.now();
  const startAt = Math.max(now, nextStart);
  nextStart = startAt + MIN_GAP_MS;
  if (startAt > now) await new Promise<void>((r) => setTimeout(r, startAt - now));
  try { return await fn(); }
  finally { running--; const next = waiters.shift(); if (next) next(); }
}

/** Newest-first swaps of a mint. `pages` x 100 transactions. Returns null if Helius is unavailable. */
export async function fetchSwaps(mint: string, pages = 1, address?: string | null): Promise<Swap[] | null> {
  const key = heliusKey();
  if (!key) return null;
  if (Date.now() < cooldownUntil) return null;
  const out: Swap[] = [];
  let before = "";
  for (let i = 0; i < pages; i++) {
    const url = `https://api.helius.xyz/v0/addresses/${address || mint}/transactions?api-key=${key}&type=SWAP&limit=100${before ? `&before=${before}` : ""}`;
    let rows: Obj[] | null = null;
    // a 429 is a "slow down", not a failure: wait a moment and ask again (twice), and only pause everyone if it keeps happening
    for (let attempt = 0; attempt < 3 && !rows; attempt++) {
      try {
        const res = await slot(() => fetch(url, { signal: AbortSignal.timeout(7000), cache: "no-store" }));
        if (res.status === 429) {
          if (attempt < 2) { await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); continue; }
          cooldownUntil = Date.now() + 2000;
          if (Date.now() - lastWarn > 10000) { lastWarn = Date.now(); console.warn("[helius swaps] still 429 after retries, pausing 2s"); }
          return out.length ? out : null;
        }
        if (!res.ok) { console.warn("[helius swaps]", res.status, (await res.text().catch(() => "")).slice(0, 160)); return out.length ? out : null; }
        rows = a(await res.json()).map(o);
      } catch (e) { console.warn("[helius swaps] failed:", e instanceof Error ? e.message : e); return out.length ? out : null; }
    }
    if (!rows || !rows.length) break;
    for (const r of rows) { const s = parse(r, mint); if (s) out.push(s); }
    before = String(rows[rows.length - 1].signature ?? "");
    if (rows.length < 100 || !before) break;
  }
  return out;
}

export async function swapsToCandles(swaps: Swap[], sec: number): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const solUsd = await getSolUsd();
  const step = sec * 1000;
  // Drop dust trades and one-off bad prints (multi-hop / partial parses) that stretch the whole chart:
  // a swap whose price is >4x away from the median of its neighbours is not a real price.
  const byTime = [...swaps].filter((x) => x.sol >= 0.003 && x.priceSol > 0).sort((x, y) => x.ts - y.ts);
  const sorted = byTime.filter((sw, i) => {
    const lo = Math.max(0, i - 6), hi = Math.min(byTime.length, i + 7);
    const near = byTime.slice(lo, hi).map((q) => q.priceSol).sort((a2, b2) => a2 - b2);
    if (near.length < 5) return true;
    const med = near[Math.floor(near.length / 2)];
    return sw.priceSol <= med * 4 && sw.priceSol >= med / 4;
  });
  if (!sorted.length) return [];
  const map = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
  for (const s of sorted) {
    const t = Math.floor(s.ts / step) * step;
    const p = s.priceSol * solUsd;
    const cur = map.get(t);
    if (!cur) map.set(t, { t, o: p, h: p, l: p, c: p, v: s.sol * solUsd });
    else { cur.h = Math.max(cur.h, p); cur.l = Math.min(cur.l, p); cur.c = p; cur.v += s.sol * solUsd; }
  }
  return [...map.values()];
}

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
function curvePda(mint: string): string | null {
  try { return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP_PROGRAM))[0].toBase58(); } catch { return null; }
}
const swapCache = new Map<string, { ts: number; swaps: Swap[] }>();

/**
 * Swaps for any token. A pump.fun token still on its bonding curve is asked about the curve first (one place, one answer, and
 * the fewest requests); anything else, or a curve with too little to go on, asks the mint and the pool at the same time and takes
 * the first non-empty answer. No indexer (DexScreener / Gecko) sits in front of it, so a token that is 1-2 minutes old answers as
 * fast as an old one.
 */
export async function fetchTokenSwaps(mint: string, pages = 2): Promise<Swap[] | null> {
  const hit = swapCache.get(mint);
  if (hit && Date.now() - hit.ts < 8000) return hit.swaps;
  const keep = (swaps: Swap[]) => {
    swapCache.set(mint, { ts: Date.now(), swaps });
    if (swapCache.size > 200) swapCache.clear();
    return swaps;
  };
  const curve = mint.endsWith("pump") ? curvePda(mint) : null;
  let best: Swap[] | null = null;
  if (curve) {
    best = await fetchSwaps(mint, pages, curve);
    if (best && best.length >= 8) return keep(best);
  }
  const nonEmpty = (p: Promise<Swap[] | null>) => p.then((r) => { if (!r || !r.length) throw new Error("empty"); return r; });
  const tries: Promise<Swap[]>[] = [];
  if (!curve) tries.push(nonEmpty(fetchSwaps(mint, pages)));
  tries.push(nonEmpty((async () => {
    const pool = await Promise.race([resolvePool(mint).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    return pool ? fetchSwaps(mint, pages, pool) : null;
  })()));
  try {
    const swaps = await Promise.any(tries);
    return keep(best && best.length > swaps.length ? best : swaps);
  } catch {
    return best && best.length ? keep(best) : null;
  }
}
