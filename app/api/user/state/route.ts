// Per-account copy of things that used to live only on the phone: the notification bell history and saved tokens.
// Uninstalling the app wipes the phone's storage; this brings them back on the next sign-in.
import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";

export const dynamic = "force-dynamic";

const MAX_BYTES = 400_000;

export async function GET() {
  const session = await getAppSession();
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const doc = await db.collection("user_state").findOne({ _id: id as never }, { projection: { _id: 0 } });
  return NextResponse.json(doc ?? {});
}

export async function PUT(request: Request) {
  const session = await getAppSession();
  const id = session?.user?.id;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (body.notifs && typeof body.notifs === "object") {
    const n = body.notifs as { items?: unknown; seen?: unknown; known?: unknown; base?: unknown };
    set.notifs = {
      items: Array.isArray(n.items) ? n.items.slice(0, 60) : [],
      seen: Number(n.seen) || 0,
      known: Array.isArray(n.known) ? n.known.filter((x) => typeof x === "string").slice(-400) : [],
      base: n.base && typeof n.base === "object" ? n.base : {},
    };
  }
  if (Array.isArray(body.favorites)) set.favorites = body.favorites.slice(0, 200);
  if (JSON.stringify(set).length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const db = await getDb();
  await db.collection("user_state").updateOne({ _id: id as never }, { $set: set }, { upsert: true });
  return NextResponse.json({ ok: true });
}
