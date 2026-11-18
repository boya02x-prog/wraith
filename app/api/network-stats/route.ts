// GET /api/network-stats: the three numbers in the bottom bar. Nothing private: how many people have the app open right now (a count,
// no names), the SOL balance of Wraith's gas wallet, and the OMEN market cap once the token exists. Cached for 20 seconds.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { MINT_RE } from "@/lib/launchSettings";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

export const dynamic = "force-dynamic";

let cache: { at: number; body: unknown } | null = null;

async function online(): Promise<number | null> {
  try { return await (await getDb()).collection("users").countDocuments({ lastSeenAt: { $gte: new Date(Date.now() - 2 * 60_000) } }); } catch { return null; }
}

/** SOL left in the wallet Wraith uses to pay users' gas (GAS_TREASURY_SOL_KEY), and roughly how many top-ups that covers.
 *  Only the numbers leave the server: never the key, and not even the wallet address. */
async function gasWallet(): Promise<{ sol: number; topups: number } | null> {
  const key = process.env.GAS_TREASURY_SOL_KEY;
  if (!key) return null;
  let pub: string;
  try { pub = Keypair.fromSecretKey(bs58.decode(key)).publicKey.toBase58(); } catch { return null; }
  const urls = [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC, "https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"].filter((u): u is string => !!u);
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(3500), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pub, { commitment: "confirmed" }] }) });
      if (!r.ok) continue;
      const lamports = ((await r.json()) as { result?: { value?: number } }).result?.value;
      if (typeof lamports !== "number") continue;
      const drip = Number(process.env.GAS_DRIP_SOLANA_LAMPORTS ?? 4_000_000);
      return { sol: lamports / 1e9, topups: Math.floor(lamports / drip) };
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
  const [o, g, m] = await Promise.all([online(), gasWallet(), omen()]);
  const body = { online: o, gas: g, omen: m };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": "private, max-age=10" } });
}
