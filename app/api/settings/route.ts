// GET /api/settings: public launch-control state (beta switch, tiers, dates, roadmap). Nothing secret in it.
import { NextResponse } from "next/server";
import { getLaunchSettings } from "@/lib/launchSettingsServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getLaunchSettings();
  const { updatedBy: _by, ...pub } = s;
  void _by;
  return NextResponse.json(pub, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
}
