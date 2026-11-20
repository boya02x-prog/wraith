// GET /api/admin/lab (owner only): the paper auto-trader's results per style. See lib/autoLab.ts.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";
import { labReport } from "@/lib/autoLab";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id || !isQuestAdmin(session.user.id, session.user.email)) return NextResponse.json({ isAdmin: false }, { status: 403 });
  return NextResponse.json({ isAdmin: true, ...(await labReport()) }, { headers: { "cache-control": "private, no-store" } });
}
