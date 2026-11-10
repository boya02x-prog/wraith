// GET /api/token-traders?mint= → Wraith users who bought/sold this token, with their open position when they still hold it.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) return NextResponse.json({ traders: [] }, { status: 400 });
  try {
    const db = await getDb();
    const acts = await db.collection("token_activity").find({ mint }).sort({ lastAt: -1 }).limit(40).toArray();
    if (!acts.length) return NextResponse.json({ traders: [] });
    const ids = acts.map((a) => String(a.userId));
    const [profiles, positions] = await Promise.all([
      db.collection("profiles").find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, username: 1, displayName: 1, avatarDataUrl: 1, avatarUrl: 1 } }).toArray(),
      db.collection("positions").find({ userId: { $in: ids }, mint, status: { $in: ["watching", "selling"] } }, { projection: { _id: 0, userId: 1, amountSol: 1, entryMcap: 1, currentMcap: 1, currentPnlPct: 1 } }).toArray(),
    ]);
    const pm = new Map(profiles.map((p) => [String(p.userId), p]));
    const pos = new Map(positions.map((p) => [String(p.userId), p]));
    const traders = acts.map((a) => {
      const id = String(a.userId), p = pm.get(id), o = pos.get(id);
      return {
        userId: id,
        displayName: p?.displayName ?? "Wraith trader",
        username: p?.username ?? null,
        avatar: p?.avatarDataUrl || p?.avatarUrl || "",
        sides: (a.sides as string[] | undefined) ?? [],
        lastSide: a.lastSide === "sell" ? "sell" : "buy",
        lastAt: Number(a.lastAt) || 0,
        count: Number(a.count) || 1,
        holding: o ? { entryMcap: Number(o.entryMcap) || 0, currentMcap: Number(o.currentMcap) || 0, pnlPct: Number(o.currentPnlPct) || 0 } : null,
      };
    });
    return NextResponse.json({ traders });
  } catch (e) {
    console.error("[token-traders]", e);
    return NextResponse.json({ traders: [] }, { status: 500 });
  }
}
