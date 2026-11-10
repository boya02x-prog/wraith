// GET /api/cron/refresh-calls: re-prices every tracked call that is due (young calls almost every run, older ones less often).
// Cheap: DexScreener batches plus a few database writes. No scanner build, no Telegram, no push.
// Why it exists: the learning model trains on each call's peak and last price. Those are only as good as how often calls are priced.
// Measured on the live database, the median tracked call went 5+ hours between prices, so quick pumps were missed and real winners
// were stored as non-winners. Ping this URL every minute and labels get dense. Vercel's free plan only runs daily crons, so use a
// free external pinger (cron-job.org): GET https://www.wraith.farm/api/cron/refresh-calls?key=<CRON_SECRET>
import { NextRequest, NextResponse } from "next/server";
import { refreshCalls } from "@/lib/signalCalls";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const t0 = Date.now();
  let passes = 0;
  // up to three passes inside one request while there is time: each pass takes the 270 calls most overdue
  while (passes < 3 && Date.now() - t0 < 35_000) {
    await refreshCalls(true).catch(() => undefined);
    passes++;
  }
  return NextResponse.json({ ok: true, passes, ms: Date.now() - t0 });
}
