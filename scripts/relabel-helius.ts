/**
 * Rebuilds each call's real price path from ON-CHAIN TRADES (Helius research key), instead of waiting on GeckoTerminal's tiny shared limit.
 *   npx tsx scripts/relabel-helius.ts [max=50] [--validate] [--calls=15000]
 * How: for a pump.fun token it reads the trades on its trading account (the PumpSwap pool, and the bonding curve for the part before
 * it graduated) inside the 24h after the call, oldest first. Each trade's price is read from the POOL'S OWN balance changes
 * (quote tokens in or out divided by base tokens out or in), which is exact and ignores tips, routers and wrapped SOL.
 * Trades are grouped into 5-minute candles and fed through the same pathStats() as the GeckoTerminal version.
 * --validate compares the result with GeckoTerminal candles for calls that have both (scripts/.pilot/paths.json) and prints the agreement.
 * Output: scripts/.pilot/paths-helius.json and candles-helius.jsonl (saved as it goes; safe to stop and rerun).
 * Only pump.fun tokens (mint ends in "pump") are handled here; others stay with the GeckoTerminal job.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { PublicKey } from "@solana/web3.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dexPairs, emptyRec, pathStats, seriesOf, type Candle, type PathRec } from "./pathlib";

const KEY = (process.env.HELIUS_RESEARCH_KEY ?? "").trim();
if (!KEY) { console.error("Set HELIUS_RESEARCH_KEY in .env.local"); process.exit(1); }
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 50);
const VALIDATE = process.argv.includes("--validate"), REDO = process.argv.includes("--redo");
const CALL_CAP = Number((process.argv.find((a) => a.startsWith("--calls=")) ?? "--calls=15000").split("=")[1]);
const OUT = "scripts/.pilot/paths-helius.json", CANDLES = "scripts/.pilot/candles-helius.jsonl";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL = "So11111111111111111111111111111111111111112";
const QUOTES = [WSOL, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFmCqLMqMHhM9gFm"]; // SOL, USDC, USDT
const BUSY_TXS = 6000; // more successful transactions than this in a day: skip (the candle route handles busy tokens)
let busyN = 0;
const PAGES_PER_ADDRESS = 70, MIN_TRADE_SOL = 0.002; // prices come from the pool's own balances (exact), so small trades are safe to use
let apiCalls = 0, lastCall = 0;
const why = { txs: 0, dust: 0, sameSign: 0, noBase: 0, ok: 0 };

type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function rpc(method: string, params: unknown[]): Promise<{ result?: O; error?: O } | null> {
  for (let i = 0; i < 4; i++) {
    const wait = Math.max(0, lastCall + 220 - Date.now()); // about 4 requests a second
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now(); apiCalls++;
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(40000) }).catch(() => null);
    if (res && res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); continue; }
    if (!res || !res.ok) return null;
    return (await res.json()) as { result?: O; error?: O };
  }
  return null;
}

/** How many successful transactions touch this account in the window? Signature-only pages (1000 each) are far cheaper than full ones. */
async function countTxs(address: string, from: number, to: number, cap: number): Promise<{ n: number; more: boolean }> {
  let n = 0, token: string | undefined;
  for (let pages = 0; pages < Math.ceil(cap / 1000) + 1; pages++) {
    const opts: O = { transactionDetails: "signatures", sortOrder: "asc", limit: 1000, filters: { status: "succeeded", blockTime: { gte: from, lte: to } } };
    if (token) opts.paginationToken = token;
    const r = await rpc("getTransactionsForAddress", [address, opts]);
    const res = r?.result as { data?: unknown[]; paginationToken?: string } | undefined;
    n += res?.data?.length ?? 0;
    token = res?.paginationToken;
    if (!token) return { n, more: false };
    if (n >= cap) return { n, more: true };
  }
  return { n, more: true };
}

interface Trade { t: number; p: number; sol: number }

/** All trades on one trading account inside the window, as (time, price in SOL per token, size in SOL). kind decides how the price is read. */
async function trades(address: string, kind: "pool" | "curve", mint: string, from: number, to: number): Promise<{ list: Trade[]; truncated: boolean; lastT: number; stable: boolean }> {
  const list: Trade[] = [];
  let token: string | undefined, pages = 0, truncated = false, lastT = from, stable = false;
  while (pages < PAGES_PER_ADDRESS && apiCalls < CALL_CAP) {
    const opts: O = { transactionDetails: "full", encoding: "jsonParsed", maxSupportedTransactionVersion: 1, sortOrder: "asc", limit: 100, filters: { status: "succeeded", blockTime: { gte: from, lte: to } } };
    if (token) opts.paginationToken = token;
    const r = await rpc("getTransactionsForAddress", [address, opts]);
    pages++;
    const res = r?.result as { data?: O[]; paginationToken?: string } | undefined;
    const data = res?.data ?? [];
    for (const d of data) {
      const meta = d.meta as O | undefined, bt = num(d.blockTime);
      if (!meta || meta.err || !bt) continue;
      lastT = Math.max(lastT, bt);
      const msg = o(o(d.transaction).message);
      const keys = (Array.isArray(msg.accountKeys) ? msg.accountKeys : []).map((k) => (typeof k === "string" ? k : String(o(k).pubkey)));
      const bal = (arr: unknown, test: (b: O) => boolean) => (Array.isArray(arr) ? (arr as O[]) : []).filter(test).reduce((s, b) => s + num(o(b.uiTokenAmount).uiAmount), 0);
      let base = 0, quote = 0;
      if (kind === "pool") {
        base = bal(meta.postTokenBalances, (b) => b.owner === address && b.mint === mint) - bal(meta.preTokenBalances, (b) => b.owner === address && b.mint === mint);
        // the quote side is SOL (wrapped) for most pools; some are quoted in USDC / USDT. Only prices in SOL or a dollar stablecoin are usable.
        quote = 0;
        for (const q of QUOTES) {
          const dq = bal(meta.postTokenBalances, (b) => b.owner === address && b.mint === q) - bal(meta.preTokenBalances, (b) => b.owner === address && b.mint === q);
          if (dq !== 0) { quote = q === WSOL ? dq : dq / 100; if (q !== WSOL) stable = true; break; } // stables are scaled to look like 1/100 so one dust limit fits all
        }
      } else {
        base = bal(meta.postTokenBalances, (b) => b.owner === address && b.mint === mint) - bal(meta.preTokenBalances, (b) => b.owner === address && b.mint === mint);
        const idx = keys.indexOf(address);
        quote = idx >= 0 ? (num((meta.postBalances as number[])[idx]) - num((meta.preBalances as number[])[idx])) / 1e9 : 0;
      }
      const sol = Math.abs(quote);
      why.txs++;
      if (base === 0) why.noBase++; else if (!(sol >= MIN_TRADE_SOL)) why.dust++; else if (Math.sign(base) === Math.sign(quote)) why.sameSign++; else why.ok++;
      // a trade moves base and quote in OPPOSITE directions; ignore dust and anything else (liquidity changes move them the same way)
      if (!(sol >= MIN_TRADE_SOL) || base === 0 || Math.sign(base) === Math.sign(quote)) continue;
      list.push({ t: bt, p: sol / Math.abs(base), sol });
    }
    token = res?.paginationToken;
    if (!token || !data.length) break;
    if (pages >= PAGES_PER_ADDRESS) truncated = true;
  }
  return { list, truncated, lastT, stable };
}

/** 5-minute candles from trades, dropping single prints far from their neighbours. */
function toCandles(all: Trade[]): Candle[] {
  const t = [...all].sort((a, b) => a.t - b.t);
  const clean = t.filter((x, i) => {
    const lo = Math.max(0, i - 6), hi = Math.min(t.length, i + 7);
    const near = t.slice(lo, hi).map((q) => q.p).sort((a, b) => a - b);
    if (near.length < 5) return true;
    const med = near[Math.floor(near.length / 2)];
    return x.p <= med * 4 && x.p >= med / 4;
  });
  const by = new Map<number, Candle>();
  for (const x of clean) {
    const b = Math.floor(x.t / 300) * 300;
    const c = by.get(b);
    if (!c) by.set(b, [b, x.p, x.p, x.p, x.p, x.sol]);
    else { c[2] = Math.max(c[2], x.p); c[3] = Math.min(c[3], x.p); c[4] = x.p; c[5] += x.sol; }
  }
  return [...by.values()].sort((a, b) => a[0] - b[0]);
}

async function main() {
  mkdirSync("scripts/.pilot", { recursive: true });
  const done: Record<string, PathRec> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const gecko: Record<string, PathRec> = existsSync("scripts/.pilot/paths.json") ? JSON.parse(readFileSync("scripts/.pilot/paths.json", "utf8")) : {};
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 26 * 3_600_000 }, address: /pump$/, chain: { $in: [null, "solana"] } },
      { projection: { address: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, engine: 1, shadow: 1 } }).toArray();
  await c.close();
  let todo = calls.filter((x) => !done[x.address as string] || (REDO && !done[x.address as string].ok));
  if (VALIDATE) todo = todo.filter((x) => gecko[x.address as string]?.ok);
  todo = todo.sort((a, b) => Number(b.engine === 2 && !b.shadow) - Number(a.engine === 2 && !a.shadow) || (b.spottedAt as number) - (a.spottedAt as number)).slice(0, MAX);
  console.log(`${calls.length} pump.fun calls eligible, ${Object.keys(done).length} already done, doing ${todo.length}${VALIDATE ? " (only calls that also have GeckoTerminal candles)" : ""}`);
  const pairs = await dexPairs(todo.map((x) => x.address as string));
  const cmp: { h: PathRec; g: PathRec }[] = [];
  let n = 0, nodata = 0, started = Date.now();
  for (const t of todo) {
    if (apiCalls >= CALL_CAP) { console.log("call cap reached"); break; }
    const mint = t.address as string, t0 = Math.floor((t.spottedAt as number) / 1000);
    const from = t0 - 900, to = t0 + 24 * 3600;
    const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();
    const pr = pairs.get(mint);
    const all: Trade[] = [];
    const before = { ...why };
    let truncated = false, lastT = from;
    // light count first: very busy tokens would need thousands of full pages, so they are left to the GeckoTerminal candle route
    const targets = [curve, ...(pr && pr.pair !== curve ? [pr.pair] : [])];
    let total = 0, busy = false;
    for (const a of targets) { const k = await countTxs(a, from, to, BUSY_TXS); total += k.n; if (k.more || total >= BUSY_TXS) { busy = true; break; } }
    if (busy) {
      const rec = emptyRec(mint, pr?.pair ?? curve); rec.src = "helius"; rec.note = "busy"; done[mint] = rec; busyN++; n++;
      continue;
    }
    const cv = await trades(curve, "curve", mint, from, to); all.push(...cv.list); truncated ||= cv.truncated; lastT = Math.max(lastT, cv.lastT);
    if (pr && pr.pair !== curve) {
      const pl = await trades(pr.pair, "pool", mint, from, to);
      // a pool quoted in a dollar stablecoin has a different price unit from the SOL-priced curve: never mix the two
      if (pl.stable) all.length = 0;
      all.push(...pl.list); truncated ||= pl.truncated; lastT = Math.max(lastT, pl.lastT);
    }
    const candles = toCandles(all);
    const rec = candles.length >= 3 ? pathStats(mint, pr?.pair ?? curve, candles, t0) : emptyRec(mint, pr?.pair ?? curve);
    rec.src = "helius";
    if (rec.ok && truncated) rec.coverMin = Math.min(rec.coverMin ?? 1440, Math.round((lastT - t0) / 60));
    // a path that only covers the first few minutes says nothing about the day: leave those to the GeckoTerminal route
    if (rec.ok && (rec.coverMin ?? 1440) < 30) rec.ok = false;
    done[mint] = rec;
    if (rec.ok && rec.p0 > 0) appendFileSync(CANDLES, JSON.stringify({ addr: mint, at: t.spottedAt, engine: t.engine ?? null, shadow: !!t.shadow, cover: rec.coverMin ?? 1440, s: seriesOf(candles, rec.p0, t0) }) + "\n");
    else { nodata++; if (VALIDATE || REDO) console.log(`    no path for ${mint.slice(0, 8)} (${pr?.dex ?? "no pair"}): trades seen ${why.txs - before.txs}, usable ${why.ok - before.ok}, dust ${why.dust - before.dust}, same-direction ${why.sameSign - before.sameSign}, no base move ${why.noBase - before.noBase}`); }
    n++;
    const g = gecko[mint];
    if (rec.ok && g?.ok) cmp.push({ h: rec, g });
    if (n % 10 === 0) {
      writeFileSync(OUT, JSON.stringify(done));
      console.log(`  ${n}/${todo.length} done | ${apiCalls} API calls (${(apiCalls / n).toFixed(1)} per call) | ${busyN} too busy (left to the candle route) | ${nodata} no usable trades | ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
  writeFileSync(OUT, JSON.stringify(done));
  console.log(`\nfinished ${n} calls, ${apiCalls} API calls, ${nodata} without usable trades. Stored ${Object.keys(done).length}`);
  if (cmp.length >= 5) {
    const logErr = cmp.map(({ h, g }) => Math.abs(Math.log(Math.max(1e-6, h.peak24h) / Math.max(1e-6, g.peak24h))));
    const agree2x = cmp.filter(({ h, g }) => (h.peak24h >= 2) === (g.peak24h >= 2)).length;
    const hi = cmp.filter(({ h, g }) => h.peak24h > g.peak24h * 1.1).length, lo = cmp.filter(({ h, g }) => h.peak24h < g.peak24h / 1.1).length;
    console.log(`\nVALIDATION against GeckoTerminal candles on ${cmp.length} calls:`);
    console.log(`  same answer to "did it reach 2x?": ${agree2x}/${cmp.length}`);
    console.log(`  median difference in the 24h peak: ${(Math.exp([...logErr].sort((a, b) => a - b)[Math.floor(logErr.length / 2)]) - 1).toFixed(2)}x of the value | Helius higher on ${hi}, lower on ${lo}`);
    console.log(`  "2x before losing half" agrees on ${cmp.filter(({ h, g }) => h.clean2x === g.clean2x).length}/${cmp.length}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
