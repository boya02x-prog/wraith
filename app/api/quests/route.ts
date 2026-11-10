// GET /api/quests: everything the Quests page and the profile card need for the signed-in user.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import {
  QUEST_RULES, TASKS, TG_CHANNEL_URL, X_HANDLE,
  attachReferrer, getQuestProfile, isQuestAdmin, leaderboard, rankOf, recentActivity, totalPoints,
} from "@/lib/quests";
import { getDb } from "@/lib/mongoClient";
import { getLaunchSettings } from "@/lib/launchSettingsServer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req);
  const board = await leaderboard(25).catch(() => []);
  const total = await totalPoints().catch(() => 0);
  const launch = await getLaunchSettings();
  const base = {
    rules: QUEST_RULES,
    channelUrl: TG_CHANNEL_URL,
    xHandle: X_HANDLE,
    airdropFinal: launch.claimOpen,
    questsOpen: launch.questsOpen,
    claimAt: launch.claimAt,
    totalPoints: total,
    leaderboard: board,
  };
  if (!session?.user?.id) return NextResponse.json({ ...base, signedIn: false });

  const userId = session.user.id;
  try {
    await attachReferrer(userId, req.cookies.get("wr_ref")?.value);
    const me = await getQuestProfile(userId);
    const [rank, activity, bugs] = await Promise.all([
      me.points > 0 ? rankOf(me.points) : Promise.resolve(null),
      recentActivity(userId, 20),
      (await getDb()).collection("quest_bugs").find({ userId }, { projection: { _id: 1, title: 1, status: 1, pts: 1, at: 1 } }).sort({ at: -1 }).limit(20).toArray(),
    ]);
    const share = total > 0 ? me.points / total : 0;
    return NextResponse.json({
      ...base,
      signedIn: true,
      isAdmin: isQuestAdmin(userId, session.user.email),
      me: {
        points: me.points,
        rank,
        refCode: me.refCode,
        refCount: me.refCount,
        refActive: me.refActive,
        invitedBy: !!me.referredBy,
        estimatedTokens: Math.floor(share * QUEST_RULES.airdropTokens),
        sharePct: share * 100,
        canPostToday: !me.lastXPostAt || Date.now() - me.lastXPostAt >= 20 * 3600_000,
      },
      tasks: TASKS.map((t) => ({ ...t, doneAt: me.tasks[t.id] ?? null })),
      activity: activity.map((a) => ({ kind: a.kind, pts: a.pts, at: a.at, meta: a.meta ?? {} })),
      bugs: bugs.map((b) => ({ id: String(b._id), title: b.title, status: b.status, pts: b.pts ?? 0, at: b.at })),
    });
  } catch (e) {
    console.error("[quests GET]", e);
    return NextResponse.json({ ...base, signedIn: true, error: "Couldn't load your quests right now." }, { status: 500 });
  }
}
