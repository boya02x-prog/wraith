// ─── WALLET INTEL (Birdeye) ─────────────────────────────────────────────────
// "How rich is this wallet, and is it actually winning?" — two Birdeye calls
// per token, both already covered by the BIRDEYE_API_KEY you have configured:
//
//   1. GET /defi/v3/token/holder?mode=wallet&get_holder_infos=true
//      Top holder wallets for the token, grouped by owner (not fragmented by
//      token account), with netWorth + solBalance included in the same call.
//
//   2. GET /wallet/v2/pnl/multiple?token_address=...&wallets=...
//      All-time PnL + win-rate metrics for up to 50 wallets, for that one
//      token — this is what actually answers "is this wallet winning?"
//      rather than just "is this wallet big?" (a rich wallet can still be
//      the one about to dump on everyone else).
//
// Both are batched (one call covers many wallets), so this doesn't multiply
// per-holder — it's 2 requests per token regardless of holder count (capped
// at the API's own 50-wallet limit for the PnL call).

import { env } from "@/lib/env";

const BIRDEYE_API_KEY = env.BIRDEYE_API_KEY;
const BIRDEYE_BASE = "https://public-api.birdeye.so";

export interface SmartWallet {
  address: string;
  netWorthUsd?: number;
  solBalance?: number;
  holdingUsd?: number; // this token specifically
  realizedPnlUsd?: number;
  totalPnlUsd?: number;
  winRatePct?: number; // 0-100, from Birdeye's per-wallet PnL trade breakdown
  tradeCount?: number;
}

export interface SmartMoneyIntel {
  smartMoneyScore: number; // 0-100, see scoring below
  topWallets: SmartWallet[]; // top few by net worth, for display
}

interface CacheEntry {
  data: SmartMoneyIntel;
  ts: number;
}
const _cache = new Map<string, CacheEntry>();
const CACHE_MS = 5 * 60_000; // matches scan cadence — no point re-fetching within one scan cycle

async function birdeyeFetch(path: string, params: Record<string, string>) {
  if (!BIRDEYE_API_KEY) return null;
  try {
    const url = `${BIRDEYE_BASE}${path}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, {
      headers: {
        "X-API-KEY": BIRDEYE_API_KEY,
        "x-chain": "solana",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getTopHolderWallets(
  mintAddress: string,
  limit = 15,
): Promise<SmartWallet[]> {
  const data = await birdeyeFetch("/defi/v3/token/holder", {
    address: mintAddress,
    mode: "wallet",
    get_holder_infos: "true",
    limit: String(limit),
  });
  const items = data?.data?.items || data?.data?.holders || [];
  if (!Array.isArray(items)) return [];
  return items
    .map((h: Record<string, unknown>) => ({
      address: String(h.owner || h.wallet || h.address || ""),
      netWorthUsd: typeof h.netWorth === "number" ? h.netWorth : undefined,
      solBalance: typeof h.solBalance === "number" ? h.solBalance : undefined,
      holdingUsd: typeof h.amountUsd === "number" ? h.amountUsd : undefined,
    }))
    .filter((h) => h.address);
}

async function getWalletPnlForToken(
  mintAddress: string,
  wallets: string[],
): Promise<
  Map<
    string,
    {
      realizedPnlUsd?: number;
      totalPnlUsd?: number;
      winRatePct?: number;
      tradeCount?: number;
    }
  >
> {
  const out = new Map<
    string,
    {
      realizedPnlUsd?: number;
      totalPnlUsd?: number;
      winRatePct?: number;
      tradeCount?: number;
    }
  >();
  if (!wallets.length) return out;
  // API caps at 50 wallets per call — we only ever send up to ~15 anyway
  const data = await birdeyeFetch("/wallet/v2/pnl/multiple", {
    token_address: mintAddress,
    wallets: wallets.slice(0, 50).join(","),
  });
  const perWallet = data?.data || {};
  for (const addr of Object.keys(perWallet)) {
    const w = perWallet[addr] || {};
    const wins = typeof w.winCount === "number" ? w.winCount : undefined;
    const total =
      typeof w.tradeCount === "number"
        ? w.tradeCount
        : typeof w.totalTrades === "number"
          ? w.totalTrades
          : undefined;
    out.set(addr, {
      realizedPnlUsd:
        typeof w.realizedPnl === "number" ? w.realizedPnl : undefined,
      totalPnlUsd: typeof w.totalPnl === "number" ? w.totalPnl : undefined,
      winRatePct:
        wins !== undefined && total ? (wins / total) * 100 : undefined,
      tradeCount: total,
    });
  }
  return out;
}

/**
 * Combines holder net worth + per-wallet PnL for one token into a single
 * smart-money score. This is deliberately conservative: it only rewards
 * wallets we can actually confirm are *winning* on this token, not just
 * wallets that happen to be large (a whale can be the exit liquidity too).
 */
export async function getSmartMoneyIntel(
  mintAddress: string,
): Promise<SmartMoneyIntel> {
  const cached = _cache.get(mintAddress);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const result = await _fetchSmartMoneyIntel(mintAddress);
  _cache.set(mintAddress, { data: result, ts: Date.now() });
  return result;
}

async function _fetchSmartMoneyIntel(
  mintAddress: string,
): Promise<SmartMoneyIntel> {
  if (!BIRDEYE_API_KEY) return { smartMoneyScore: 0, topWallets: [] };

  const holders = await getTopHolderWallets(mintAddress, 15);
  if (!holders.length) return { smartMoneyScore: 0, topWallets: [] };

  const pnlMap = await getWalletPnlForToken(
    mintAddress,
    holders.map((h) => h.address),
  );

  const merged: SmartWallet[] = holders.map((h) => {
    const pnl = pnlMap.get(h.address);
    return { ...h, ...pnl };
  });

  // Score: each wallet with a confirmed win rate above 55% (and at least a
  // couple of trades, so a single lucky flip doesn't count) contributes,
  // weighted a bit by net worth so a proven $500K wallet counts for more
  // than a proven $2K wallet — but net worth alone (no PnL data) contributes
  // nothing, since "rich" isn't the same as "winning."
  let score = 0;
  for (const w of merged) {
    if (w.winRatePct === undefined || (w.tradeCount ?? 0) < 2) continue;
    if (w.winRatePct < 55) continue;
    const sizeMult = (w.netWorthUsd ?? 0) > 100_000 ? 1.5 : 1.0;
    const confidenceMult = w.winRatePct >= 75 ? 1.5 : 1.0;
    score += 8 * sizeMult * confidenceMult;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const topWallets = merged
    .sort((a, b) => (b.netWorthUsd ?? 0) - (a.netWorthUsd ?? 0))
    .slice(0, 5);

  return { smartMoneyScore: score, topWallets };
}
