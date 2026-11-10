// Server-only. Decides whether an account gets free gas, and keeps the platform's gas spend inside what it earns.
//   1) account strikes / freeloader rule
//   2) deposit size read from the chain (never trusted from the browser)
//   3) OMEN tier boost (switches itself on when the token is configured)
//   4) per-account refill caps, scaled by tier
//   5) global daily budget = small floor that grows with yesterday's trade fees (hard max)
import type { Db } from "mongodb";
import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { PublicKey, Connection } from "@solana/web3.js";
import { CASH_TOKENS, VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { getOmenRaw, omenConfigured, tierForRaw } from "@/lib/omenBalance";
import { FEE_BPS_DEFAULT } from "@/lib/gasConst";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// rough USD cost of one drip, for the ledger + budget (override with GAS_COST_<CHAIN>)
const COST: Record<string, number> = { base: 0.05, bsc: 0.12, monad: 0.03, robinhood: 0.05, ethereum: 1.2, solana: 0.45 };
export const dripCostUsd = (chain: string) => Number(process.env[`GAS_COST_${chain.toUpperCase()}`] ?? COST[chain] ?? 0.2);

export type GasLevel = 0 | 1 | 2 | 3; // 0 none, 1 starter, 2 standard, 3 full (incl. Ethereum)
const LEVELS = [
  { min: Infinity, refills: 0, ethereum: false },
  { min: 5, refills: 2, ethereum: false },
  { min: 25, refills: 3, ethereum: false },
  { min: 100, refills: 5, ethereum: true },
];

/** Total stablecoin cash this account really holds, read from the chain. */
export async function cashUsd(evm: string | null, sol: string | null): Promise<number> {
  const jobs = CASH_TOKENS.map(async (c): Promise<number> => {
    try {
      if (c.chain === "solana") {
        if (!sol) return 0;
        const conn = new Connection(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", "confirmed");
        const r = await conn.getParsedTokenAccountsByOwner(new PublicKey(sol), { mint: new PublicKey(c.address) });
        return r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
      }
      if (!evm) return 0;
      const chain = VIEM_CHAINS[c.chain]; const rpc = chain ? rpcFor(chain) : null;
      if (!chain || !rpc) return 0;
      const pc = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: 6000 }) });
      const raw = c.native ? await pc.getBalance({ address: evm as `0x${string}` }) : await pc.readContract({ address: c.address as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [evm as `0x${string}`] });
      return Number(formatUnits(raw, c.decimals));
    } catch { return 0; }
  });
  return (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
}

/** OMEN holders count as having a bigger deposit. Inactive until the token mint is configured. */
async function omenBoostUsd(sol: string | null): Promise<number> {
  if (!sol || !(await omenConfigured())) return 0;
  try {
    const { raw, decimals } = await getOmenRaw(sol);
    const t = tierForRaw(raw, decimals);
    return t === "WRAITH" ? 100 : t === "SPECTER" ? 50 : t === "SHADE" ? 25 : 0;
  } catch { return 0; }
}

/** Daily drip budget: small floor, grows with 20% of yesterday's estimated fees, hard max. */
export async function dailyBudget(db: Db): Promise<number> {
  const floor = Number(process.env.GAS_DRIP_GLOBAL_DAILY ?? 40);
  const max = Number(process.env.GAS_DRIP_GLOBAL_MAX ?? 400);
  const share = Number(process.env.GAS_BUDGET_SHARE ?? 0.2);
  const since = Date.now() - 24 * 3600 * 1000;
  try {
    // volume per user capped at $500/day so fake trade posts can't inflate the budget
    const rows = await db.collection("evm_trades").aggregate([
      { $match: { ts: { $gte: since } } },
      { $group: { _id: "$userId", usd: { $sum: "$usd" } } },
      { $project: { usd: { $min: ["$usd", 500] } } },
      { $group: { _id: null, usd: { $sum: "$usd" } } },
    ]).toArray();
    const fees = ((rows[0]?.usd as number | undefined) ?? 0) * (FEE_BPS_DEFAULT / 10_000);
    return Math.min(max, Math.max(floor, Math.floor((fees * share) / 0.15)));
  } catch { return floor; }
}

export async function gasDecision(db: Db, o: { userId: string; chain: string; evm: string | null; sol: string | null }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const drips = db.collection("gas_drips");
  const month = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const day = new Date(Date.now() - 24 * 3600 * 1000);

  // 1) strikes + freeloader rule
  const u = await db.collection("gas_strikes").findOne({ userId: o.userId });
  if (u?.blocked) return { ok: false, reason: "Free gas is not available for this account" };
  const total = await drips.countDocuments({ userId: o.userId });
  // first deposit gets 5 cheap chains at once; after that, gas is only for accounts that actually trade
  if (total >= 6) {
    const traded = (await db.collection("evm_trades").countDocuments({ userId: o.userId }, { limit: 1 })) + (await db.collection("trades").countDocuments({ userId: o.userId }, { limit: 1 }));
    if (!traded) return { ok: false, reason: "Make a trade to unlock more free gas" };
  }

  // 2+3) deposit size on-chain, or OMEN tier, whichever is bigger
  const eff = Math.max(await cashUsd(o.evm, o.sol), await omenBoostUsd(o.sol));
  let level: GasLevel = 0;
  if (eff >= 100) level = 3; else if (eff >= 25) level = 2; else if (eff >= 5) level = 1;
  if (level === 0) return { ok: false, reason: "Deposit at least $5 to unlock free gas" };
  if (o.chain === "ethereum" && !LEVELS[level].ethereum) return { ok: false, reason: "Free Ethereum gas starts at a $100 deposit" };

  // 4) per-account refills per chain
  if ((await drips.countDocuments({ userId: o.userId, chain: o.chain, at: { $gte: month } })) >= LEVELS[level].refills)
    return { ok: false, reason: "Free gas limit reached for this chain" };

  // 5) global budget
  const spent = (await drips.find({ at: { $gte: day } }).project({ costUsd: 1 }).toArray()).reduce((s, d) => s + Number((d as { costUsd?: number }).costUsd ?? 0.2), 0);
  const budget = (await dailyBudget(db)) * 0.15; // dailyBudget is in "average drips" (~15c each) -> USD
  if (spent >= budget) return { ok: false, reason: "Free gas is paused for today" };
  return { ok: true };
}
