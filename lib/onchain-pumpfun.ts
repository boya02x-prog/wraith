// ─── ON-CHAIN PUMP.FUN TRADE FETCHER ────────────────────────────────────────
// Reads trades directly from the bonding curve account's transaction history
// on Solana, using balance deltas (not instruction-arg decoding) to compute
// exact SOL and token amounts.
//
// KEY CHANGE: raw trades are now cached per-MINT (not per mint+timeframe).
// Switching timeframes in the UI used to re-run getSignaturesForAddress +
// hundreds of getParsedTransaction calls every single time — that's the
// "whole minutes" delay. Now the expensive RPC walk happens once per mint
// per TRADE_CACHE_MS window, and every timeframe just re-buckets the same
// cached trades in memory, which is near-instant.
//
// GRADUATION SUPPORT: the bonding curve account goes permanently silent once
// a token graduates to PumpSwap — all trading moves to a new pool account
// this file never used to look at. getCachedOnChainTrades now also resolves
// the PumpSwap pool (via getPumpSwapPoolAddress) and merges pool trades in
// alongside curve trades, so graduated tokens show their full history
// instead of stopping cold at the migration point.

import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

function getBondingCurvePDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID,
  );
  return pda;
}

export interface OnChainTrade {
  timestamp: number; // seconds
  solAmount: number; // absolute SOL delta for the trader
  tokenAmount: number; // absolute token delta for the trader (UI units, 6 decimals)
}

// ─── RAW TRADE CACHE (per mint, NOT per timeframe) ──────────────────────────
const TRADE_CACHE_MS = 180_000; // 3 minutes — RPC calls are now the scarce resource under free-tier limits, so favor cache hits harder
const _tradeCache = new Map<string, { trades: OnChainTrade[]; ts: number }>();
const _inFlight = new Map<string, Promise<OnChainTrade[]>>();

// ─── GLOBAL RPC THROTTLE ─────────────────────────────────────────────────────
// The Helius 429s here are a REAL rate limit on a free-tier key, not a bug —
// getParsedTransactions batches are compute-heavy and the free plan caps
// both requests/sec and compute credits. A concurrency cap alone doesn't
// stop bursts (three fast calls back-to-back still count as a burst even if
// only one is "in flight" at a time in wall-clock terms), so this enforces
// BOTH: only one getParsedTransactions call in flight at once, across every
// token being viewed, AND a minimum gap between when one finishes and the
// next is allowed to start. This makes chart loads slower under load, but
// trades that for actually succeeding instead of coming back all-null.
const MAX_CONCURRENT_RPC_CHUNKS = 1;
const MIN_GAP_BETWEEN_RPC_CALLS_MS = 500;
let _activeRpcChunks = 0;
let _lastRpcCallAt = 0;
const _rpcQueue: (() => void)[] = [];

async function acquireRpcSlot(): Promise<() => void> {
  const run = async (): Promise<() => void> => {
    const now = Date.now();
    const wait = Math.max(
      0,
      _lastRpcCallAt + MIN_GAP_BETWEEN_RPC_CALLS_MS - now,
    );
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastRpcCallAt = Date.now();
    _activeRpcChunks++;
    return () => {
      _activeRpcChunks--;
      const next = _rpcQueue.shift();
      if (next) next();
    };
  };

  if (_activeRpcChunks < MAX_CONCURRENT_RPC_CHUNKS) {
    return run();
  }
  return new Promise((resolve) => {
    _rpcQueue.push(() => resolve(run()));
  });
}

// Retries a single chunk on 429 specifically (with backoff) before giving
// up and marking it null — previously a single 429 killed the whole chunk
// immediately even though Helius often succeeds a moment later.
async function getParsedTransactionsWithRetry(
  connection: Connection,
  sigs: string[],
  mintAddress: string,
  maxRetries = 2,
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const release = await acquireRpcSlot();
    try {
      return await connection.getParsedTransactions(sigs, {
        maxSupportedTransactionVersion: 1,
      });
    } catch (e) {
      const is429 = String(e).includes("429");
      if (is429 && attempt < maxRetries) {
        const backoffMs = 800 * Math.pow(2, attempt); // 800ms, 1600ms
        console.warn(
          `[onchain-pumpfun] ${mintAddress}: chunk hit 429, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      console.error(
        `[onchain-pumpfun] ${mintAddress}: getParsedTransactions chunk threw`,
        e,
      );
      return sigs.map(() => null);
    } finally {
      release();
    }
  }
  return sigs.map(() => null);
}

async function fetchOnChainTradesRaw(
  connection: Connection,
  mintAddress: string,
  maxSignatures = 100,
): Promise<OnChainTrade[]> {
  const mint = new PublicKey(mintAddress);
  const bondingCurve = getBondingCurvePDA(mint);

  // Paginate instead of capping at one page — an active token's last 100
  // signatures can be just the last few minutes, which is why the chart
  // looked like a fragment instead of the token's whole life like pump.fun
  // shows. This walks back in time until it hits maxSignatures total or
  // runs out of history.
  let sigInfos: Awaited<ReturnType<typeof connection.getSignaturesForAddress>> =
    [];
  let before: string | undefined = undefined;
  while (sigInfos.length < maxSignatures) {
    const page = await connection.getSignaturesForAddress(bondingCurve, {
      limit: Math.min(100, maxSignatures - sigInfos.length),
      before,
    });
    if (!page.length) break;
    sigInfos = sigInfos.concat(page);
    before = page[page.length - 1].signature;
    if (page.length < 100) break;
  }
  if (!sigInfos.length) {
    console.log(
      `[onchain-pumpfun] ${mintAddress}: 0 signatures found for bonding curve ${bondingCurve.toBase58()}`,
    );
    return [];
  }
  console.log(
    `[onchain-pumpfun] ${mintAddress}: ${sigInfos.length} signatures found, fetching transactions...`,
  );

  const trades: OnChainTrade[] = [];

  // Smaller chunks = lighter individual calls, less likely to be the one
  // that tips Helius's compute-credit budget over on a free-tier key.
  const CHUNK_SIZE = 25;
  const sigChunks: string[][] = [];
  for (let i = 0; i < sigInfos.length; i += CHUNK_SIZE) {
    sigChunks.push(sigInfos.slice(i, i + CHUNK_SIZE).map((s) => s.signature));
  }

  const chunkResults = await Promise.all(
    sigChunks.map((sigs) =>
      getParsedTransactionsWithRetry(connection, sigs, mintAddress),
    ),
  );
  const txs = chunkResults.flat();
  const nullCount = txs.filter((t) => !t).length;
  console.log(
    `[onchain-pumpfun] ${mintAddress}: ${txs.length} transactions fetched, ${nullCount} null/failed`,
  );

  for (const tx of txs) {
    if (!tx || !tx.meta || tx.meta.err) continue;
    const blockTime = tx.blockTime;
    if (!blockTime) continue;

    const allIx = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions?.flatMap((i) => i.instructions) ?? []),
    ];

    let isBuy: boolean | null = null;
    for (const ix of allIx) {
      if (!("programId" in ix)) continue;
      if (!ix.programId.equals(PUMP_PROGRAM_ID)) continue;
      if (!("data" in ix) || typeof ix.data !== "string") continue;

      const raw = bs58.decode(ix.data);
      const disc = Buffer.from(raw.slice(0, 8));
      if (disc.equals(BUY_DISCRIMINATOR)) {
        isBuy = true;
        break;
      }
      if (disc.equals(SELL_DISCRIMINATOR)) {
        isBuy = false;
        break;
      }
    }
    if (isBuy === null) continue;

    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];
    const bondingCurveStr = bondingCurve.toBase58();

    let tokenDelta = 0;
    let traderAccountIndex = -1;

    for (const p of post) {
      if (p.mint !== mintAddress) continue;
      if (p.owner === bondingCurveStr) continue;
      const preEntry = pre.find(
        (x) => x.accountIndex === p.accountIndex && x.mint === mintAddress,
      );
      const preAmt = preEntry
        ? parseFloat(preEntry.uiTokenAmount.uiAmountString ?? "0")
        : 0;
      const postAmt = parseFloat(p.uiTokenAmount.uiAmountString ?? "0");
      const delta = postAmt - preAmt;
      if (Math.abs(delta) > 0) {
        tokenDelta = Math.abs(delta);
        traderAccountIndex = p.accountIndex;
      }
    }

    if (traderAccountIndex === -1 || tokenDelta === 0) continue;

    const preSol = tx.meta.preBalances[0] ?? 0;
    const postSol = tx.meta.postBalances[0] ?? 0;
    const fee = tx.meta.fee ?? 0;
    const solDelta = Math.abs(postSol - preSol - (isBuy ? -fee : fee));
    const solAmount = solDelta / 1e9;

    if (solAmount <= 0 || tokenDelta <= 0) continue;

    trades.push({
      timestamp: blockTime,
      solAmount,
      tokenAmount: tokenDelta,
    });
  }

  const sorted = trades.sort((a, b) => a.timestamp - b.timestamp);
  console.log(
    `[onchain-pumpfun] ${mintAddress}: extracted ${sorted.length} valid buy/sell trades from ${txs.length} transactions`,
  );
  return sorted;
}

// ─── PUMPSWAP (post-graduation) ─────────────────────────────────────────────
const PUMPSWAP_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Cheap metadata lookup — resolves mint -> pool address only, no OHLCV, so it
// doesn't compete with the circuit breaker your Birdeye/Gecko OHLCV calls trip.
// Pool address never changes once created, so this caches long.
const POOL_ADDRESS_CACHE_MS = 10 * 60 * 1000;
const _poolAddressCache = new Map<
  string,
  { pool: string | null; ts: number }
>();

async function getPumpSwapPoolAddress(
  mintAddress: string,
): Promise<string | null> {
  const cached = _poolAddressCache.get(mintAddress);
  if (cached && Date.now() - cached.ts < POOL_ADDRESS_CACHE_MS) {
    return cached.pool;
  }
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mintAddress}/pools?page=1`,
      { signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (!res.ok) {
      _poolAddressCache.set(mintAddress, { pool: null, ts: Date.now() });
      return null;
    }
    const data = await res.json();
    const pool: string | null = data?.data?.[0]?.attributes?.address ?? null;
    _poolAddressCache.set(mintAddress, { pool, ts: Date.now() });
    return pool;
  } catch (e) {
    console.error(`[onchain-pumpfun] ${mintAddress}: pool discovery threw`, e);
    return null;
  }
}

// Same balance-delta technique as the bonding curve fetcher above, but two
// things differ: (1) we watch the pool account instead of the curve PDA,
// and (2) PumpSwap settles in wrapped SOL, a token, not native lamports —
// so we read a WSOL token-balance delta instead of a lamport delta.
async function fetchPumpSwapTradesRaw(
  connection: Connection,
  mintAddress: string,
  poolAddress: string,
  maxSignatures = 100,
): Promise<OnChainTrade[]> {
  const pool = new PublicKey(poolAddress);

  // The pool's own base-token vault is the top holder of the mint after
  // migration (the curve's remaining supply gets seeded into it) — we need
  // its address so we can exclude it below instead of counting the pool's
  // own reserve as a "trade."
  let poolVaultAccount: string | null = null;
  try {
    const largest = await connection.getTokenLargestAccounts(
      new PublicKey(mintAddress),
    );
    poolVaultAccount = largest.value[0]?.address.toBase58() ?? null;
  } catch (e) {
    console.error(
      `[onchain-pumpfun] ${mintAddress}: getTokenLargestAccounts threw`,
      e,
    );
  }

  const sigInfos = await connection.getSignaturesForAddress(pool, {
    limit: maxSignatures,
  });
  if (!sigInfos.length) {
    console.log(
      `[onchain-pumpfun] ${mintAddress}: 0 signatures found for PumpSwap pool ${poolAddress}`,
    );
    return [];
  }
  console.log(
    `[onchain-pumpfun] ${mintAddress}: ${sigInfos.length} PumpSwap pool signatures found, fetching transactions...`,
  );

  const CHUNK_SIZE = 25;
  const sigChunks: string[][] = [];
  for (let i = 0; i < sigInfos.length; i += CHUNK_SIZE) {
    sigChunks.push(sigInfos.slice(i, i + CHUNK_SIZE).map((s) => s.signature));
  }
  const chunkResults = await Promise.all(
    sigChunks.map((sigs) =>
      getParsedTransactionsWithRetry(connection, sigs, mintAddress),
    ),
  );
  const txs = chunkResults.flat();

  const trades: OnChainTrade[] = [];
  for (const tx of txs) {
    if (!tx || !tx.meta || tx.meta.err) continue;
    const blockTime = tx.blockTime;
    if (!blockTime) continue;

    const touchesPumpSwap = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions?.flatMap((i) => i.instructions) ?? []),
    ].some(
      (ix) => "programId" in ix && ix.programId.equals(PUMPSWAP_PROGRAM_ID),
    );
    if (!touchesPumpSwap) continue;

    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];

    // Base-mint delta for the trader — same accountIndex-diff technique as
    // the curve fetcher, but excludes the pool's own vault this time
    // instead of the bonding curve PDA.
    let tokenDelta = 0;
    let traderOwner: string | null = null;
    for (const p of post) {
      if (p.mint !== mintAddress) continue;
      const acctPubkey =
        tx.transaction.message.accountKeys[p.accountIndex]?.pubkey?.toBase58();
      if (poolVaultAccount && acctPubkey === poolVaultAccount) continue;
      const preEntry = pre.find(
        (x) => x.accountIndex === p.accountIndex && x.mint === mintAddress,
      );
      const preAmt = preEntry
        ? parseFloat(preEntry.uiTokenAmount.uiAmountString ?? "0")
        : 0;
      const postAmt = parseFloat(p.uiTokenAmount.uiAmountString ?? "0");
      const delta = postAmt - preAmt;
      if (Math.abs(delta) > 0) {
        tokenDelta = Math.abs(delta);
        traderOwner = p.owner ?? null;
      }
    }
    if (!traderOwner || tokenDelta === 0) continue;

    // Matching WSOL delta for the SAME owner — this replaces the native
    // lamport-balance read the curve fetcher uses, since PumpSwap moves
    // wrapped SOL through the quote vault, not native SOL.
    let solDelta = 0;
    for (const p of post) {
      if (p.mint !== WSOL_MINT || p.owner !== traderOwner) continue;
      const preEntry = pre.find(
        (x) => x.accountIndex === p.accountIndex && x.mint === WSOL_MINT,
      );
      const preAmt = preEntry
        ? parseFloat(preEntry.uiTokenAmount.uiAmountString ?? "0")
        : 0;
      const postAmt = parseFloat(p.uiTokenAmount.uiAmountString ?? "0");
      solDelta = Math.abs(postAmt - preAmt);
    }

    // Fallback: many wallets/routers create a temporary wrapped-SOL account,
    // swap through it, then close it back to native SOL — all inside the
    // same transaction. When that happens the WSOL account never appears in
    // postTokenBalances at all (it's gone by the end of the tx), so the loop
    // above finds nothing even though a real trade happened. In that case
    // the SOL actually lands on the trader's own wallet account instead —
    // check that directly, same lamport-delta technique the bonding curve
    // fetcher already uses.
    if (solDelta <= 0) {
      const traderAcctIndex = tx.transaction.message.accountKeys.findIndex(
        (k) => k.pubkey.toBase58() === traderOwner,
      );
      if (traderAcctIndex !== -1) {
        const preNative = tx.meta.preBalances[traderAcctIndex] ?? 0;
        const postNative = tx.meta.postBalances[traderAcctIndex] ?? 0;
        // Fee is always debited from account index 0 (the fee payer),
        // regardless of buy/sell direction — add it back before taking
        // the delta so it doesn't get miscounted as trade size.
        const fee = traderAcctIndex === 0 ? (tx.meta.fee ?? 0) : 0;
        const nativeDelta = Math.abs(postNative - preNative + fee);
        solDelta = nativeDelta / 1e9;
      }
    }
    if (solDelta <= 0) continue;

    trades.push({
      timestamp: blockTime,
      solAmount: solDelta,
      tokenAmount: tokenDelta,
    });
  }

  const sorted = trades.sort((a, b) => a.timestamp - b.timestamp);
  console.log(
    `[onchain-pumpfun] ${mintAddress}: extracted ${sorted.length} PumpSwap trades from ${txs.length} transactions`,
  );
  return sorted;
}

export async function getCachedOnChainTrades(
  connection: Connection,
  mintAddress: string,
): Promise<OnChainTrade[]> {
  const cached = _tradeCache.get(mintAddress);
  if (cached && Date.now() - cached.ts < TRADE_CACHE_MS) {
    return cached.trades;
  }

  const pending = _inFlight.get(mintAddress);
  if (pending) return pending;

  // Pool discovery and the curve walk now fire at the SAME time instead of
  // one gating the other — the pool lookup is a network call to
  // GeckoTerminal with its own 8s timeout, and having it block the RPC
  // walk before it even starts was adding that entire round-trip on top
  // of the walk itself, back to back, instead of overlapping.
  const promise = Promise.all([
    fetchOnChainTradesRaw(connection, mintAddress),
    getPumpSwapPoolAddress(mintAddress).then((poolAddress) =>
      poolAddress
        ? fetchPumpSwapTradesRaw(connection, mintAddress, poolAddress)
        : Promise.resolve([]),
    ),
  ])
    .then(([curveTrades, poolTrades]) =>
      [...curveTrades, ...poolTrades].sort((a, b) => a.timestamp - b.timestamp),
    )
    .then((trades) => {
      _tradeCache.set(mintAddress, { trades, ts: Date.now() });
      _inFlight.delete(mintAddress);
      return trades;
    })
    .catch((e) => {
      _inFlight.delete(mintAddress);
      throw e;
    });

  _inFlight.set(mintAddress, promise);
  return promise;
}

export function bucketTrades(
  trades: OnChainTrade[],
  bucketSec: number,
  solUsd: number,
): { t: number; o: number; h: number; l: number; c: number }[] {
  const buckets = new Map<
    number,
    { t: number; o: number; h: number; l: number; c: number }
  >();

  // Compute a price for every trade first, so we can find the median and
  // drop outliers before any of them touch a bucket's h/l. A single dust
  // trade (near-zero tokenAmount rounding, or a tiny/huge solAmount from a
  // routed swap) can produce a price 1000x+ off from everything else in the
  // same bucket, which drags that candle's low or high to something absurd
  // and fails downstream chart validation entirely.
  const priced = trades
    .map((tr) => ({ tr, price: (tr.solAmount / tr.tokenAmount) * solUsd }))
    .filter((p) => p.price && isFinite(p.price) && p.price > 0);

  if (!priced.length) return [];

  const sortedPrices = priced.map((p) => p.price).sort((a, b) => a - b);
  const median = sortedPrices[Math.floor(sortedPrices.length / 2)];

  // Only apply the outlier filter when there's enough of a sample to trust
  // the median. Increased to 500x to allow for explosive meme coin peaks
  // while still catching 10,000x dust/routing outliers.
  const OUTLIER_RATIO = 500;
  const filtered =
    priced.length >= 3
      ? priced.filter(
          (p) =>
            p.price >= median / OUTLIER_RATIO &&
            p.price <= median * OUTLIER_RATIO,
        )
      : priced;

  for (const { tr, price } of filtered) {
    const bucketT = Math.floor(tr.timestamp / bucketSec) * bucketSec * 1000;
    const existing = buckets.get(bucketT);
    if (!existing) {
      buckets.set(bucketT, {
        t: bucketT,
        o: price,
        h: price,
        l: price,
        c: price,
      });
    } else {
      existing.h = Math.max(existing.h, price);
      existing.l = Math.min(existing.l, price);
      existing.c = price;
    }
  }

  const sparse = Array.from(buckets.values()).sort((a, b) => a.t - b.t);
  if (!sparse.length) return [];

  const filled: { t: number; o: number; h: number; l: number; c: number }[] =
    [];
  let lastClose = sparse[0].o;
  for (
    let t = sparse[0].t;
    t <= sparse[sparse.length - 1].t;
    t += bucketSec * 1000
  ) {
    const real = buckets.get(t);
    if (real) {
      filled.push(real);
      lastClose = real.c;
    } else {
      filled.push({
        t,
        o: lastClose,
        h: lastClose,
        l: lastClose,
        c: lastClose,
      });
    }
  }

  return filled.length > 300 ? filled.slice(-300) : filled;
}

// Drop-in replacement matching the old fromPumpFun(address, cfg) signature,
// now backed by the per-mint trade cache instead of a fresh RPC walk.
export async function fromPumpFunOnChain(
  address: string,
  cfg: { pumpIntervalSec: number },
  connection: Connection,
  getSolUsd: () => Promise<number>,
): Promise<{ t: number; o: number; h: number; l: number; c: number }[] | null> {
  // Entry-point log — fires BEFORE the solUsd check below, so a silent
  // solUsd failure (Jupiter hiccup, returns 0, etc.) is now visible instead
  // of the function returning null with zero trace. This was the likely
  // reason no [onchain-pumpfun] lines were showing up at all even though
  // this function was being called on every request.
  console.log(`[onchain-pumpfun] fromPumpFunOnChain called for ${address}`);
  try {
    const solUsd = await getSolUsd();
    if (!solUsd || solUsd <= 0) {
      console.warn(
        `[onchain-pumpfun] ${address}: aborting — getSolUsd() returned ${solUsd}, no SOL/USD price available`,
      );
      return null;
    }

    const trades = await getCachedOnChainTrades(connection, address);
    if (!trades.length) {
      console.log(
        `[onchain-pumpfun] ${address}: 0 trades returned from getCachedOnChainTrades`,
      );
      return null;
    }

    const filled = bucketTrades(trades, cfg.pumpIntervalSec, solUsd);
    if (!filled.length) {
      console.log(
        `[onchain-pumpfun] ${address}: bucketTrades produced 0 candles from ${trades.length} trades`,
      );
    }
    return filled.length ? filled : null;
  } catch (e) {
    console.error(`[onchain-pumpfun] ${address}: fromPumpFunOnChain threw`, e);
    return null;
  }
}
