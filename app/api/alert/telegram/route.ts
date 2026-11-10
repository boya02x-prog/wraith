// POST /api/alert/telegram  (RETIRED)
//
// This route used to let any signed-in browser broadcast a Telegram alert: whatever symbol, contract address, text and image the
// request carried was posted to the public group and to every subscriber, and it also pre-claimed the de-dupe key so the real
// alert for that token was then skipped. Any free account could therefore push a fake "HOT SIGNAL" for a scam token to everyone.
//
// Alerts now come only from the server: /api/cron/tg-alerts runs every minute, builds each message from Wraith's own signal data
// and de-dupes with claim(). The browser callers (scanner, wins panel, sighting recorder) still post here, so the route stays and
// simply acknowledges the request without sending anything.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ ok: true, retired: true });
}
