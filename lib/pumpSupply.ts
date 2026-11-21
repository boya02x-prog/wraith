// Every pump.fun token has exactly 1,000,000,000 supply (the mint address ends in "pump"). Market-cap figures built from a price feed's own "supply"
// (market cap / price) can be off by a large factor when that feed gives a fully-diluted or stale value, which drew a chart 30x too high next to a
// "Spotted" level that was worked out as price x 1B. For these tokens the supply is simply the known number.
export const PUMP_SUPPLY = 1_000_000_000;
export function supplyFor(mint: string | null | undefined, reported: number | null | undefined): number | null {
  if (mint && /pump$/.test(mint)) return PUMP_SUPPLY;
  return reported && reported > 0 ? reported : null;
}

/**
 * A live price worked out from a pool or bonding curve is "reserves of one side / reserves of the other x the SOL price". Some pump.fun tokens are quoted in the PUMP
 * token instead of SOL, so that arithmetic gives a price about 30x too high (a $12K token showed $410K and the chart was stretched to match). The indexed price the page
 * loaded with is the trusted one: a live reading more than 5x away from it is a wrong unit, not a move, and is ignored.
 */
export function livePriceOk(trusted: number | null | undefined, live: number): boolean {
  if (!(live > 0)) return false;
  if (!trusted || !(trusted > 0)) return true;
  return live <= trusted * 5 && live >= trusted / 5;
}
