// GET /api/wallet-lookup?wallets=a,b,c → which of these Solana wallets belong to Wraith users (profile + verified tier).
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { effectiveTier } from "@/lib/effectiveTier";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const wallets = [...new Set((req.nextUrl.searchParams.get("wallets") ?? "").split(",").filter((w) => SOLANA_MINT_RE.test(w)))].slice(0, 80);
  if (!wallets.length) return NextResponse.json({ users: {} });
  try {
    const db = await getDb();
    const users = await db.collection("users").find({ walletAddress: { $in: wallets } }, { projection: { walletAddress: 1, tier: 1, tierSource: 1 } }).toArray();
    if (!users.length) return NextResponse.json({ users: {} });
    const ids = users.map((u) => String(u._id));
    const profiles = await db.collection("profiles").find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, username: 1, displayName: 1, avatarDataUrl: 1, avatarUrl: 1 } }).toArray();
    const pm = new Map(profiles.map((p) => [String(p.userId), p]));
    const out: Record<string, { userId: string; displayName: string; username: string | null; avatar: string; tier: string }> = {};
    for (const u of users) {
      const id = String(u._id), p = pm.get(id);
      out[String(u.walletAddress)] = { userId: id, displayName: p?.displayName ?? "Wraith trader", username: p?.username ?? null, avatar: p?.avatarDataUrl || p?.avatarUrl || "", tier: effectiveTier(u as never) as string };
    }
    return NextResponse.json({ users: out });
  } catch (e) {
    console.error("[wallet-lookup]", e);
    return NextResponse.json({ users: {} });
  }
}
