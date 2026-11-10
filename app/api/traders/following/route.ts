import { NextRequest, NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";
import { checkLimit, reactLimiter } from "@/lib/ratelimit";

const MAX_FOLLOWS = 500; // the feed and alerts read at most this many, so more only adds load

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Sign in to view your following list.", 401);

  try {
    const db = await getDb();
    const traderId = request.nextUrl.searchParams.get("traderId");
    if (traderId) {
      const [following, followers, followingCount] = await Promise.all([
        db.collection("trader_follows").findOne({ followerId: userId, traderId }),
        db.collection("trader_follows").countDocuments({ traderId }),
        db.collection("trader_follows").countDocuments({ followerId: traderId }),
      ]);
      return NextResponse.json({ following: Boolean(following), followers, followingCount });
    }

    const follows = await db.collection("trader_follows")
      .find({ followerId: userId }, { projection: { _id: 0, traderId: 1 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return NextResponse.json({ traderIds: follows.map((follow) => follow.traderId).filter((id): id is string => typeof id === "string") });
  } catch (error) {
    console.error("[traders following GET]", error);
    return jsonError("Could not load your following list.", 500);
  }
}

export async function POST(request: NextRequest) {
  const session = await getPrivySession();
  const followerId = session?.user?.id;
  if (!followerId) return jsonError("Sign in to follow traders.", 401);
  const rl = await checkLimit(reactLimiter, `follow:${followerId}`);
  if (!rl.success) return jsonError("Slow down.", 429);

  try {
    const body: unknown = await request.json();
    const traderId = typeof body === "object" && body !== null && "traderId" in body && typeof body.traderId === "string" ? body.traderId : "";
    if (!/^[a-f\d]{24}$/i.test(traderId) || traderId === followerId) return jsonError("Choose a valid public trader.", 400);

    const db = await getDb();
    const profile = await db.collection("profiles").findOne({ userId: traderId, publicTrading: true }, { projection: { _id: 1 } });
    if (!profile) return jsonError("This trader is not publicly available.", 404);
    const already = await db.collection("trader_follows").findOne({ followerId, traderId }, { projection: { _id: 1 } });
    if (!already && (await db.collection("trader_follows").countDocuments({ followerId })) >= MAX_FOLLOWS) {
      return jsonError(`You can follow up to ${MAX_FOLLOWS} traders.`, 400);
    }
    await db.collection("trader_follows").updateOne(
      { followerId, traderId },
      { $setOnInsert: { followerId, traderId, createdAt: new Date() } },
      { upsert: true },
    );
    const followers = await db.collection("trader_follows").countDocuments({ traderId });
    return NextResponse.json({ following: true, followers });
  } catch (error) {
    console.error("[traders following POST]", error);
    return jsonError("Could not follow this trader.", 500);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getPrivySession();
  const followerId = session?.user?.id;
  if (!followerId) return jsonError("Sign in to manage your following list.", 401);
  const traderId = request.nextUrl.searchParams.get("traderId") ?? "";
  if (!/^[a-f\d]{24}$/i.test(traderId) || traderId === followerId) return jsonError("Choose a valid trader.", 400);

  try {
    const db = await getDb();
    await db.collection("trader_follows").deleteOne({ followerId, traderId });
    const followers = await db.collection("trader_follows").countDocuments({ traderId });
    return NextResponse.json({ following: false, followers });
  } catch (error) {
    console.error("[traders following DELETE]", error);
    return jsonError("Could not unfollow this trader.", 500);
  }
}
