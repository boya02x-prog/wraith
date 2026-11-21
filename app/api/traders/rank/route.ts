// GET /api/traders/rank?period=d1|d7|d30|all : where the signed-in person stands among everyone who has traded on Wraith, by profit in that period.
// The ranking cards only list people who switched on "Share my trading activity", but a rank is only a number, so it is counted over everybody who has
// closed a trade without showing anyone else's figures. Only your own numbers come back. Refreshed from the database every two minutes for everyone.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { computeTraderStats } from "@/lib/traderStats";

export const dynamic = "force-dynamic";

type Period = "d1" | "d7" | "d30" | "all";
const PERIODS: Period[] = ["d1", "d7", "d30", "all"];
type StoredTrade = { amountSol?: number; pnlPct?: number; ts?: number; closedAt?: number };

let cache: { at: number; gains: Record<Period, number[]>; users: number } | null = null;
const TTL_MS = 120_000;

/** Everyone's profit for each period, best first (their ids are never kept). */
async function board() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const db = await getDb();
  const docs = await db.collection("trades").find({}, { projection: { _id: 0, trades: 1 } }).limit(5000).toArray();
  const gains: Record<Period, number[]> = { d1: [], d7: [], d30: [], all: [] };
  let users = 0;
  for (const d of docs) {
    const closed = (Array.isArray(d.trades) ? (d.trades as StoredTrade[]) : []).filter((t) => typeof t.pnlPct === "number" && typeof t.amountSol === "number");
    if (!closed.length) continue;
    users++;
    const s = computeTraderStats(closed);
    for (const p of PERIODS) gains[p].push(s.pnlSol[p]);
  }
  for (const p of PERIODS) gains[p].sort((a, b) => b - a);
  cache = { at: Date.now(), gains, users };
  return cache;
}

export async function GET(req: NextRequest) {
  const session = await getPrivySession().catch(() => null);
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "Sign in to see your rank." }, { status: 401 });
  const raw = req.nextUrl.searchParams.get("period") ?? "d7";
  const period = (PERIODS as string[]).includes(raw) ? (raw as Period) : "d7";
  try {
    const db = await getDb();
    const [b, mine, profile] = await Promise.all([
      board(),
      db.collection("trades").findOne({ userId: id }, { projection: { _id: 0, trades: 1 } }),
      db.collection("profiles").findOne({ userId: id }, { projection: { _id: 0, publicTrading: 1 } }),
    ]);
    const closed = (Array.isArray(mine?.trades) ? (mine!.trades as StoredTrade[]) : []).filter((t) => typeof t.pnlPct === "number" && typeof t.amountSol === "number");
    const publicTrading = profile?.publicTrading === true;
    if (!closed.length) return NextResponse.json({ rank: null, of: b.users, pnlSol: 0, closed: 0, winRate: null, bestPct: 0, topPct: null, publicTrading }, { headers: { "Cache-Control": "private, max-age=60" } });
    const s = computeTraderStats(closed);
    const gain = s.pnlSol[period];
    const list = b.gains[period];
    // the rank is 1 + the number of people who made MORE than you in this period (ties share a place)
    let ahead = 0;
    while (ahead < list.length && list[ahead] > gain + 1e-12) ahead++;
    const of = Math.max(b.users, ahead + 1);
    const rank = ahead + 1;
    return NextResponse.json(
      { rank, of, pnlSol: gain, closed: s.closed, winRate: s.winRate, bestPct: s.bestPct, topPct: of >= 5 ? Math.max(1, Math.round((rank / of) * 100)) : null, publicTrading },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (e) {
    console.error("[traders rank GET]", e);
    return NextResponse.json({ error: "Could not work out your rank." }, { status: 500 });
  }
}
