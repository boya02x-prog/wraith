// GET /api/wallet-transfers?address=0x… → recent stablecoin transfers (USDC/USDT/USDG) for an EVM wallet,
// from each chain's Blockscout (free, no key). Chains without a Blockscout instance are skipped.
import { NextRequest, NextResponse } from "next/server";
import { arr, getJson, num, obj } from "@/lib/marketProviders";
import { EVM_ADDR_RE } from "@/lib/chains";

const BLOCKSCOUT: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  robinhood: "https://robinhoodchain.blockscout.com",
};
const CASH = new Set(["USDC", "USDT", "USDG"]);
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  if (!EVM_ADDR_RE.test(address)) return NextResponse.json({ rows: [] }, { status: 400 });
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 30_000) return NextResponse.json(hit.body);
  const me = key;
  const all = await Promise.all(
    Object.entries(BLOCKSCOUT).map(async ([chain, base]) => {
      try {
        const data = obj(await getJson(`${base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`, undefined, 8000));
        return arr(data.items).flatMap((raw) => {
          const it = obj(raw);
          const token = obj(it.token);
          const symbol = String(token.symbol ?? "").toUpperCase();
          if (!CASH.has(symbol)) return [];
          const from = String(obj(it.from).hash ?? "").toLowerCase();
          const to = String(obj(it.to).hash ?? "").toLowerCase();
          const dec = num(obj(it.total).decimals ?? token.decimals) || 6;
          const value = num(obj(it.total).value) / 10 ** dec;
          const ts = Date.parse(String(it.timestamp ?? "")) || 0;
          const incoming = to === me;
          return [{ chain, symbol, dir: incoming ? "in" : "out", amount: value, ts, peer: incoming ? from : to, hash: String(it.transaction_hash ?? it.tx_hash ?? "") }];
        });
      } catch {
        return [];
      }
    }),
  );
  const body = { rows: all.flat().sort((a, b) => b.ts - a.ts).slice(0, 40) };
  cache.set(key, { ts: Date.now(), body });
  return NextResponse.json(body);
}
