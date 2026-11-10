"use client";
// Gas-free EVM sends. Two layers:
//  1) Privy gas sponsorship (dashboard > Gas sponsorship)
//  2) /api/gas-drip: Wraith tops up a nearly-empty wallet with a few cents of gas from its treasury (env GAS_TREASURY_KEY)
import { createPublicClient, http, parseEther } from "viem";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import type { SponsoredSend } from "@/lib/lifi";

export function useSponsoredSend(): SponsoredSend {
  const { sendTransaction } = useSendTransaction();
  return async (tx) => {
    const r = await sendTransaction(
      { to: tx.to, data: tx.data, value: tx.value !== undefined ? `0x${tx.value.toString(16)}` : undefined, chainId: tx.chainId },
      { sponsor: true },
    );
    return r.hash;
  };
}

/** Call before a self-paid tx: if the wallet has (almost) no gas, ask Wraith to top it up and wait until it lands. */
export function useEnsureGas() {
  const { getAccessToken } = usePrivy();
  return async (chainKey: string, address: string): Promise<void> => {
    const chain = VIEM_CHAINS[chainKey]; const rpc = chain ? rpcFor(chain) : null;
    if (!chain || !rpc || chainKey === "arc") return; // Arc gas is USDC itself
    const pc = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) });
    const before = await pc.getBalance({ address: address as `0x${string}` }).catch(() => null);
    if (before === null || before >= parseEther("0.00001")) return;
    try {
      const token = await getAccessToken();
      const r = await fetch("/api/gas-drip", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ chain: chainKey, address }) });
      if (!r.ok) return;
    } catch { return; }
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 1500));
      const now = await pc.getBalance({ address: address as `0x${string}` }).catch(() => null);
      if (now !== null && now > before) return;
    }
  };
}
