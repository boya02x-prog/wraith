// POST /api/push/subscribe  → save (or update) this device's push subscription, prefs and saved tokens.
// DELETE /api/push/subscribe → remove it.
import { NextRequest, NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";
import type { PushSub } from "@/lib/push";
import { isPushEndpoint, MAX_PUSH_DEVICES } from "@/lib/pushEndpoint";
import { checkLimit, pushSubscribeLimiter } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: NextRequest) {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rl = await checkLimit(pushSubscribeLimiter, userId);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; prefs?: Record<string, unknown>; saved?: { mint?: string; symbol?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !isPushEndpoint(sub.endpoint) || sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  const p = body.prefs ?? {};
  const prefs = { trader: p.trader !== false, callout: p.callout !== false, saved: p.saved !== false, signal: p.signal !== false };
  const saved = (Array.isArray(body.saved) ? body.saved : [])
    .filter((s): s is { mint: string; symbol: string } => typeof s?.mint === "string" && MINT_RE.test(s.mint))
    .slice(0, 60)
    .map((s) => ({ mint: s.mint, symbol: String(s.symbol ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "TOKEN" }));
  const db = await getDb();
  // one account cannot register an unlimited number of devices (every row is a send on each alert run)
  const col = db.collection<PushSub>("push_subs");
  const known = await col.findOne({ _id: sub.endpoint }, { projection: { userId: 1 } });
  if (!known && (await col.countDocuments({ userId })) >= MAX_PUSH_DEVICES) {
    return NextResponse.json({ error: "Too many devices on this account. Remove one first." }, { status: 400 });
  }
  await col.updateOne(
    { _id: sub.endpoint },
    {
      $set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, prefs, saved },
      $setOnInsert: { cursor: Date.now(), base: {}, createdAt: Date.now() },
    },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getPrivySession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let endpoint = "";
  try { endpoint = String(((await req.json()) as { endpoint?: string }).endpoint ?? ""); } catch { /* none */ }
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  const db = await getDb();
  await db.collection<PushSub>("push_subs").deleteOne({ _id: endpoint, userId });
  return NextResponse.json({ ok: true });
}
