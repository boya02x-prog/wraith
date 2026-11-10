// GET /api/v4-pool?token=0x...  (Base only)
// Finds the token's Uniswap v4 pool and returns its PoolKey (currency0, currency1, fee, tickSpacing, hooks) by reading the
// PoolManager's Initialize event. Used for direct sells of tokens that no swap router can route.
import { NextRequest, NextResponse } from "next/server";
import { decodeAbiParameters, getAddress, isAddress } from "viem";

export const dynamic = "force-dynamic";
const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
const INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const RPC = process.env.BASE_LOGS_RPC || "https://base-rpc.publicnode.com";
const CHUNK = 9000;
const cache = new Map<string, unknown>();

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result as T;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!isAddress(token)) return NextResponse.json({ error: "bad token" }, { status: 400 });
  const hit = cache.get(token.toLowerCase());
  if (hit) return NextResponse.json(hit);
  try {
    // 1) the pool id: the v4 pair with the most liquidity on DexScreener (pairAddress is the 32-byte pool id)
    const ds = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const pairs = ((ds?.pairs ?? []) as { chainId: string; labels?: string[]; pairAddress: string; liquidity?: { usd?: number } }[])
      .filter((p) => p.chainId === "base" && p.labels?.includes("v4") && /^0x[0-9a-fA-F]{64}$/.test(p.pairAddress))
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    if (!pairs[0]) return NextResponse.json({ error: "No Uniswap v4 pool found for this token" }, { status: 404 });
    const poolId = pairs[0].pairAddress;

    // 2) its Initialize log (scan backwards in chunks, a few at a time)
    const head = parseInt(await rpc<string>("eth_blockNumber", []), 16);
    for (let batch = 0; batch < 8; batch++) {
      const jobs = Array.from({ length: 6 }, (_, i) => {
        const to = head - (batch * 6 + i) * CHUNK; const from = to - CHUNK + 1;
        return rpc<{ topics: string[]; data: string }[]>("eth_getLogs", [{ address: POOL_MANAGER, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [INIT_TOPIC, poolId] }]).catch(() => []);
      });
      const logs = (await Promise.all(jobs)).flat();
      if (logs[0]) {
        const l = logs[0];
        const [fee, tickSpacing, hooks] = decodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }], l.data as `0x${string}`);
        const out = {
          poolId,
          currency0: getAddress("0x" + l.topics[2].slice(26)),
          currency1: getAddress("0x" + l.topics[3].slice(26)),
          fee: Number(fee), tickSpacing: Number(tickSpacing), hooks: getAddress(hooks),
        };
        cache.set(token.toLowerCase(), out);
        return NextResponse.json(out);
      }
    }
    return NextResponse.json({ error: "Pool creation not found in recent blocks" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "lookup failed" }, { status: 502 });
  }
}
