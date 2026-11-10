// lib/chains.ts
// Chain registry for non-Solana (EVM) token pages. Safe on server and client.

export interface ChainInfo {
  key: string;        // DexScreener chainId (also used in URLs: ?chain=base)
  name: string;
  gecko: string;      // GeckoTerminal network id
  native: string;
  explorer: string;   // address explorer base, no trailing slash
  color: string;
}

// Only the chains Wraith wallets actually support (see EmbeddedWalletBalanceChip).
// To add a chain: add one entry here. Search, token pages, charts and swaps follow automatically.
export const CHAINS: Record<string, ChainInfo> = {
  ethereum: { key: "ethereum", name: "Ethereum", gecko: "eth", native: "ETH", explorer: "https://etherscan.io", color: "#627eea" },
  base: { key: "base", name: "Base", gecko: "base", native: "ETH", explorer: "https://basescan.org", color: "#0052ff" },
  bsc: { key: "bsc", name: "BNB Chain", gecko: "bsc", native: "BNB", explorer: "https://bscscan.com", color: "#f3ba2f" },
  monad: { key: "monad", name: "Monad", gecko: "monad", native: "MON", explorer: "https://monadscan.com", color: "#836ef9" },
  arc: { key: "arc", name: "Arc", gecko: "arc", native: "USDC", explorer: "https://arcscan.app", color: "#4fd1c5" },
  robinhood: { key: "robinhood", name: "Robinhood Chain", gecko: "robinhood", native: "ETH", explorer: "https://robinhoodchain.blockscout.com", color: "#c3f53c" },
};

export const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function chainOf(key?: string | null): ChainInfo | null {
  if (!key) return null;
  return CHAINS[key.toLowerCase()] ?? null;
}
