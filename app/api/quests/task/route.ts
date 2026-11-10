// POST /api/quests/task  { task: "tg_join" | "x_link" | "x_post", url? }
// Every task here is checked on the server. X follows are not rewarded: X only exposes follow checks on its paid API.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { checkLimit, reactLimiter } from "@/lib/ratelimit";
import { checkTelegram, checkXLink, checkXPost } from "@/lib/quests";

export async function POST(req: NextRequest) {
  const session = await getAppSession(req);
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sign in first." }, { status: 401 });
  const { success } = await checkLimit(reactLimiter, `quest:${session.user.id}`);
  if (!success) return NextResponse.json({ ok: false, message: "Slow down a little." }, { status: 429 });
  if (!(await getLaunchSettings()).questsOpen) return NextResponse.json({ ok: false, message: "Quests are paused." });
  let body: { task?: unknown; url?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const userId = session.user.id;
  try {
    switch (body.task) {
      case "tg_join": return NextResponse.json(await checkTelegram(userId));
      case "x_link": return NextResponse.json(await checkXLink(userId));
      case "x_post": return NextResponse.json(await checkXPost(userId, typeof body.url === "string" ? body.url.slice(0, 300) : ""));
      default: return NextResponse.json({ ok: false, message: "Unknown task." }, { status: 400 });
    }
  } catch (e) {
    console.error("[quests task]", e);
    return NextResponse.json({ ok: false, message: "Something went wrong. Try again." }, { status: 500 });
  }
}
