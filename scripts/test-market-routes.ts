// Run with: npx tsx scripts/test-market-routes.ts  (mocks global fetch with realistic provider payloads)
import assert from "node:assert/strict";

const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump"; // 44 chars ending in pump
const POOL = "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm";
const now = Date.now();

const geckoPool = (i: number, over: Record<string, unknown> = {}) => ({
  id: `solana_pool${i}`,
  type: "pool",
  attributes: {
    name: `TKN${i} / SOL`,
    address: i === 0 ? POOL : `PoolAddr${i}1111111111111111111111111111111111`.slice(0, 44),
    base_token_price_usd: "0.0000123",
    fdv_usd: "12300",
    market_cap_usd: i % 2 ? null : "12000",
    reserve_in_usd: "8000",
    pool_created_at: new Date(now - 3600_000 * (i + 1)).toISOString(),
    price_change_percentage: { m5: "1.5", h1: "-3.2", h6: "10", h24: "250.5" },
    volume_usd: { m5: "100", h1: "5000", h6: "9000", h24: "120000" },
    transactions: { h24: { buys: 400, sells: 300, buyers: 100, sellers: 90 } },
    ...over,
  },
  relationships: {
    base_token: { data: { id: i === 0 ? `solana_${MINT}` : `solana_Tok${i}Mint11111111111111111111111111111111`.slice(0, 50), type: "token" } },
    dex: { data: { id: i === 0 ? "pump-fun" : "raydium", type: "dex" } },
  },
});
const geckoPayload = {
  data: [geckoPool(0), geckoPool(1), geckoPool(2)],
  included: [
    { id: `solana_${MINT}`, type: "token", attributes: { address: MINT, name: "Test Coin", symbol: "TEST", image_url: "https://img/x.png" } },
    { id: "solana_Tok1Mint11111111111111111111111111111111".slice(0, 50), type: "token", attributes: { address: "Tok1Mint11111111111111111111111111111111", name: "One", symbol: "ONE", image_url: "missing.png" } },
    { id: "pump-fun", type: "dex", attributes: { name: "Pump.fun" } },
    { id: "raydium", type: "dex", attributes: { name: "Raydium" } },
  ],
};

const bucket = 900_000;
const base = Math.floor(now / bucket) * bucket;
const ohlcv = [
  // gecko returns newest first: [ts(sec), o, h, l, c, v]; leave a GAP at base-2*bucket
  [(base) / 1000, 0.00002, 0.000021, 0.000019, 0.0000205, 800],
  [(base - bucket) / 1000, 0.00001, 0.00002, 0.0000095, 0.00002, 1200],
  [(base - 3 * bucket) / 1000, 0.00001, 0.00001, 0.000009, 0.00001, 50],
  [(base - 4 * bucket) / 1000, 0.00001, 0.5, 0.000009, 0.00001, 10], // absurd wick -> must be clamped
];

const dexPair = {
  chainId: "solana", dexId: "pumpfun", pairAddress: POOL,
  baseToken: { address: MINT, name: "Test Coin", symbol: "TEST" },
  quoteToken: { symbol: "SOL" },
  priceUsd: "0.0000123", marketCap: 12300, fdv: 12300, liquidity: { usd: 8000 },
  volume: { m5: 10, h1: 100, h6: 500, h24: 1000 }, priceChange: { m5: 1, h1: 2, h6: 3, h24: 4 },
  txns: { m5: { buys: 1, sells: 2 }, h1: { buys: 3, sells: 4 }, h6: { buys: 5, sells: 6 }, h24: { buys: 7, sells: 8 } },
  pairCreatedAt: now - 7200_000,
  info: { imageUrl: "https://img/dex.png", websites: [{ url: "https://site.example" }], socials: [{ type: "twitter", url: "https://x.com/test" }, { type: "telegram", url: "javascript:alert(1)" }] },
};

const calls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("geckoterminal.com") && url.includes("/ohlcv/")) return ok({ data: { attributes: { ohlcv_list: ohlcv } } });
  if (url.includes("geckoterminal.com") && url.includes("/trades")) {
    return ok({ data: [{ id: "t1", attributes: { kind: "buy", block_timestamp: new Date(now - 5000).toISOString(), to_token_amount: "1000", from_token_amount: "1", price_to_in_usd: "0.0000123", price_from_in_usd: "150", volume_in_usd: "12.3", tx_from_address: "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", tx_hash: "sig1" } }, { id: "t2", attributes: { kind: "sell", block_timestamp: new Date(now - 1000).toISOString(), to_token_amount: "0.1", from_token_amount: "500", price_to_in_usd: "150", price_from_in_usd: "0.000012", volume_in_usd: "6", tx_from_address: "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", tx_hash: "sig2" } }] });
  }
  if (url.includes("geckoterminal.com")) return ok(geckoPayload);
  if (url.includes("dexscreener.com/latest/dex/tokens/So1111")) return ok({ pairs: [{ chainId: "solana", priceUsd: "150", quoteToken: { symbol: "USDC" }, liquidity: { usd: 1e7 } }] });
  if (url.includes("dexscreener.com/latest/dex/tokens/")) return ok({ pairs: [dexPair] });
  if (url.includes("token-boosts") || url.includes("token-profiles")) return ok([{ chainId: "solana", tokenAddress: MINT }]);
  if (url.includes("dexscreener.com/tokens/v1/")) return ok([dexPair]);
  return new Response("nope", { status: 404 });
}) as typeof fetch;

import { NextRequest } from "next/server";
const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

async function main() {
  // ── formatters
  const m = await import("../lib/market");
  assert.equal(m.fmtPrice(0.0000123), "$0.0₄123");
  assert.equal(m.fmtPrice(0.0000412), "$0.0₄412");
  assert.equal(m.fmtPrice(0.00000000123), "$0.0₈123");
  assert.equal(m.fmtPrice(0.00123), "$0.00123");
  assert.equal(m.fmtPrice(0.0123), "$0.0123");
  assert.equal(m.fmtPrice(0.5), "$0.5000");
  assert.equal(m.fmtPrice(1234.5), "$1,234.5");
  assert.equal(m.fmtUsd(12345), "$12.3K");
  assert.equal(m.fmtUsd(0), "—");
  assert.equal(m.fmtPct(12.34), "+12.3%");
  assert.equal(m.fmtPct(-2000), "-2.0K%");
  assert.equal(m.fmtPct(null), "—");

  // ── market route
  const market = await import("../app/api/market/route");
  for (const cat of ["trending", "new", "volume", "gainers"]) {
    const res = await market.GET(req(`/api/market?category=${cat}`));
    const body = await res.json();
    assert.equal(res.status, 200, `${cat} status`);
    if (cat !== "gainers") assert.ok(body.tokens.length >= 1, `${cat} has tokens`);
    else assert.equal(body.tokens.length, 0, "gainers empty when nothing is up (valid, not an error)");
    const t = body.tokens.find((x: { address: string }) => x.address === MINT);
    if (cat !== "gainers") {
      assert.ok(t, `${cat} contains pump mint`);
      assert.equal(t.symbol, "TEST");
      assert.equal(t.onCurve, true);
      assert.ok(t.curveProgress > 0 && t.curveProgress < 1, "curve progress");
      assert.equal(t.imageUrl, "https://img/x.png");
      assert.equal(t.change.h1, -3.2);
    }
    const one = body.tokens.find((x: { symbol: string }) => x.symbol === "ONE");
    if (one) assert.equal(one.imageUrl, undefined, "missing.png logo dropped");
  }

  // ── token-price route
  const price = await import("../app/api/token-price/route");
  let res = await price.GET(req(`/api/token-price?mint=${MINT}`));
  let snap = await res.json();
  assert.equal(res.status, 200);
  assert.equal(snap.symbol, "TEST");
  assert.equal(snap.priceUsd, 0.0000123);
  assert.equal(snap.marketCap, 12300);
  assert.equal(snap.twitter, "https://x.com/test");
  assert.equal(snap.telegram, null, "non-https social rejected");
  assert.equal(snap.imageUrl, "https://img/dex.png");
  assert.equal(snap.txns.h1.buys, 3);
  assert.ok(Math.abs(snap.supply - 1e9) < 1, "supply = mcap/price");
  assert.equal((await price.GET(req(`/api/token-price?mint=bad`))).status, 400);

  // ── chart route
  const chart = await import("../app/api/token-chart/route");
  res = await chart.GET(req(`/api/token-chart?address=${MINT}&tf=15m`));
  const c = await res.json();
  assert.equal(res.status, 200);
  assert.equal(c.source, "geckoterminal");
  const rows = c.candles as { t: number; o: number; h: number; l: number; c: number; v: number }[];
  assert.ok(rows.length >= 5, `filled candles (got ${rows.length})`);
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].t - rows[i - 1].t, bucket, "no gaps / even spacing");
    assert.equal(rows[i].o, rows[i - 1].c, "open chains to previous close");
  }
  assert.ok(rows.every((r) => r.h >= Math.max(r.o, r.c) && r.l <= Math.min(r.o, r.c)), "ohlc consistent");
  assert.ok(rows.every((r) => r.h < 0.01), "absurd wick clamped");
  assert.equal(rows[rows.length - 1].t, base, "series reaches current bucket");
  assert.ok(rows.some((r) => r.v === 0) && rows.some((r) => r.v > 0), "gap candles have zero volume");
  assert.equal((await chart.GET(req(`/api/token-chart?address=nope`))).status, 400);

  // ── trades route
  const trades = await import("../app/api/token-trades/route");
  res = await trades.GET(req(`/api/token-trades?mint=${MINT}`));
  const tr = (await res.json()).trades;
  assert.equal(tr.length, 2);
  assert.equal(tr[0].side, "sell");
  assert.equal(tr[0].tokens, 500);
  assert.equal(tr[0].priceUsd, 0.000012);
  assert.equal(tr[1].tokens, 1000);

  // caching: second chart call should not refetch
  const before = calls.length;
  await chart.GET(req(`/api/token-chart?address=${MINT}&tf=15m`));
  assert.equal(calls.length, before, "chart cached");
  console.log("ALL ROUTE TESTS PASSED (" + calls.length + " mocked upstream calls)");
}
main().catch((e) => { console.error(e); process.exit(1); });
