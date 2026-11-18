// The two wallets Wraith uses to pay users' network gas (server only). GAS_TREASURY_SOL_KEY = Solana, GAS_TREASURY_KEY = every EVM chain.
// The bottom bar gets only the balances; the owner-only admin API (/api/admin/gas-wallets) also gets the public addresses, so the owner
// knows where to send funds. Keys never leave this file.
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";

export type SolGas = { address: string; sol: number; topups: number };
export type EvmGasChain = { chain: string; symbol: string; bal: number; topups: number };
export type EvmGas = { address: string; chains: EvmGasChain[] };

const solRpcs = () => [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC, "https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"].filter((u): u is string => !!u);

export async function solanaGasWallet(): Promise<SolGas | null> {
  const key = process.env.GAS_TREASURY_SOL_KEY;
  if (!key) return null;
  let address: string;
  try { address = Keypair.fromSecretKey(bs58.decode(key)).publicKey.toBase58(); } catch { return null; }
  for (const u of solRpcs()) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(3500), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }) });
      if (!r.ok) continue;
      const lamports = ((await r.json()) as { result?: { value?: number } }).result?.value;
      if (typeof lamports !== "number") continue;
      return { address, sol: lamports / 1e9, topups: Math.floor(lamports / Number(process.env.GAS_DRIP_SOLANA_LAMPORTS ?? 4_000_000)) };
    } catch { /* next endpoint */ }
  }
  return { address, sol: 0, topups: 0 };
}

// amount sent per top-up on each chain: the same defaults as /api/gas-drip (GAS_DRIP_<CHAIN> overrides)
const EVM_DRIP: Record<string, string> = { base: "0.00003", ethereum: "0.0004", bsc: "0.0002", monad: "0.2", robinhood: "0.00003" };

export async function evmGasWallet(): Promise<EvmGas | null> {
  const key = process.env.GAS_TREASURY_KEY;
  if (!key) return null;
  let address: `0x${string}`;
  try { address = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`).address; } catch { return null; }
  const out = await Promise.all(Object.keys(EVM_DRIP).map(async (name): Promise<EvmGasChain | null> => {
    const chain = VIEM_CHAINS[name]; const rpc = chain ? rpcFor(chain) : null;
    if (!chain || !rpc) return null;
    try {
      const wei = await createPublicClient({ chain, transport: http(rpc, { timeout: 4000 }) }).getBalance({ address });
      const drip = parseEther(process.env[`GAS_DRIP_${name.toUpperCase()}`] ?? EVM_DRIP[name]);
      return { chain: name, symbol: chain.nativeCurrency.symbol, bal: Number(formatEther(wei)), topups: drip > BigInt(0) ? Number(wei / drip) : 0 };
    } catch { return null; }
  }));
  return { address, chains: out.filter((x): x is EvmGasChain => !!x) };
}
