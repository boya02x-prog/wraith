// GET /api/wallet-profile?address=<solana wallet>   (FAST: database + net worth only, so the page header shows at once)
// A profile for any Solana wallet, even one that never made a Wraith account: Wraith's own record of it, whether it belongs to a
// Wraith trader, and how much it is worth. The trade list is a separate call (/api/wallet-trades) because it is slower.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { walletNetWorth } from "@/lib/walletAssets";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").trim();
  if (!SOLANA_MINT_RE.test(address)) return NextResponse.json({ error: "Not a Solana wallet address" }, { status: 400 });
  const db = await getDb();

  const [stat, user, calls, net] = await Promise.all([
    db.collection("wallet_stats").findOne({ _id: address as never }),
    db.collection("users").findOne({ walletAddress: address }, { projection: { _id: 1 } }),
    db.collection("signal_calls").find({ buyers: address, shadow: { $ne: true } }, { projection: { address: 1, symbol: 1, imageUrl: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).sort({ spottedAt: -1 }).limit(20).toArray(),
    walletNetWorth(address),
  ]);

  let wraith: null | { userId: string; displayName: string; username: string | null } = null;
  if (user) {
    const p = await db.collection("profiles").findOne({ userId: String(user._id) }, { projection: { username: 1, displayName: 1 } });
    wraith = { userId: String(user._id), displayName: (p?.displayName as string) ?? "Wraith trader", username: (p?.username as string) ?? null };
  }

  return NextResponse.json({
    address,
    wraith,
    record: stat ? {
      calls: Number(stat.n) || 0, wins: Number(stat.wins) || 0, dumps: Number(stat.dumps) || 0,
      kind: (stat.kind as string) ?? "regular", holdPct: stat.holdPct ?? null, flipPct: stat.flipPct ?? null, medOffsetS: stat.medOffsetS ?? null, avgSol: stat.avgSol ?? null,
    } : null,
    earlyIn: calls.map((c) => ({ address: c.address, symbol: c.symbol, imageUrl: c.imageUrl ?? null, spottedAt: c.spottedAt, x: c.spottedMcap > 0 ? Math.max(c.peakMcap, c.lastMcap) / c.spottedMcap : 0, now: c.spottedMcap > 0 ? c.lastMcap / c.spottedMcap : 0 })),
    net,
  }, { headers: { "Cache-Control": "private, max-age=120" } });
}
