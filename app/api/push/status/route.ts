// GET /api/push/status → which of this user's phones the server can reach (never the tokens or keys themselves).
import { NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { pushStatus } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json(await pushStatus(userId));
  } catch (e) {
    console.error("[push status]", e);
    return NextResponse.json({ error: "Could not read push status." }, { status: 500 });
  }
}
