// /api/user/lock: the account's app-lock PIN (salted hash only, never the PIN) so the same PIN works on the phone app and on desktop.
// The fingerprint / face credential stays per device (it lives in that device's secure hardware and cannot be moved).
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HASH_RE = /^[0-9a-f]{64}$/;
const SALT_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TIMEOUTS = new Set([0, 60_000, 300_000, 900_000, 1_800_000, 3_600_000]);

export async function GET() {
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const p = await (await getDb()).collection("profiles").findOne({ userId: session.user.id }, { projection: { _id: 0, lockPin: 1 } });
    const l = p?.lockPin as { hash?: string; salt?: string; timeoutMs?: number } | undefined;
    if (!l?.hash || !l?.salt) return NextResponse.json({ pin: null });
    return NextResponse.json({ pin: { hash: l.hash, salt: l.salt, timeoutMs: typeof l.timeoutMs === "number" ? l.timeoutMs : 300_000 } });
  } catch (error) {
    console.error("[user lock GET]", error);
    return NextResponse.json({ error: "Could not load the lock settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { hash?: unknown; salt?: unknown; timeoutMs?: unknown } | null;
  const timeoutMs = typeof body?.timeoutMs === "number" && TIMEOUTS.has(body.timeoutMs) ? body.timeoutMs : 300_000;
  try {
    const profiles = (await getDb()).collection("profiles");
    if (typeof body?.hash === "string" && typeof body?.salt === "string") {
      if (!HASH_RE.test(body.hash) || !SALT_RE.test(body.salt)) return NextResponse.json({ error: "Invalid lock data" }, { status: 400 });
      await profiles.updateOne(
        { userId: session.user.id },
        { $set: { userId: session.user.id, lockPin: { hash: body.hash, salt: body.salt, timeoutMs, updatedAt: new Date() } } },
        { upsert: true },
      );
    } else {
      // timeout-only change
      await profiles.updateOne({ userId: session.user.id, "lockPin.hash": { $exists: true } }, { $set: { "lockPin.timeoutMs": timeoutMs } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[user lock PUT]", error);
    return NextResponse.json({ error: "Could not save the lock settings" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await (await getDb()).collection("profiles").updateOne({ userId: session.user.id }, { $unset: { lockPin: "" } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[user lock DELETE]", error);
    return NextResponse.json({ error: "Could not clear the lock settings" }, { status: 500 });
  }
}
