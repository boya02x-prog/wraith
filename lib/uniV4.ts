// Direct Uniswap v4 sells on Base for tokens no aggregator can route (new pools). Pool must be ETH / token.
// Flow: token -> Permit2 allowance -> Universal Router V4_SWAP (exact in, single pool) -> ETH. The caller then turns ETH into cash.
import { encodeAbiParameters, encodeFunctionData, parseAbi, type PublicClient } from "viem";

export const V4_BASE = {
  chainId: 8453,
  router: "0x6ff5693b99212da76ad316178a184ab56d299b43" as `0x${string}`,
  quoter: "0x0d5e0f971ed27fbff6c2837bf31316121532048d" as `0x${string}`,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`,
};
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export interface PoolKey { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` }
export interface V4Plan { key: PoolKey; token: `0x${string}`; amountIn: bigint; estOut: bigint; minOut: bigint }

const KEY_T = { type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" } ] } as const;

const QUOTER = [{ type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [{ name: "poolKey", ...KEY_T }, { name: "zeroForOne", type: "bool" }, { name: "exactAmount", type: "uint128" }, { name: "hookData", type: "bytes" }] }],
  outputs: [{ name: "amountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }] }] as const;

const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const PERMIT2 = parseAbi(["function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)", "function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const ROUTER = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

export async function planV4Sell(client: PublicClient, token: `0x${string}`, amountIn: bigint, slippage = 0.12): Promise<V4Plan> {
  const r = await fetch(`/api/v4-pool?token=${token}`, { cache: "no-store" });
  const k = await r.json().catch(() => ({}));
  if (!r.ok || !k.currency0) throw new Error(k.error || "No direct pool found for this token");
  const key: PoolKey = { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks };
  if (key.currency0 !== ZERO || key.currency1.toLowerCase() !== token.toLowerCase()) throw new Error("This pool isn't an ETH pair, can't sell it directly yet");
  let estOut = BigInt(0);
  try {
    const { result } = await client.simulateContract({ address: V4_BASE.quoter, abi: QUOTER, functionName: "quoteExactInputSingle",
      args: [{ poolKey: key, zeroForOne: false, exactAmount: amountIn, hookData: "0x" }] });
    estOut = result[0];
  } catch {
    // the pool is live but has nothing to trade against at its current price (price ran past all the liquidity)
    throw new Error("This token's pool has no liquidity at the current price, so nobody can sell it right now. It becomes sellable again when buyers or new liquidity bring the price back into range.");
  }
  if (estOut <= BigInt(0)) throw new Error("Pool has no liquidity to sell into");
  const minOut = (estOut * BigInt(Math.round((1 - slippage) * 10000))) / BigInt(10000);
  return { key, token, amountIn, estOut, minOut };
}

export type SendTx = (tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint }) => Promise<`0x${string}`>;

/** Runs approvals (only when needed) then the swap. `wait` resolves once a tx hash is mined. */
export async function execV4Sell(o: { client: PublicClient; account: `0x${string}`; plan: V4Plan; send: SendTx; wait: (h: `0x${string}`) => Promise<void>; onPhase?: (p: "approving" | "sending") => void }): Promise<`0x${string}`> {
  const { client, account, plan } = o;
  const have = await client.readContract({ address: plan.token, abi: ERC20, functionName: "allowance", args: [account, V4_BASE.permit2] });
  if (have < plan.amountIn) {
    o.onPhase?.("approving");
    const h = await o.send({ to: plan.token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [V4_BASE.permit2, plan.amountIn] }) });
    await o.wait(h);
  }
  const now = Math.floor(Date.now() / 1000);
  const [pAmt, pExp] = await client.readContract({ address: V4_BASE.permit2, abi: PERMIT2, functionName: "allowance", args: [account, plan.token, V4_BASE.router] });
  if (pAmt < plan.amountIn || pExp <= now + 120) {
    o.onPhase?.("approving");
    const h = await o.send({ to: V4_BASE.permit2, data: encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [plan.token, V4_BASE.router, plan.amountIn, now + 3600] }) });
    await o.wait(h);
  }
  o.onPhase?.("sending");
  const swap = encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...KEY_T }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }],
    [{ poolKey: plan.key, zeroForOne: false, amountIn: plan.amountIn, amountOutMinimum: plan.minOut, hookData: "0x" }]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [plan.token, plan.amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ZERO, plan.minOut]);
  const actions = "0x060c0f" as `0x${string}`; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swap, settle, take]]);
  const data = encodeFunctionData({ abi: ROUTER, functionName: "execute", args: ["0x10", [input], BigInt(now + 600)] });
  const h = await o.send({ to: V4_BASE.router, data });
  await o.wait(h);
  return h;
}
