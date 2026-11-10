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

// Toggle a repost. Same fix as the heart route: a unique (calloutId, userId) row is the single source of truth, so parallel requests
// can no longer create several copies of the same callout in the feed. Un-reposting now also removes the copy it created.
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
    const reposts = db.collection("callout_reposts");
    await ensureIndex(reposts, { calloutId: 1, userId: 1 }, { unique: true }, ["calloutId", "userId"]);

    // un-repost: whoever actually deletes the row fixes the counter and removes the copy from the feed
    const removed = await reposts.deleteOne({ calloutId: id, userId });
    if (removed.deletedCount === 1) {
      await Promise.all([
        db.collection("callouts").updateOne({ _id: calloutOid, reposts: { $gt: 0 } }, { $inc: { reposts: -1 } }),
        db.collection("callouts").deleteMany({ userId, "repostedFrom.id": id }),
      ]);
      return NextResponse.json({ reposted: false });
    }

    const original = await db.collection("callouts").findOne({ _id: calloutOid });
    if (!original) return jsonError("Callout not found.", 404);

    try {
      await reposts.insertOne({ calloutId: id, userId, createdAt: Date.now() });
    } catch (e) {
      if (isDup(e)) return NextResponse.json({ reposted: true }); // a parallel request already reposted it
      throw e;
    }

    const profile = await db.collection("profiles").findOne({ userId }, { projection: { displayName: 1, username: 1 } });
    const author = await db.collection("profiles").findOne({ userId: original.userId as string }, { projection: { displayName: 1, username: 1 } });

    await Promise.all([
      db.collection("callouts").updateOne({ _id: calloutOid }, { $inc: { reposts: 1 } }),
      db.collection("callouts").insertOne({
        userId,
        mint: original.mint,
        text: original.text,
        createdAt: Date.now(),
        mcapAtPost: original.mcapAtPost ?? null,
        hearts: 0,
        reposts: 0,
        repostedFrom: {
          id,
          userId: original.userId as string,
          displayName: author?.displayName ?? "Wraith trader",
          username: author?.username ?? null,
          text: original.text,
        },
        repostedBy: { userId, displayName: profile?.displayName ?? "Wraith trader", username: profile?.username ?? null },
      }),
    ]);
    return NextResponse.json({ reposted: true });
  } catch (err) {
    console.error("[callout repost POST]", err);
    return jsonError("Could not repost.", 500);
  }
}
