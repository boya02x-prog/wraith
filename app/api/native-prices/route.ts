import { NextResponse } from "next/server";

const NATIVE_ASSETS = ["ETH", "SOL"] as const;

async function getUsdPrice(asset: (typeof NATIVE_ASSETS)[number]) {
  const response = await fetch(
    `https://api.coinbase.com/v2/prices/${asset}-USD/spot`,
    { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) {
    throw new Error(`Coinbase price request failed for ${asset}.`);
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("amount" in payload.data)
  ) {
    throw new Error(`Coinbase returned an invalid ${asset} price.`);
  }

  const price = Number(payload.data.amount);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Coinbase returned an unusable ${asset} price.`);
  }
  return price;
}

export async function GET() {
  const [ethResult, solResult, bnbResult] = await Promise.allSettled([
    getUsdPrice("ETH"),
    getUsdPrice("SOL"),
    getBnbUsdPrice(),
  ]);
  const prices: Partial<Record<"ETH" | "SOL" | "BNB", number>> = {};

  if (ethResult.status === "fulfilled") prices.ETH = ethResult.value;
  else console.error("[native prices: ETH]", ethResult.reason);
  if (solResult.status === "fulfilled") prices.SOL = solResult.value;
  else console.error("[native prices: SOL]", solResult.reason);
  if (bnbResult.status === "fulfilled") prices.BNB = bnbResult.value;
  else console.error("[native prices: BNB]", bnbResult.reason);

  if (Object.keys(prices).length === 0) {
    return NextResponse.json(
      { error: "Native asset prices are unavailable." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { prices },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}

async function getBnbUsdPrice(): Promise<number> {
  const response = await fetch(
    "https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
    { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) {
    throw new Error(`BNB price request failed (${response.status}).`);
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("price" in payload)
  ) {
    throw new Error("Binance returned an invalid BNB price.");
  }
  const price = Number(payload.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Binance returned an unusable BNB price.");
  }
  return price;
}
