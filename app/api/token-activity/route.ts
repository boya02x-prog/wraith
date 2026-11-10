import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { SOLANA_MINT_RE } from "@/lib/market";
import { hasTradedToken, verifySwapSignature } from "@/lib/holdingCheck";
import { activityLimiter, checkLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Has the signed-in user bought or sold this token? (unlocks posting intel on it)
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) return NextResponse.json({ error: "Invalid mint." }, { status: 400 });
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ signedIn: false, canPost: false });
  const canPost = await hasTradedToken(session.user.id, mint);
  return NextResponse.json({ signedIn: true, canPost });
}

// Called by the trade panel after a swap confirms.
export async function POST(req: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { mint?: unknown; side?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const { mint, side, signature } = body;
  if (typeof mint !== "string" || !SOLANA_MINT_RE.test(mint)) return NextResponse.json({ error: "Invalid mint." }, { status: 400 });
  if (side !== "buy" && side !== "sell") return NextResponse.json({ error: "Invalid side." }, { status: 400 });
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  const rl = await checkLimit(activityLimiter, session.user.id);
  if (!rl.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    // This record unlocks posting intel on the token, so it must be real: the transaction has to exist on chain, be signed by this
    // user's own wallet and really move this token in the claimed direction. (Before, any 60-100 character string was accepted.)
    if (!(await verifySwapSignature(session.user.id, mint, side, signature))) {
      return NextResponse.json({ error: "That trade could not be verified on chain." }, { status: 422 });
    }
    const db = await getDb();
    await db.collection("token_activity").updateOne(
      { userId: session.user.id, mint },
      { $set: { lastSide: side, lastSignature: signature, lastAt: Date.now() }, $setOnInsert: { userId: session.user.id, mint, firstAt: Date.now() }, $inc: { count: 1 }, $addToSet: { sides: side } },
      { upsert: true },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[token-activity POST]", e);
    return NextResponse.json({ error: "Could not record activity." }, { status: 500 });
  }
}
