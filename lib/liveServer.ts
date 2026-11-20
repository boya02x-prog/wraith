// lib/liveServer.ts  (server only)
// Is this the real, deployed Wraith, and not a developer's own computer or a preview copy?
// Background jobs that share the database with the live site (the alert job: Telegram, phone pushes, the paper lab) must only run there.
// A dev server on a laptop talks to the same database but does not have the phone-push key, so when an open localhost tab woke the job up
// (lib/alertKick.ts), that server grabbed the shared "ran recently" slot, pushed to the browser instead of the phone, and the live site's
// own runs were skipped for hours: the bell showed a new call and the phone never rang.
export function isLiveServer(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}
