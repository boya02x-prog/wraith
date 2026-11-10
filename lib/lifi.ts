// Client helpers for LI.FI routing (quotes via /api/swap-quote, status via /api/swap-status).
import { createPublicClient, createWalletClient, custom, encodeFunctionData, http, parseAbi, type Chain } from "viem";
import { rpcFor } from "@/lib/cashTokens";
import type { V4Plan } from "@/lib/uniV4";
import { reportQuestTrade } from "@/lib/questTrade";

export const SOLANA_LIFI_ID = 1151111081099710;
export const NATIVE_ADDR = "0x0000000000000000000000000000000000000000";

export interface LifiQuote {
  transactionRequest: { to?: `0x${string}`; data: string; value?: string; gasLimit?: string };
  estimate: { approvalAddress?: string; toAmountMin: string; executionDuration?: number; gasCosts?: { amountUSD?: string }[]; feeCosts?: { amountUSD?: string }[] };
  action: { toToken: { decimals: number; symbol: string } };
  /** set when no router could route a sell and a direct Uniswap v4 sell is used instead */
  v4?: V4Plan;
}

export async function lifiQuote(p: { fromChain: number; toChain: number; fromToken: string; toToken: string; fromAmount: string; fromAddress: string; toAddress?: string }): Promise<LifiQuote> {
  const q = new URLSearchParams({ fromChain: String(p.fromChain), toChain: String(p.toChain), fromToken: p.fromToken, toToken: p.toToken, fromAmount: p.fromAmount, fromAddress: p.fromAddress, slippage: "0.03", skipSimulation: "true" });
  if (p.toAddress) q.set("toAddress", p.toAddress);
  // LI.FI sometimes picks a route its own simulation then rejects. Retry with other route preferences before giving up.
  const tries: Record<string, string>[] = [{}, { order: "FASTEST" }, { order: "CHEAPEST", denyExchanges: "nordstern,bitget" }];
  let lastMsg = "No route found for this amount";
  for (const extra of tries) {
    const qq = new URLSearchParams(q);
    for (const [k, v] of Object.entries(extra)) qq.set(k, v);
    const res = await fetch(`/api/swap-quote?${qq}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.transactionRequest) return data as LifiQuote;
    const why = Array.isArray(data?.errors) && data.errors[0] ? ` (${data.errors[0].tool ?? "route"}: ${String(data.errors[0].message ?? data.errors[0].errorType ?? "").slice(0, 80)})` : "";
    lastMsg = `${data?.message || data?.error || "No route found for this amount"}${why}`;
    if (res.status === 401 || res.status === 400) break;
  }
  throw new Error(lastMsg);
}

/** Poll until the destination side lands (cross-chain only). Throws on FAILED. */
export async function waitForRoute(hash: string, fromChain: number, toChain: number): Promise<void> {
  if (fromChain === toChain) return;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(`/api/swap-status?txHash=${hash}&fromChain=${fromChain}&toChain=${toChain}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (s?.status === "DONE") return;
    if (s?.status === "FAILED") throw new Error("Bridge failed. Funds stay recoverable, check the explorer.");
  }
}

const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

/** Sends one EVM tx with gas paid by Wraith (Privy gas sponsorship). */
export type SponsoredSend = (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint; chainId: number }) => Promise<`0x${string}`>;

/** Try gas-free first; if sponsorship isn't available for this chain/app, fall back to paying gas from the wallet. */
export async function withGasFallback<T>(sponsored: () => Promise<T>, selfPaid: () => Promise<T>): Promise<T> {
  // Wraith's one gas style: auto-drip (see useCashSources). Privy sponsorship stays off unless NEXT_PUBLIC_GAS_SPONSOR=1.
  if (process.env.NEXT_PUBLIC_GAS_SPONSOR !== "1") return selfPaid();
  try { return await sponsored(); } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/reject|denied|cancel|closed|exit/i.test(m)) throw e;
    return await selfPaid();
  }
}

interface EvmWalletLike { switchChain: (id: number) => Promise<void>; getEthereumProvider: () => Promise<unknown> }

/** Approve (if needed) + send a LI.FI EVM transaction with the Privy wallet. Returns the tx hash once mined. */
export async function execEvmRoute(o: {
  wallet: EvmWalletLike; account: `0x${string}`; chain: Chain; quote: LifiQuote;
  fromToken: string; native: boolean; fromRaw: bigint; send?: SponsoredSend; onPhase?: (p: "approving" | "sending") => void;
}): Promise<string> {
  if (!o.send) await o.wallet.switchChain(o.chain.id);
  const provider = await o.wallet.getEthereumProvider();
  const wc = createWalletClient({ account: o.account, chain: o.chain, transport: custom(provider as Parameters<typeof custom>[0]) });
  const pc = createPublicClient({ chain: o.chain, transport: http(rpcFor(o.chain) ?? undefined) });
  const spender = o.quote.estimate.approvalAddress as `0x${string}` | undefined;
  if (!o.native && spender) {
    const allowance = await pc.readContract({ address: o.fromToken as `0x${string}`, abi: ERC20, functionName: "allowance", args: [o.account, spender] });
    if (allowance < o.fromRaw) {
      o.onPhase?.("approving");
      const h = o.send
        ? await o.send({ to: o.fromToken as `0x${string}`, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, o.fromRaw] }), chainId: o.chain.id })
        : await wc.writeContract({ address: o.fromToken as `0x${string}`, abi: ERC20, functionName: "approve", args: [spender, o.fromRaw] });
      await pc.waitForTransactionReceipt({ hash: h });
    }
  }
  o.onPhase?.("sending");
  const r = o.quote.transactionRequest;
  const hash = o.send
    ? await o.send({ to: r.to as `0x${string}`, data: r.data as `0x${string}`, value: r.value ? BigInt(r.value) : BigInt(0), chainId: o.chain.id })
    : await wc.sendTransaction({ to: r.to as `0x${string}`, data: r.data as `0x${string}`, value: r.value ? BigInt(r.value) : BigInt(0), ...(r.gasLimit ? { gas: BigInt(r.gasLimit) } : {}) });
  await pc.waitForTransactionReceipt({ hash });
  reportQuestTrade(o.chain.id, hash);
  return hash;
}

export function friendlyError(e: unknown, gasToken?: string, chainName?: string): string {
  const m = e instanceof Error ? e.message : "Transaction failed";
  if (/insufficient funds|gas/i.test(m)) return `Not enough ${gasToken ?? "gas token"}${chainName ? ` on ${chainName}` : ""} to pay network gas, and free gas isn't on for this network yet.`;
  if (/reject|denied|cancel/i.test(m)) return "Cancelled.";
  return m.split("\n")[0].slice(0, 160);
}
