import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Returns the list of a trader's followers or who they are following.
 *  ?traderId=xxx&type=followers|following&limit=20&offset=0
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const traderId = params.get("traderId") ?? "";
  const type = params.get("type") === "following" ? "following" : "followers";
  const limit = Math.min(Number(params.get("limit") ?? "20"), 50);
  const offset = Math.max(Number(params.get("offset") ?? "0"), 0);

  if (!traderId) return jsonError("traderId is required.", 400);

  const session = await getPrivySession();
  const viewerId = session?.user?.id ?? null;

  try {
    const db = await getDb();

    // Get the list of userIds for the requested relationship
    const follows =
      type === "followers"
        ? await db
            .collection("trader_follows")
            .find({ traderId }, { projection: { _id: 0, followerId: 1 } })
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray()
        : await db
            .collection("trader_follows")
            .find(
              { followerId: traderId },
              { projection: { _id: 0, traderId: 1 } },
            )
            .sort({ createdAt: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();

    const userIds = follows
      .map((follow) =>
        type === "followers" ? follow.followerId : follow.traderId,
      )
      .filter((id): id is string => typeof id === "string");

    if (!userIds.length) {
      const total = await db
        .collection("trader_follows")
        .countDocuments(
          type === "followers" ? { traderId } : { followerId: traderId },
        );
      return NextResponse.json({ users: [], total });
    }

    const [profiles, total, viewerFollows] = await Promise.all([
      db
        .collection("profiles")
        .find(
          { userId: { $in: userIds } },
          {
            projection: {
              _id: 0,
              userId: 1,
              username: 1,
              displayName: 1,
              avatarDataUrl: 1,
              avatarUrl: 1,
            },
          },
        )
        .toArray(),
      db
        .collection("trader_follows")
        .countDocuments(
          type === "followers" ? { traderId } : { followerId: traderId },
        ),
      viewerId
        ? db
            .collection("trader_follows")
            .find(
              { followerId: viewerId, traderId: { $in: userIds } },
              { projection: { _id: 0, traderId: 1 } },
            )
            .toArray()
        : Promise.resolve([]),
    ]);

    const viewerFollowingSet = new Set(
      (viewerFollows as unknown as { traderId: string }[]).map((f) => f.traderId),
    );
    const profileMap = new Map(
      profiles.map((p) => [p.userId as string, p]),
    );

    const users = userIds
      .map((uid) => {
        const p = profileMap.get(uid);
        return {
          userId: uid,
          username: p?.username ?? null,
          displayName: p?.displayName || "Wraith trader",
          avatarDataUrl: p?.avatarDataUrl || p?.avatarUrl || "",
          isFollowing: viewerFollowingSet.has(uid),
          isSelf: viewerId === uid,
        };
      })
      .filter((u) => u.displayName);

    return NextResponse.json({ users, total });
  } catch (error) {
    console.error("[traders followers GET]", error);
    return jsonError("Could not load list.", 500);
  }
}
