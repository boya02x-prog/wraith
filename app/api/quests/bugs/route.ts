// Bug reports earn points once the admin approves them.
//   POST  { title, details, page }                 -> anyone signed in, max 5 a day
//   GET   ?status=pending                          -> admin: the review queue
//   PATCH { id, status: "approved"|"rejected", pts } -> admin: decide one report (approved pays the points once)
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { checkLimit, commentLimiter } from "@/lib/ratelimit";
import { QUEST_RULES, award, isQuestAdmin } from "@/lib/quests";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const session = await getAppSession(req);
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sign in first." }, { status: 401 });
  const { success } = await checkLimit(commentLimiter, `bug:${session.user.id}`);
  if (!success) return NextResponse.json({ ok: false, message: "Too many reports. Try later." }, { status: 429 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const title = clean(body.title, 120);
  const details = clean(body.details, 4000);
  const page = clean(body.page, 200);
  if (title.length < 5 || details.length < 20) return NextResponse.json({ ok: false, message: "Add a short title and describe what happened (at least 20 characters)." }, { status: 400 });
  const db = await getDb();
  const since = new Date(Date.now() - 86_400_000);
  if ((await db.collection("quest_bugs").countDocuments({ userId: session.user.id, at: { $gte: since } })) >= 5) {
    return NextResponse.json({ ok: false, message: "5 reports a day max. Thanks for the help!" }, { status: 429 });
  }
  await db.collection("quest_bugs").insertOne({ userId: session.user.id, email: session.user.email, title, details, page, status: "pending", pts: 0, at: new Date() });
  return NextResponse.json({ ok: true, message: "Report sent. Points are added once it's reviewed." });
}

export async function GET(req: NextRequest) {
  const session = await getAppSession(req);
  if (!session?.user?.id || !isQuestAdmin(session.user.id, session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const db = await getDb();
  const rows = await db.collection("quest_bugs").find(status === "all" ? {} : { status }).sort({ at: -1 }).limit(100).toArray();
  return NextResponse.json({ bugs: rows.map((b) => ({ id: String(b._id), userId: b.userId, email: b.email ?? null, title: b.title, details: b.details, page: b.page, status: b.status, pts: b.pts ?? 0, at: b.at })) });
}

export async function PATCH(req: NextRequest) {
  const session = await getAppSession(req);
  if (!session?.user?.id || !isQuestAdmin(session.user.id, session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { id?: unknown; status?: unknown; pts?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const id = typeof body.id === "string" && ObjectId.isValid(body.id) ? new ObjectId(body.id) : null;
  const status = body.status === "approved" || body.status === "rejected" ? body.status : null;
  const pts = Math.max(0, Math.min(QUEST_RULES.bugMaxPoints, Math.round(Number(body.pts) || 0)));
  if (!id || !status) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const db = await getDb();
  const bug = await db.collection("quest_bugs").findOneAndUpdate({ _id: id, status: "pending" }, { $set: { status, pts: status === "approved" ? pts : 0, decidedAt: new Date(), decidedBy: session.user.id } }, { returnDocument: "after" });
  const doc = bug.value;
  if (!doc) return NextResponse.json({ error: "Already decided" }, { status: 409 });
  if (status === "approved" && pts > 0) await award(String(doc.userId), "bug", pts, `bug:${String(id)}`, { title: doc.title });
  return NextResponse.json({ ok: true });
}
