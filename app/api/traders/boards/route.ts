import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";

// The two extra leaderboards on the Traders page: who has the most followers, and who has earned the most (all-time realized profit).
// Only people who turned on "Share my trading activity" appear, the same rule as everywhere else. A wallet's balance is not public in Wraith
// (balances live on-chain in private wallets), so "richest" is measured by what a trader has made, which is public.
type Row = {
  userId: string;
  username: string | null;
  displayName: string;
  avatarDataUrl: string;
  frame: string;
  followers?: number;
  profitSol?: number;
  trades?: number;
};

const SHOW = 10;
let cache: { at: number; followed: Row[]; earners: Row[] } | null = null;
const TTL_MS = 60_000;

const PROFILE_FIELDS = { _id: 0, userId: 1, username: 1, displayName: 1, avatarDataUrl: 1, avatarUrl: 1, frame: 1 } as const;
type P = { userId: string; username?: string | null; displayName?: string; avatarDataUrl?: string; avatarUrl?: string; frame?: string };
const toRow = (p: P): Row => ({
  userId: p.userId,
  username: p.username ?? null,
  displayName: p.displayName || "Wraith trader",
  avatarDataUrl: p.avatarDataUrl || p.avatarUrl || "",
  frame: p.frame || "none",
});

async function build() {
  const db = await getDb();

  // most followed: count the follows per trader, then keep the public profiles in that order
  const counts = await db
    .collection("trader_follows")
    .aggregate([{ $group: { _id: "$traderId", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 80 }])
    .toArray();
  const countOf = new Map(counts.map((c) => [c._id as string, c.count as number]));
  const followedProfiles = counts.length
    ? ((await db.collection("profiles").find({ userId: { $in: [...countOf.keys()] }, publicTrading: true }, { projection: PROFILE_FIELDS }).toArray()) as unknown as P[])
    : [];
  const followed: Row[] = followedProfiles
    .map((p) => ({ ...toRow(p), followers: countOf.get(p.userId) ?? 0 }))
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
    .slice(0, SHOW);

  // top earners: realized profit of the most recently active public profiles (same formula as the ranking: size x result)
  const pubs = (await db
    .collection("profiles")
    .find({ publicTrading: true }, { projection: PROFILE_FIELDS })
    .sort({ updatedAt: -1 })
    .limit(300)
    .toArray()) as unknown as P[];
  const tradeDocs = pubs.length
    ? await db.collection("trades").find({ userId: { $in: pubs.map((p) => p.userId) } }, { projection: { _id: 0, userId: 1, trades: 1 } }).toArray()
    : [];
  const stat = new Map<string, { profit: number; n: number }>();
  for (const d of tradeDocs) {
    const list: { amountSol?: number; pnlPct?: number }[] = Array.isArray(d.trades) ? d.trades : [];
    let profit = 0;
    let n = 0;
    for (const t of list) {
      if (typeof t.pnlPct === "number" && typeof t.amountSol === "number") { profit += t.amountSol * (t.pnlPct / 100); n++; }
    }
    stat.set(d.userId as string, { profit, n });
  }
  const earners: Row[] = pubs
    .map((p) => ({ ...toRow(p), profitSol: stat.get(p.userId)?.profit ?? 0, trades: stat.get(p.userId)?.n ?? 0 }))
    .filter((r) => (r.profitSol ?? 0) > 0)
    .sort((a, b) => (b.profitSol ?? 0) - (a.profitSol ?? 0))
    .slice(0, SHOW);

  return { followed, earners };
}

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      const fresh = await build();
      cache = { at: Date.now(), ...fresh };
    }
    // whether the viewer already follows each person (for the Follow buttons); not cached because it is per person
    const session = await getPrivySession().catch(() => null);
    let mine = new Set<string>();
    if (session?.user?.id) {
      const db = await getDb();
      const ids = [...cache.followed, ...cache.earners].map((r) => r.userId);
      const follows = await db.collection("trader_follows").find({ followerId: session.user.id, traderId: { $in: ids } }, { projection: { _id: 0, traderId: 1 } }).toArray();
      mine = new Set(follows.map((f) => f.traderId as string));
    }
    const mark = (r: Row) => ({ ...r, isFollowing: session?.user?.id ? mine.has(r.userId) : undefined, isSelf: session?.user?.id === r.userId });
    return NextResponse.json({ followed: cache.followed.map(mark), earners: cache.earners.map(mark) });
  } catch (error) {
    console.error("[traders boards GET]", error);
    return NextResponse.json({ error: "Could not load the boards" }, { status: 500 });
  }
}
