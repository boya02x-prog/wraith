// ─── SHARED TOKEN PRICE SOURCE OF TRUTH ────────────────────────────────────
// Previously TokenPanel, WinsPanel (via MemeScanner), and PaperTrader each
// had their own independent price-fetching function, hitting different
// endpoints in different orders with different caching. That guarantees the
// same token shows different numbers in different panels at the same moment.
//
// Every panel should call getTokenPrice() from here instead. One cache, one
// fallback order, one number, everywhere.
//
// Fallback order:
//   1. DexScreener  — pair metadata, supply baseline, works for anything with
//                      a live DEX pool (Raydium/Orca/etc).
//   2. Jupiter Price v2 — overlaid on top when available. This is the price
//                      swaps actually execute at, so it's the most "real"
//                      number when it exists. More current than DexScreener's
//                      cached pair data.
//   3. pump.fun bonding curve — last resort for tokens that haven't migrated
//                      to a DEX yet (no DexScreener pair, no Jupiter route).
//                      Unofficial/undocumented API — treat as best-effort.

export interface LiveTokenPrice {
  mcap?: number;
  price?: number; // USD
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  volume24h?: number;
  ageMinutes?: number;
  source: "dexscreener+jupiter" | "dexscreener" | "pumpfun" | "none";
}

interface CacheEntry {
  data: LiveTokenPrice;
  ts: number;
}

const _cache = new Map<string, CacheEntry>();
const _supplyCache = new Map<string, number>();
const CACHE_MS = 45_000; // was 4s — did nothing since nothing re-requests within 4s; this now actually lets WinsPanel's 60s refresh and MemeScanner's own polling share one fetch instead of each hitting DexScreener independently

let _solUsdCache: { price: number; ts: number } | null = null;
async function getSolUsd(): Promise<number> {
  if (_solUsdCache && Date.now() - _solUsdCache.ts < 15_000) {
    return _solUsdCache.price;
  }
  try {
    // Jupiter's price API has no CORS headers for browser origins, and the
    // old v2 endpoint is gone (404). Route through your own server-side
    // proxy (app/api/jupiter/route.ts) which already uses v3 correctly.
    const res = await fetch(
      "/api/jupiter?endpoint=price&ids=So11111111111111111111111111111111111111112",
      { signal: AbortSignal.timeout(5000) },
    );
    const data = await res.json();
    const price = parseFloat(
      data?.data?.So11111111111111111111111111111111111111112?.price ?? 
        data?.So11111111111111111111111111111111111111112?.usdPrice ?? "0",
    );
    if (price > 0) {
      _solUsdCache = { price, ts: Date.now() };
      return price;
    }
  } catch {
    // fall through
  }
  return _solUsdCache?.price ?? 0;
}

async function fromPumpFun(ca: string): Promise<LiveTokenPrice | null> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${ca}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    
    // pump.fun market_cap is usually the "real" circulating market cap on the curve
    const mcap = d?.usd_market_cap ?? d?.market_cap ?? 0;
    if (!mcap || mcap <= 0) return null;

    // pump.fun gives SOL-denominated bonding curve price — convert to USD
    const solUsd = await getSolUsd();
    const priceSol =
      d?.virtual_sol_reserves && d?.virtual_token_reserves
        ? d.virtual_sol_reserves / 1e9 / (d.virtual_token_reserves / 1e6)
        : 0;
    const price = priceSol && solUsd ? priceSol * solUsd : undefined;

    return {
      mcap,
      price,
      liquidity: d?.virtual_sol_reserves
        ? (d.virtual_sol_reserves / 1e9) * solUsd
        : undefined,
      source: "pumpfun",
    };
  } catch {
    return null;
  }
}

export async function getTokenPrice(
  ca: string,
  opts?: { skipJupiter?: boolean; maxAgeMs?: number },
): Promise<LiveTokenPrice> {
  const cacheKey = `${ca}|${opts?.skipJupiter ? "1" : "0"}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < (opts?.maxAgeMs ?? CACHE_MS)) return cached.data;

  const result = await _fetchTokenPrice(ca, opts?.skipJupiter ?? false);
  _cache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

async function _fetchTokenPrice(
  ca: string,
  skipJupiter: boolean,
): Promise<LiveTokenPrice> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(8000) },
    );

    if (res.ok) {
      const data = await res.json();
      const pairs = (data?.pairs || [])
        .filter((p: { chainId: string }) => p.chainId === "solana")
        .sort(
          (
            a: { liquidity?: { usd?: number } },
            b: { liquidity?: { usd?: number } },
          ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
        );

      if (pairs.length) {
        const pair = pairs[0];
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;

        // Keep price, liquidity, volume, and market cap tied to the same
        // canonical Solana pair. FDV is not circulating market cap, so use it
        // only as an explicitly marked fallback; never manufacture a value from
        // liquidity (that created false numbers such as 118k MC).
        const dexPrice = Number(pair.priceUsd) || 0;
        const hasMarketCap = Number(pair.marketCap) > 0;
        const dexMcap = hasMarketCap
          ? Number(pair.marketCap)
          : Number(pair.fdv) > 0
            ? Number(pair.fdv)
            : undefined;

        if (hasMarketCap && dexPrice > 0) {
          const freshSupply = Number(pair.marketCap) / dexPrice;
          const cachedSupply = _supplyCache.get(ca);
          // Only learn supply from a real market-cap value, never from FDV.
          if (
            !cachedSupply ||
            Math.abs(freshSupply - cachedSupply) / cachedSupply > 0.05
          ) {
            _supplyCache.set(ca, freshSupply);
          }
        }

        let mcap = dexMcap;
        let price = dexPrice;

        // Jupiter is useful for a fresher executable price, but combining two
        // materially different sources produces a fake market cap. Accept it
        // only when it is within 33% of the canonical DEX pair.
        try {
          if (!skipJupiter && dexPrice > 0) {
            const jupRes = await fetch(`/api/jupiter?endpoint=price&ids=${ca}`, {
              signal: AbortSignal.timeout(4000),
            });
            if (jupRes.ok) {
              const jupData = await jupRes.json();
              const jupPrice = Number(
                jupData?.[ca]?.usdPrice ??
                  jupData?.data?.[ca]?.usdPrice ??
                  jupData?.data?.[ca]?.price ??
                  0,
              );
              const priceRatio = jupPrice / dexPrice;
              if (
                jupPrice > 0 &&
                Number.isFinite(priceRatio) &&
                priceRatio >= 0.67 &&
                priceRatio <= 1.5
              ) {
                price = jupPrice;
                const supply = _supplyCache.get(ca);
                // If circulating supply is known from DexScreener's actual
                // marketCap, keep MCAP internally consistent with Jupiter.
                if (supply && supply > 0 && hasMarketCap) {
                  mcap = jupPrice * supply;
                }
                return {
                  mcap,
                  price,
                  liquidity: pair.liquidity?.usd,
                  priceChange1h: pair.priceChange?.h1,
                  priceChange24h: pair.priceChange?.h24,
                  volume24h: pair.volume?.h24,
                  ageMinutes,
                  source: "dexscreener+jupiter",
                };
              }
            }
          }
        } catch {
          // Jupiter unavailable or inconsistent — keep the canonical pair data.
        }

        return {
          mcap,
          price,
          liquidity: pair.liquidity?.usd,
          priceChange1h: pair.priceChange?.h1,
          priceChange24h: pair.priceChange?.h24,
          volume24h: pair.volume?.h24,
          ageMinutes,
          source: "dexscreener",
        };
      }
    }
  } catch {
    // DexScreener unavailable — fall through to pump.fun
  }

  // No DEX pair anywhere — token may still be on the pump.fun bonding curve
  const pf = await fromPumpFun(ca);
  if (pf) return pf;

  return { source: "none" };
}

// ─── Back-compat thin wrappers ──────────────────────────────────────────────
export async function getMcap(
  ca: string,
  opts?: { skipJupiter?: boolean },
): Promise<number> {
  const d = await getTokenPrice(ca, opts);
  return d.mcap ?? 0;
}
