// POST /api/push/fcm   → link this phone's Firebase token to the signed-in user.
//                        With { verify: true } it only checks that the server still has THIS phone for THIS account.
// GET  /api/push/fcm   → { linked, signedIn } whether this user has a native push device.
// DELETE /api/push/fcm → unlink (turn native push off).
import { NextRequest, NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";
import type { PushSub } from "@/lib/push";
import { MAX_PUSH_DEVICES } from "@/lib/pushEndpoint";
import { checkLimit, pushSubscribeLimiter } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_RE = /^[A-Za-z0-9:_\-]{50,600}$/;

async function userId() {
  const session = await getPrivySession();
  return session?.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rl = await checkLimit(pushSubscribeLimiter, uid);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  let body: { token?: string; verify?: boolean; prefs?: Record<string, unknown>; saved?: { mint?: string; symbol?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const token = String(body.token ?? "");
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  const db = await getDb();
  const col = db.collection<PushSub>("push_subs");
  if (body.verify === true) {
    // The server forgets a phone whose token went stale, and a phone that another account signed in on belongs to that account.
    const n = await col.countDocuments({ _id: `fcm:${token}`, userId: uid });
    return NextResponse.json({ ok: true, thisPhone: n > 0 });
  }
  const p = body.prefs ?? {};
  const prefs = { trader: p.trader !== false, callout: p.callout !== false, saved: p.saved !== false, signal: p.signal !== false };
  const saved = (Array.isArray(body.saved) ? body.saved : [])
    .filter((s): s is { mint: string; symbol: string } => typeof s?.mint === "string" && MINT_RE.test(s.mint))
    .slice(0, 60)
    .map((s) => ({ mint: s.mint, symbol: String(s.symbol ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "TOKEN" }));
  const known = await col.findOne({ _id: `fcm:${token}` }, { projection: { userId: 1 } });
  if (!known && (await col.countDocuments({ userId: uid })) >= MAX_PUSH_DEVICES) {
    return NextResponse.json({ error: "Too many devices on this account. Remove one first." }, { status: 400 });
  }
  await col.updateOne(
    { _id: `fcm:${token}` },
    {
      $set: { userId: uid, fcm: true, p256dh: "", auth: "", prefs, saved },
      $setOnInsert: { cursor: Date.now(), base: {}, createdAt: Date.now() },
    },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const uid = await userId();
  if (!uid) return NextResponse.json({ linked: false, signedIn: false });
  const db = await getDb();
  const n = await db.collection<PushSub>("push_subs").countDocuments({ userId: uid, fcm: true });
  return NextResponse.json({ linked: n > 0, signedIn: true });
}

export async function DELETE() {
  const uid = await userId();
  if (!uid) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const db = await getDb();
  await db.collection<PushSub>("push_subs").deleteMany({ userId: uid, fcm: true });
  return NextResponse.json({ ok: true });
}
