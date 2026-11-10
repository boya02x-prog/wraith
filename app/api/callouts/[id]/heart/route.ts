import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { checkLimit, reactLimiter } from "@/lib/ratelimit";
import { ensureIndex } from "@/lib/ensureIndex";

function jsonError(msg: string, status: number) {
  return NextResponse.json({ error: msg }, { status });
}
const isDup = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;

// Toggle a heart. The old version looked the heart up first and wrote afterwards, so firing the request many times in parallel
// inserted many hearts for one person and inflated the counter. A unique (calloutId, userId) row now decides who wins, and the
// counter only moves when a row was really added or removed.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getPrivySession();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);
  const userId = session.user.id;

  const { id } = await params;
  if (!id || !/^[a-f0-9]{24}$/.test(id)) return jsonError("Invalid id.", 400);

  const rl = await checkLimit(reactLimiter, userId);
  if (!rl.success) return jsonError("Slow down.", 429);

  try {
    const db = await getDb();
    const calloutOid = new ObjectId(id);
    const hearts = db.collection("callout_hearts");
    await ensureIndex(hearts, { calloutId: 1, userId: 1 }, { unique: true }, ["calloutId", "userId"]);

    // un-heart: whoever actually deletes the row decrements the counter
    const removed = await hearts.deleteOne({ calloutId: id, userId });
    if (removed.deletedCount === 1) {
      await db.collection("callouts").updateOne({ _id: calloutOid, hearts: { $gt: 0 } }, { $inc: { hearts: -1 } });
      return NextResponse.json({ hearted: false });
    }

    // never store hearts for callouts that do not exist
    const exists = await db.collection("callouts").findOne({ _id: calloutOid }, { projection: { _id: 1 } });
    if (!exists) return jsonError("Callout not found.", 404);

    try {
      await hearts.insertOne({ calloutId: id, userId, createdAt: Date.now() });
    } catch (e) {
      if (isDup(e)) return NextResponse.json({ hearted: true }); // a parallel request already added it
      throw e;
    }
    await db.collection("callouts").updateOne({ _id: calloutOid }, { $inc: { hearts: 1 } });
    return NextResponse.json({ hearted: true });
  } catch (err) {
    console.error("[callout heart POST]", err);
    return jsonError("Could not update heart.", 500);
  }
}
