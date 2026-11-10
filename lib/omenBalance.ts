// Server-side OMEN balance + tier. The browser never decides a tier on its own: the server reads the chain.
import { TIERS, TIER_ORDER, type TierKey } from "@/lib/tiers";
import { getLaunchSettings, liveOmenMint } from "@/lib/launchSettingsServer";

const RPCS = [
  ...(process.env.SOLANA_RPC_URL ? [process.env.SOLANA_RPC_URL] : []),
  ...[process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC].filter((u): u is string => !!u),
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

/** True once tiers are switched on in launch control and an OMEN mint is set. */
export const omenConfigured = async () => (await liveOmenMint()) !== null;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastErr = "no rpc";
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) { lastErr = j.error.message ?? "rpc error"; continue; }
      if (j.result !== undefined) return j.result;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "rpc failed";
    }
  }
  throw new Error(lastErr);
}

interface ParsedAccounts {
  value: { account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } } } }[];
}

/** Exact OMEN holding as raw base units (BigInt) plus decimals. Sums every token account the wallet owns for the mint. */
export async function getOmenRaw(wallet: string): Promise<{ raw: bigint; decimals: number }> {
  const mint = await liveOmenMint();
  if (!mint) return { raw: BigInt(0), decimals: 0 };
  // jsonParsed + mint filter finds accounts under both the legacy Token program and Token-2022.
  const r = await rpc<ParsedAccounts>("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  let raw = BigInt(0);
  let decimals = 0;
  for (const a of r.value) {
    const t = a.account.data.parsed.info.tokenAmount;
    raw += BigInt(t.amount);
    decimals = t.decimals;
  }
  return { raw, decimals };
}

/** Highest tier whose whole-token threshold the exact raw balance meets. No float rounding. */
export function tierForRaw(raw: bigint, decimals: number): TierKey {
  let best: TierKey = "GHOST";
  for (const k of TIER_ORDER) {
    const need = BigInt(TIERS[k].minTokens) * BigInt(10) ** BigInt(decimals);
    if (raw >= need) best = k;
  }
  return best;
}

export const earlyAccess = async () => (await getLaunchSettings()).featuresFree;
