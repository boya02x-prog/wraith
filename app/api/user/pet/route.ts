// POST /api/user/pet : claim your Wraith. It is earned, not handed out: you need at least one closed trade. GET says whether it is claimed.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const id = (await getPrivySession().catch(() => null))?.user?.id;
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const db = await getDb();
  const p = await db.collection("profiles").findOne({ userId: id }, { projection: { _id: 0, petClaimedAt: 1 } });
  return NextResponse.json({ claimed: typeof p?.petClaimedAt === "number" });
}

export async function POST() {
  const id = (await getPrivySession().catch(() => null))?.user?.id;
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const db = await getDb();
    const doc = await db.collection("trades").findOne({ userId: id }, { projection: { _id: 0, trades: 1 } });
    const closed = (Array.isArray(doc?.trades) ? doc!.trades : []).filter((t: { pnlPct?: unknown }) => typeof t.pnlPct === "number");
    if (!closed.length) return NextResponse.json({ error: "Make your first trade to claim your Wraith." }, { status: 403 });
    await db.collection("profiles").updateOne({ userId: id }, { $set: { petClaimedAt: Date.now() } }, { upsert: true });
    return NextResponse.json({ claimed: true });
  } catch (e) {
    console.error("[pet claim]", e);
    return NextResponse.json({ error: "Could not claim it right now." }, { status: 500 });
  }
}
