import { NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";

type Trade = {
  id?: string;
  symbol?: string;
  mint?: string;
  amountSol?: number;
  entryMcap?: number;
  exitMcap?: number;
  pnlPct?: number;
  imageUrl?: string;
  ts?: number;
  status?: string;
};

type Position = Omit<Trade, "exitMcap"> & {
  currentMcap?: number;
  currentPnlPct?: number;
  status?: string;
};

export async function GET() {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in to load your FYP." }, { status: 401 });

  try {
    const db = await getDb();
    const follows = await db.collection("trader_follows")
      .find({ followerId: userId }, { projection: { _id: 0, traderId: 1 } })
      .limit(250)
      .toArray();
    const ids = follows.map((follow) => follow.traderId).filter((id): id is string => typeof id === "string");
    if (!ids.length) return NextResponse.json({ callouts: [] });

    const profiles = await db.collection("profiles")
      .find({ userId: { $in: ids }, publicTrading: true }, { projection: { _id: 0, userId: 1, displayName: 1, avatarDataUrl: 1, avatarUrl: 1 } })
      .toArray();
    const callouts = (await Promise.all(profiles.map(async (profile) => {
      const [tradeDoc, positionDoc] = await Promise.all([
        db.collection("trades").findOne({ userId: profile.userId }, { projection: { _id: 0, trades: 1 } }),
        db.collection("positions").findOne({ userId: profile.userId }, { projection: { _id: 0, positions: 1 } }),
      ]);
      const trades: Trade[] = Array.isArray(tradeDoc?.trades) ? tradeDoc.trades : [];
      const positions: Position[] = Array.isArray(positionDoc?.positions) ? positionDoc.positions : [];
      const shared = { traderId: profile.userId, traderName: profile.displayName || "Wraith trader", avatarDataUrl: profile.avatarDataUrl || profile.avatarUrl || "" };
      return [
        ...positions.filter((position) => position.status === "watching").map((position) => ({ ...shared, type: "open" as const, ...position })),
        ...trades.filter((trade) => typeof trade.pnlPct === "number" && trade.status !== "failed").map((trade) => ({ ...shared, type: "closed" as const, ...trade })),
      ];
    }))).flat()
      .filter((item) => typeof item.mint === "string" && item.mint.length > 0)
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      .slice(0, 80);

    return NextResponse.json({ callouts });
  } catch (error) {
    console.error("[traders feed GET]", error);
    return NextResponse.json({ error: "Could not load followed trader activity." }, { status: 500 });
  }
}
