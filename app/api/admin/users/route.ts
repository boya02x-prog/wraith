// GET /api/admin/users (owner only): every account, who is online right now (seen in the last 2 minutes), and how many were active
// in the last hour / day. "Online" comes from the open app's heartbeat (/api/presence), so it also counts people with no Telegram.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";
import { getDb } from "@/lib/mongoClient";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id || !isQuestAdmin(session.user.id, session.user.email)) return NextResponse.json({ isAdmin: false }, { status: 403 });
  const col = (await getDb()).collection("users");
  const now = Date.now();
  const since = (ms: number) => ({ lastSeenAt: { $gte: new Date(now - ms) } });
  const [total, online, hour, day, newDay, rows] = await Promise.all([
    col.estimatedDocumentCount(),
    col.countDocuments(since(2 * 60_000)),
    col.countDocuments(since(3600_000)),
    col.countDocuments(since(86_400_000)),
    col.countDocuments({ createdAt: { $gte: new Date(now - 86_400_000) } }),
    col.find({}, { projection: { name: 1, email: 1, tier: 1, createdAt: 1, lastSeenAt: 1, telegramChatId: 1, walletAddress: 1 } })
      .sort({ lastSeenAt: -1, createdAt: -1 }).limit(300).toArray(),
  ]);
  const t = (d: unknown) => (d instanceof Date ? d.getTime() : null);
  return NextResponse.json({
    isAdmin: true,
    counts: { total, online, hour, day, newDay },
    users: rows.map((u) => ({
      id: String(u._id), name: typeof u.name === "string" ? u.name : null, email: typeof u.email === "string" ? u.email : null,
      tier: typeof u.tier === "string" ? u.tier : null, createdAt: t(u.createdAt), lastSeenAt: t(u.lastSeenAt),
      telegram: !!u.telegramChatId, wallet: typeof u.walletAddress === "string" ? u.walletAddress : null,
    })),
  }, { headers: { "cache-control": "private, no-store" } });
}
