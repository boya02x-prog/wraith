// GET /api/network-stats: the three numbers in the bottom bar. Nothing private: how many people have the app open right now (a count,
// no names), the current Solana transaction fee, and the OMEN market cap once the token exists. Cached for 20 seconds.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { MINT_RE } from "@/lib/launchSettings";

export const dynamic = "force-dynamic";

let cache: { at: number; body: unknown } | null = null;

async function online(): Promise<number | null> {
  try { return await (await getDb()).collection("users").countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 2 * 60_000) } }); } catch { return null; }
}

/** What one ordinary swap costs in fees right now, in SOL: the 5,000-lamport base fee plus the middle priority fee for ~200k compute units. */
async function feeSol(): Promise<number | null> {
  const urls = [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC, "https://solana-rpc.publicnode.com"].filter((u): u is string => !!u);
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(4000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getRecentPrioritizationFees", params: [] }) });
      if (!r.ok) continue;
      const j = (await r.json()) as { result?: { prioritizationFee: number }[] };
      const fees = (j.result ?? []).map((x) => x.prioritizationFee).filter((n) => n > 0).sort((a, b) => a - b);
      const median = fees.length ? fees[Math.floor(fees.length / 2)] : 0; // micro-lamports per compute unit
      return (5000 + (median * 200_000) / 1e6) / 1e9;
    } catch { /* next endpoint */ }
  }
  return null;
}

async function omen(): Promise<{ mcap: number; price: number } | null> {
  try {
    const mint = (await getLaunchSettings()).omenMint;
    if (!MINT_RE.test(mint)) return null;
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const pairs = ((await r.json()) as { pairs?: { liquidity?: { usd?: number }; marketCap?: number; fdv?: number; priceUsd?: string }[] }).pairs ?? [];
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const mcap = Number(best?.marketCap ?? best?.fdv ?? 0);
    return mcap > 0 ? { mcap, price: Number(best?.priceUsd ?? 0) } : null;
  } catch { return null; }
}

export async function GET() {
  if (cache && Date.now() - cache.at < 20_000) return NextResponse.json(cache.body);
  const [o, f, m] = await Promise.all([online(), feeSol(), omen()]);
  const body = { online: o, feeSol: f, omen: m };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": "private, max-age=10" } });
}
