// GET /api/admin/me -> { isAdmin }. Lets the menu show the Admin entry to the owner only. It grants nothing by itself:
// every admin page and API checks the account again on the server.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  const isAdmin = !!session?.user?.id && isQuestAdmin(session.user.id, session.user.email);
  return NextResponse.json({ isAdmin }, { headers: { "cache-control": "private, no-store" } });
}
