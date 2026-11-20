// GET /api/auto-trader: may this signed-in person see the Auto-trader? With ?report=1 and permission, also the paper lab's results.
// Permission = the owner, or an email the owner added in the admin page (see lib/autoAccess.ts). Everyone else gets { allowed: false }.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isAutoAllowed } from "@/lib/autoAccess";
import { labReport } from "@/lib/autoLab";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id) return NextResponse.json({ allowed: false }, { status: 401 });
  const allowed = await isAutoAllowed(session.user.id, session.user.email);
  if (!allowed) return NextResponse.json({ allowed: false }, { headers: { "cache-control": "private, no-store" } });
  const body = req.nextUrl.searchParams.get("report") === "1" ? { allowed: true, ...(await labReport()) } : { allowed: true };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
}
