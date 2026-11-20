// /api/admin/auto-access (owner only): the list of people who can see the Auto-trader.
//   GET -> { people: [{ email, addedAt }] }   POST { email } -> adds one   DELETE ?email=... -> removes one
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";
import { addAccess, listAccess, normEmail, removeAccess } from "@/lib/autoAccess";

export const dynamic = "force-dynamic";

async function owner(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id || !isQuestAdmin(session.user.id, session.user.email)) return null;
  return session.user;
}

export async function GET(req: NextRequest) {
  if (!(await owner(req))) return NextResponse.json({ isAdmin: false }, { status: 403 });
  return NextResponse.json({ isAdmin: true, people: await listAccess() }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const user = await owner(req);
  if (!user) return NextResponse.json({ ok: false, message: "Not the owner." }, { status: 403 });
  let body: { email?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 }); }
  const r = await addAccess(String(body.email ?? ""), String(user.email ?? user.id));
  return NextResponse.json(r.ok ? { ok: true, people: await listAccess() } : r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: NextRequest) {
  if (!(await owner(req))) return NextResponse.json({ ok: false, message: "Not the owner." }, { status: 403 });
  const email = normEmail(req.nextUrl.searchParams.get("email"));
  if (!email) return NextResponse.json({ ok: false, message: "No email given." }, { status: 400 });
  await removeAccess(email);
  return NextResponse.json({ ok: true, people: await listAccess() });
}
