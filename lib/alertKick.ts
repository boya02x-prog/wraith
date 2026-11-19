// lib/alertKick.ts  (server only)
// The phone and Telegram alerts are sent by /api/cron/tg-alerts, which an outside pinger (cron-job.org) calls every minute. If that pinger is ever
// switched off, no alert goes out until it is fixed. So whenever anybody's open app asks for the scanner board, this wakes the same job up (at most
// once every two minutes per server; the job has its own database check, so it never runs twice in a row). The pinger is still the main trigger.
let lastKick = 0;

export async function kickAlerts(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || Date.now() - lastKick < 120_000) return;
  lastKick = Date.now();
  try {
    await fetch(`${origin}/api/cron/tg-alerts`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8_000) });
  } catch { /* the job is only a convenience trigger here: nothing to do if it cannot be reached */ }
}
