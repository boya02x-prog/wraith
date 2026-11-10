// Launch control for the admin.
//   GET -> { isAdmin, stored, live }   (stored = what was saved, live = with the auto-launch schedule applied)
//   PUT -> body is a partial LaunchSettings; saved immediately, every server picks it up within ~15s.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";
import { getStoredSettings, saveLaunchSettings } from "@/lib/launchSettingsServer";
import { resolveSettings } from "@/lib/launchSettings";
import { getDb } from "@/lib/mongoClient";

export const dynamic = "force-dynamic";

async function admin(req: NextRequest) {
  const session = await getAppSession(req);
  if (!session?.user?.id) return null;
  return isQuestAdmin(session.user.id, session.user.email) ? session.user : null;
}

async function counts() {
  try {
    const db = await getDb();
    const [users, telegram, questers, pendingBugs] = await Promise.all([
      db.collection("users").estimatedDocumentCount(),
      db.collection("users").countDocuments({ telegramChatId: { $exists: true, $ne: null } }),
      db.collection("quest_profiles").countDocuments({ points: { $gt: 0 } }),
      db.collection("quest_bugs").countDocuments({ status: "pending" }),
    ]);
    return { users, telegram, questers, pendingBugs };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const user = await admin(req);
  if (!user) return NextResponse.json({ isAdmin: false }, { status: 403 });
  const stored = await getStoredSettings(true);
  return NextResponse.json({ isAdmin: true, stored, live: resolveSettings(stored), stats: await counts() });
}

export async function PUT(req: NextRequest) {
  const user = await admin(req);
  if (!user) return NextResponse.json({ ok: false, message: "Not an admin." }, { status: 403 });
  let body: unknown = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, message: "Bad JSON." }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.tiersLive === true && typeof b.omenMint === "string" && b.omenMint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b.omenMint.trim())) {
    return NextResponse.json({ ok: false, message: "That OMEN mint address doesn't look like a Solana address." }, { status: 400 });
  }
  const stored = await saveLaunchSettings(body, String(user.email ?? user.id));
  const warn = stored.tiersLive && !stored.omenMint ? "Tiers are on but no OMEN mint is set, so nobody gets a tier from holdings yet." : null;
  return NextResponse.json({ ok: true, stored, live: resolveSettings(stored), warn });
}
