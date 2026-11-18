// POST /api/presence: "this signed-in user has the app open right now". Called about once a minute by the open app; it only records the
// time on the user's own account, which the admin page turns into "online now" and "last seen".
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    await (await getDb()).collection("users").updateOne({ _id: new ObjectId(session.user.id) }, { $set: { lastSeenAt: new Date() } });
  } catch { /* a missed beat only makes someone look offline for a minute */ }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
