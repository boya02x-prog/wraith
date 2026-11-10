import { getPrivySession } from "@/lib/privyAuth";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { computeTraderStats } from "@/lib/traderStats";

type StoredTrade = {
  amountSol?: number;
  pnlPct?: number;
  ts?: number;
  closedAt?: number;
};

type StoredPosition = {
  id?: string;
  symbol?: string;
  mint?: string;
  amountSol?: number;
  currentPnlPct?: number;
  ts?: number;
};

export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const savedOnly = request.nextUrl.searchParams.get("saved") === "1";
    const followingOnly = request.nextUrl.searchParams.get("following") === "1";
    const session = await getPrivySession();
    if (savedOnly && !session?.user?.id) {
      return NextResponse.json({ error: "Sign in to view saved traders." }, { status: 401 });
    }
    if (followingOnly && !session?.user?.id) {
      return NextResponse.json({ error: "Sign in to view followed traders." }, { status: 401 });
    }

    let savedIds: string[] = [];
    let followingIds: string[] = [];
    if (session?.user?.id) {
      const [settings, follows] = await Promise.all([
        db.collection("user_settings").findOne(
          { userId: session.user.id },
          { projection: { _id: 0, bookmarkedTraders: 1 } },
        ),
        db.collection("trader_follows").find(
          { followerId: session.user.id },
          { projection: { _id: 0, traderId: 1 } },
        ).limit(500).toArray(),
      ]);
      savedIds = Array.isArray(settings?.bookmarkedTraders)
        ? settings.bookmarkedTraders.filter(
            (id: unknown): id is string => typeof id === "string",
          )
        : [];
      followingIds = follows.map((follow) => follow.traderId).filter((id): id is string => typeof id === "string");
    }
    if (savedOnly && !savedIds.length) {
      return NextResponse.json({ traders: [] });
    }

    const profileFilter: Record<string, unknown> = { publicTrading: true };
    if (session?.user?.id && !savedOnly && !followingOnly) {
      profileFilter.userId = { $ne: session.user.id };
    }
    if (savedOnly) {
      profileFilter.userId = { $in: savedIds };
    }
    if (followingOnly) {
      if (!followingIds.length) return NextResponse.json({ traders: [] });
      profileFilter.userId = { $in: followingIds };
    }
    if (search.length >= 2) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const matchingLinks = await db
        .collection("x_links")
        .find(
          { usernameLower: new RegExp(escaped.toLowerCase(), "i") },
          { projection: { _id: 0, userId: 1 } },
        )
        .limit(25)
        .toArray();
      const matchedIds = matchingLinks
        .map((link) => link.userId)
        .filter((id): id is string => typeof id === "string");
      profileFilter.$and = [
        {
          $or: [
            { displayName: regex },
            { username: regex },
            { bio: regex },
            { userId: regex },
            ...(matchedIds.length ? [{ userId: { $in: matchedIds } }] : []),
          ],
        },
      ];
    }

    const profiles = await db
      .collection("profiles")
      .find(profileFilter, {
        projection: {
          _id: 0,
          userId: 1,
          username: 1,
          displayName: 1,
          bio: 1,
          avatarDataUrl: 1,
          avatarUrl: 1,
        },
      })
      .sort(search ? { displayName: 1 } : { updatedAt: -1 })
      .limit(followingOnly ? 500 : search || savedOnly ? 25 : 30)
      .toArray();

    const traders = await Promise.all(
      profiles.map(async (profile) => {
        const [tradeDoc, positionDoc, xLink] = await Promise.all([
          db
            .collection("trades")
            .findOne(
              { userId: profile.userId },
              { projection: { _id: 0, trades: 1 } },
            ),
          db
            .collection("positions")
            .findOne(
              { userId: profile.userId },
              { projection: { _id: 0, positions: 1 } },
            ),
          db.collection("x_links").findOne(
            { userId: profile.userId },
            { projection: { _id: 0, username: 1 } },
          ),
        ]);
        const trades: StoredTrade[] = Array.isArray(tradeDoc?.trades)
          ? tradeDoc.trades
          : [];
        const closed = trades.filter(
          (trade) =>
            typeof trade.pnlPct === "number" &&
            typeof trade.amountSol === "number",
        );
        const openPositions: StoredPosition[] = Array.isArray(
          positionDoc?.positions,
        )
          ? positionDoc.positions.filter(
              (position: StoredPosition & { status?: string }) =>
                position.status === "watching",
            )
          : [];
        const profitSol = closed.reduce(
          (sum, trade) =>
            sum + (trade.amountSol ?? 0) * ((trade.pnlPct ?? 0) / 100),
          0,
        );
        return {
          userId: profile.userId,
          username: profile.username ?? null,
          displayName: profile.displayName || "Wraith trader",
          bio: profile.bio || "",
          xHandle: xLink?.username || "",
          avatarDataUrl: profile.avatarDataUrl || profile.avatarUrl || "",
          isBookmarked: savedIds.includes(profile.userId),
          isFollowing: followingIds.includes(profile.userId),
          closedTradeCount: closed.length,
          openPositionCount: openPositions.length,
          profitSol,
          stats: computeTraderStats(closed),
          openPositions: openPositions.slice(0, 3).map((position) => ({
            symbol: position.symbol,
            mint: position.mint,
            amountSol: position.amountSol,
            currentPnlPct: position.currentPnlPct,
          })),
        };
      }),
    );

    traders.sort((a, b) => b.profitSol - a.profitSol);
    return NextResponse.json({ traders });
  } catch (error) {
    console.error("[traders GET]", error);
    return NextResponse.json(
      { error: "Could not load public traders" },
      { status: 500 },
    );
  }
}
