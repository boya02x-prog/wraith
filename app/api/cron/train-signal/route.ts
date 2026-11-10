// GET /api/cron/train-signal  (daily, see vercel.json)
// Retrains the signal model from every finished call. Boosted trees plus walk-forward testing take tens of seconds, so this
// runs as its own scheduled job instead of inside a page request.
// Auth: Vercel cron sends "Authorization: Bearer $CRON_SECRET"; a manual run can use ?key=$CRON_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { learningSnapshot, retrainIfDue } from "@/lib/signalLearning";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") return NextResponse.json({ error: "Set CRON_SECRET to run this job" }, { status: 403 });
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const t0 = Date.now();
  await retrainIfDue(true);
  const snap = await learningSnapshot();
  return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - t0) / 100) / 10, model: snap.model ? { n: snap.model.n, active: snap.model.active, holdout: snap.model.holdout } : null });
}
