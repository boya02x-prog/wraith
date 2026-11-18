// GET /api/network-stats: the three numbers in the bottom bar. Nothing private: how many people have the app open right now (a count,
// no names), the SOL balance of Wraith's gas wallet, and the OMEN market cap once the token exists. Cached for 20 seconds.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { MINT_RE } from "@/lib/launchSettings";
import { evmGasWallet, solanaGasWallet } from "@/lib/gasWallets";

export const dynamic = "force-dynamic";

let cache: { at: number; body: unknown } | null = null;

async function online(): Promise<number | null> {
  try { return await (await getDb()).collection("users").countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 2 * 60_000) } }); } catch { return null; }
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
  const [o, g, e, m] = await Promise.all([online(), solanaGasWallet(), evmGasWallet(), omen()]);
  // balances only: the wallet addresses are shown on the admin page, not in this public-facing number strip
  const body = { online: o, gas: g ? { sol: g.sol, topups: g.topups } : null, evm: e ? e.chains : null, omen: m };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": "private, max-age=10" } });
}
