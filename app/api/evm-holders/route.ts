// GET /api/evm-holders?address=0x…&chain=base → top holders + holder count via the chain's Blockscout (free, no key).
// Chains without a known Blockscout instance return supported:false.
import { NextRequest, NextResponse } from "next/server";
import { arr, getJson, num, obj } from "@/lib/marketProviders";
import { chainOf, EVM_ADDR_RE } from "@/lib/chains";

const BLOCKSCOUT: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  robinhood: "https://robinhoodchain.blockscout.com",
};
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const chain = chainOf(req.nextUrl.searchParams.get("chain"));
  if (!EVM_ADDR_RE.test(address) || !chain) return NextResponse.json({ supported: false, holders: [], count: null }, { status: 400 });
  const base = BLOCKSCOUT[chain.key];
  if (!base) return NextResponse.json({ supported: false, holders: [], count: null });
  const key = `${chain.key}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 60_000) return NextResponse.json(hit.body);
  try {
    const [info, list] = await Promise.all([
      getJson(`${base}/api/v2/tokens/${address}`, undefined, 8000).then(obj).catch(() => ({} as Record<string, unknown>)),
      getJson(`${base}/api/v2/tokens/${address}/holders`, undefined, 8000).then(obj),
    ]);
    const decimals = num(info.decimals) || 18;
    const supply = num(info.total_supply);
    const holders = arr(list.items).slice(0, 25).map((it) => {
      const o = obj(it);
      const value = num(o.value);
      return { wallet: String(obj(o.address).hash ?? ""), quantity: value / 10 ** decimals, share: supply > 0 ? (value / supply) * 100 : 0 };
    }).filter((h) => h.wallet);
    const count = info.holders_count != null ? num(info.holders_count) : info.holders != null ? num(info.holders) : null;
    const body = { supported: true, holders, count };
    cache.set(key, { ts: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    if (hit) return NextResponse.json(hit.body);
    return NextResponse.json({ supported: true, holders: [], count: null, error: e instanceof Error ? e.message : "provider error" });
  }
}
