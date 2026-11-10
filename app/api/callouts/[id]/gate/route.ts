import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { checkTokenHolding, MIN_COMMENT_HOLD_USD } from "@/lib/holdingCheck";

export const dynamic = "force-dynamic";

// Can the viewer comment on this callout? (needs >= $3 of the token)
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !/^[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const gate = { signedIn: false, ok: false, heldUsd: 0, minUsd: MIN_COMMENT_HOLD_USD } as { signedIn: boolean; ok: boolean; heldUsd: number; minUsd: number; reason?: string };
  try {
    const session = await getPrivySession();
    if (!session?.user?.id) return NextResponse.json({ gate });
    const db = await getDb();
    const parent = await db.collection("callouts").findOne({ _id: new ObjectId(id) }, { projection: { mint: 1 } });
    if (!parent || typeof parent.mint !== "string") return NextResponse.json({ error: "Callout not found." }, { status: 404 });
    const h = await checkTokenHolding(session.user.id, parent.mint);
    return NextResponse.json({ gate: { signedIn: true, ...h } });
  } catch (err) {
    console.error("[callout gate GET]", err);
    return NextResponse.json({ gate: { ...gate, reason: "Could not check your balance." } });
  }
}
