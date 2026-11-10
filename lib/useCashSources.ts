"use client";
// Unified cash: every stablecoin in lib/cashTokens.ts across Solana + all EVM chains, from your Wraith wallets.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { createPublicClient, formatUnits, http, isAddress, parseAbi } from "viem";
import { CASH_TOKENS, VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { NATIVE_ADDR } from "@/lib/lifi";

// Auto gas: once a chain holds >= $1 of cash and its gas token is ~empty, Wraith drops a few cents of gas in.
// Same style on every chain, so users never think about gas. Server enforces ownership + daily caps.
const gasTried = new Map<string, number>();
const MIN_EVM_GAS = BigInt("10000000000000"); // 0.00001 native
const MIN_SOL_LAMPORTS = 3_500_000; // 0.0035 SOL

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export interface CashSource {
  id: string; kind: "solana" | "evm"; chain: string; symbol: string;
  address: string; decimals: number; native: boolean; balance: number; chainName: string;
}

export function useCashSources(preferChain?: string) {
  const { user, getAccessToken } = usePrivy();
  const { connection } = useConnection();
  const evmAddress = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "ethereum" && x.walletClientType === "privy");
    return a?.type === "wallet" && isAddress(a.address) ? (a.address as `0x${string}`) : null;
  }, [user]);
  const solAddress = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const [sources, setSources] = useState<CashSource[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!evmAddress && !solAddress) return;
    const rows = await Promise.all(CASH_TOKENS.map(async (c): Promise<CashSource | null> => {
      try {
        if (c.chain === "solana") {
          if (!solAddress) return null;
          const r = await connection.getParsedTokenAccountsByOwner(new PublicKey(solAddress), { mint: new PublicKey(c.address) }, "confirmed");
          const bal = r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
          return { id: `solana:${c.symbol}`, kind: "solana", chain: "solana", chainName: "Solana", symbol: c.symbol, address: c.address, decimals: c.decimals, native: false, balance: bal };
        }
        if (!evmAddress) return null;
        const chain = VIEM_CHAINS[c.chain]; const rpc = chain ? rpcFor(chain) : null;
        if (!chain || !rpc) return null;
        const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) });
        const raw = c.native ? await client.getBalance({ address: evmAddress }) : await client.readContract({ address: c.address as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [evmAddress] });
        return { id: `${c.chain}:${c.symbol}`, kind: "evm", chain: c.chain, chainName: chain.name, symbol: c.symbol, address: c.native ? NATIVE_ADDR : c.address, decimals: c.decimals, native: !!c.native, balance: Number(formatUnits(raw, c.decimals)) };
      } catch { return null; }
    }));
    const score = (s: CashSource) => (s.chain === preferChain ? 1e12 : 0) + s.balance;
    setSources(rows.filter((r): r is CashSource => !!r && r.balance > 0.0001).sort((a, b) => score(b) - score(a)));
    setLoaded(true);

    // ---- auto gas top-up (fire and forget) ----
    try {
      const funded = new Map<string, number>();
      for (const r of rows) if (r && r.balance > 0.0001 && !r.native) funded.set(r.chain, (funded.get(r.chain) ?? 0) + r.balance);
      // First real deposit anywhere => gas on every cheap chain at once (Ethereum only when funded there).
      const hasCash = [...funded.values()].some((v) => v >= 5);
      const targets = new Set<string>(hasCash ? ["base", "bsc", "monad", "robinhood", "solana"] : []);
      for (const [c, v] of funded) if (v >= 5) targets.add(c);
      for (const chainKey of targets) {
        const addr = chainKey === "solana" ? solAddress : evmAddress;
        if (!addr) continue;
        const k = `${chainKey}:${addr}`;
        if (Date.now() - (gasTried.get(k) ?? 0) < 5 * 60_000) continue;
        let low = false;
        if (chainKey === "solana") {
          low = (await connection.getBalance(new PublicKey(addr)).catch(() => MIN_SOL_LAMPORTS)) < MIN_SOL_LAMPORTS;
        } else {
          const chain = VIEM_CHAINS[chainKey]; const rpc = chain ? rpcFor(chain) : null;
          if (!chain || !rpc) continue;
          const pc = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) });
          low = (await pc.getBalance({ address: addr as `0x${string}` }).catch(() => MIN_EVM_GAS)) < MIN_EVM_GAS;
        }
        if (!low) continue;
        gasTried.set(k, Date.now());
        const token = await getAccessToken();
        void fetch("/api/gas-drip", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ chain: chainKey, address: addr }) }).catch(() => {});
      }
    } catch { /* gas top-up is best-effort */ }
  }, [evmAddress, solAddress, connection, preferChain, getAccessToken]);

  useEffect(() => {
    void reload();
    const t = window.setInterval(() => { if (!document.hidden) void reload(); }, 45_000);
    return () => window.clearInterval(t);
  }, [reload]);

  return { sources, total: sources.reduce((s, x) => s + x.balance, 0), loaded, reload, evmAddress, solAddress };
}
