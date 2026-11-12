// Invite codes for accounts that did not come through a link (or whose link was lost, e.g. it opened in a browser, not in the app).
//   GET  -> { eligible }  after crediting any code remembered from an invite link. Called once after sign-in.
//   POST -> { code }      a code typed in by hand -> { ok, message }
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { attachReferrer, canEnterReferralCode, redeemReferralCode } from "@/lib/quests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id) return NextResponse.json({ eligible: false }, { status: 401 });
  try {
    await attachReferrer(session.user.id, req.cookies.get("wr_ref")?.value);
    return NextResponse.json({ eligible: await canEnterReferralCode(session.user.id) });
  } catch {
    return NextResponse.json({ eligible: false });
  }
}

export async function POST(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id) return NextResponse.json({ ok: false, message: "Sign in first." }, { status: 401 });
  let code: unknown = "";
  try { code = ((await req.json()) as { code?: unknown }).code; } catch { /* handled below */ }
  if (typeof code !== "string") return NextResponse.json({ ok: false, message: "Type your invite code first." }, { status: 400 });
  try {
    return NextResponse.json(await redeemReferralCode(session.user.id, code, true));
  } catch (e) {
    console.error("[referral POST]", e);
    return NextResponse.json({ ok: false, message: "Could not check the code right now. Try again." }, { status: 500 });
  }
}
