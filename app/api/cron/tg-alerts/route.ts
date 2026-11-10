// GET /api/cron/tg-alerts  (every minute)
// Server-side alerts so Telegram and phone notifications work while you're away from the PC:
//   1. new HOT/WATCH signals  2. win milestones (2x, 3x, 5x, 10x…) on every tracked call.
// Auth: Vercel cron sends "Authorization: Bearer $CRON_SECRET"; external cron can use ?key=$CRON_SECRET.
// Free option if your host only runs daily crons: ping this URL every minute from cron-job.org.
import { NextRequest, NextResponse } from "next/server";
import { callGet } from "@/lib/internalCall";
import { getDb } from "@/lib/mongoClient";
import { refreshCalls, type SignalCall } from "@/lib/signalCalls";
import type { Signal } from "@/app/api/signals/route";
import { broadcast, claim, milestoneFor, signalMessage, winMessage, winTeaser } from "@/lib/telegramBot";
import { tokenKeyboard } from "@/lib/telegramUi";
import { runPushAlerts, pushBroadcast } from "@/lib/push";
import { signQuery } from "@/lib/signedUrl";
import { sweepGroupMembers } from "@/lib/telegramGate";

export const maxDuration = 60;

function bannerUrl(origin: string, q: Record<string, string | number | undefined>) {
  const u = new URL("/api/banner", origin);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
  u.searchParams.set("sig", signQuery(u.searchParams)); // /api/banner refuses unsigned or edited URLs
  return u.toString();
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") console.warn("[cron] CRON_SECRET is not set: this endpoint is publicly callable");
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || req.nextUrl.searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (req.nextUrl.searchParams.get("grouptest") === "1") {
    // manual test posts go to the public group, so they always need the secret, even if the normal run is left open
    if (!secret) return NextResponse.json({ error: "Set CRON_SECRET to use the test mode" }, { status: 403 });
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const gid = process.env.TELEGRAM_GROUP_CHAT_ID;
    const thread = Number(process.env.TELEGRAM_GROUP_THREAD_ID);
    if (!token || !gid) return NextResponse.json({ ok: false, error: "missing env", hasToken: !!token, hasGroupId: !!gid, signals: process.env.TELEGRAM_GROUP_SIGNALS });
    const demo = req.nextUrl.searchParams.get("demo") === "1";
    const text = demo
      ? "🧪 <b>TEST — HOT SIGNAL</b>  $DEMO\n💰 <b>MCap</b>  $48.2K    💧 <b>Liq</b>  $12.4K\n🟩 <b>1h</b>  +38.1%    📊 <b>Vol 1h</b>  $31.5K\n📈 <b>Score</b>  82/100\n\nThis is how Wraith calls and wins show up here."
      : "Wraith group feed test";
    if (demo) await pushBroadcast({ title: "🧪 Wraith test alert", body: "$DEMO spotted at $48.2K · score 82", url: "/app", tag: "demo" }, "signal").catch(() => 0);
    const body: Record<string, unknown> = { chat_id: gid, text, parse_mode: "HTML" };
    if (Number.isFinite(thread) && thread > 0) body.message_thread_id = thread;
    if (req.nextUrl.searchParams.get("banner") === "1") {
      // photo test: Telegram downloads the banner itself, so this proves the public route + image work end to end
      const photo = bannerUrl(req.nextUrl.origin, { kind: "win", sym: "DEMO", x: 3.51, called: 13000, now: 45500, peak: 45500, chain: "solana" });
      const pb: Record<string, unknown> = { chat_id: gid, photo, caption: "🧪 <b>TEST — WRAITH WIN · 3x</b>  $DEMO\nBanner check", parse_mode: "HTML" };
      if (body.message_thread_id) pb.message_thread_id = body.message_thread_id;
      const pr = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pb) });
      return NextResponse.json({ photo, telegram: await pr.json() });
    }
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return NextResponse.json({ gid, thread, signals: process.env.TELEGRAM_GROUP_SIGNALS, telegram: await r.json() });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    // No Telegram bot configured: phone push notifications still run.
    const push = await runPushAlerts().catch((e) => { console.error("[push alerts]", e); return null; });
    if (push) console.log("[push]", JSON.stringify(push));
    return NextResponse.json({ ok: true, telegram: false, push });
  }

  const db = await getDb();
  const state = db.collection<{ _id: string; at: Date }>("tg_state");
  // First ever run: mark everything that already exists as "seen" so nobody gets a flood of old alerts.
  const first = !(await state.findOne({ _id: "cron" }));
  await state.updateOne({ _id: "cron" }, { $set: { at: new Date() } }, { upsert: true });

  let signals: Signal[] = [];
  try {
    // in-process: fetching our own /api/signals over HTTP has no session cookie, so the sign-in gate answered 401 and no
    // fresh-call alert could ever match the feed
    signals = (await callGet<{ signals?: Signal[] }>(() => import("@/app/api/signals/route"), `${req.nextUrl.origin}/api/signals`, 40_000)).signals ?? [];
  } catch { /* feed down: still do wins */ }
  await refreshCalls(true).catch(() => undefined);

  // Phone push starts here, right after the calls are refreshed and in parallel with the Telegram sends below, so a slow or
  // failing Telegram step can never keep an alert from reaching a phone.
  const pushRun = runPushAlerts().catch((e) => { console.error("[push alerts]", e); return null; });

  const out = { entries: 0, wins: 0, sent: 0 };
  let tgError: unknown = null;
  try {
    const calls = db.collection<SignalCall>("signal_calls");

    // 1) fresh calls (spotted in the last 20 min)
    const fresh = await calls.find({ spottedAt: { $gt: Date.now() - 20 * 60_000 }, shadow: { $ne: true }, engine: 2 }).toArray();
    const feed = new Map(signals.map((s) => [s.token.address, s]));
    for (const c of fresh) {
      const sig = feed.get(c.address);
      if (!first && !sig) continue; // feed missed it this run: don't burn the claim, retry next run
      if (!(await claim(`entry:${c.address}`))) continue;
      if (first || !sig) continue;
      const r = await broadcast("signal", signalMessage(sig), { chain: c.chain ?? "solana", score: sig.score, markup: tokenKeyboard(c.address, c.chain ?? "solana"), imageUrl: bannerUrl(req.nextUrl.origin, { kind: "signal", sym: sig.token.symbol, now: sig.token.mcap, score: sig.score, tier: sig.tier, chain: c.chain ?? "solana", liq: sig.token.liquidity, h1: sig.token.change.h1 ?? undefined, vol: sig.token.volume.h1, img: sig.token.imageUrl }) });
      out.entries++; out.sent += r.sent;
    }

    // 2) win milestones across the last 7 days
    const tracked = (await calls.find({ spottedAt: { $gt: Date.now() - 7 * 86_400_000 }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2, badData: { $ne: true } }).toArray()).filter((c) => c.lastMcap / c.spottedMcap < 100);
    for (const c of tracked) {
      const m = milestoneFor(c.lastMcap / c.spottedMcap);
      if (!m) continue;
      if (!(await claim(`win:${c.address}:${m}`))) continue;
      if (first) continue;
      const r = await broadcast("win", winMessage(c, m), { teaser: winTeaser(c, m), chain: c.chain ?? "solana", markup: tokenKeyboard(c.address, c.chain ?? "solana"), imageUrl: bannerUrl(req.nextUrl.origin, { kind: "win", sym: c.symbol, x: c.lastMcap / c.spottedMcap, called: c.spottedMcap, now: c.lastMcap, peak: c.peakMcap, chain: c.chain ?? "solana" }) });
      out.wins++; out.sent += r.sent;
      await pushBroadcast({ title: `🏆 ${m}x $${c.symbol}`, body: `${(c.lastMcap / c.spottedMcap).toFixed(2)}x from the call`, url: `/app/token/${c.address}`, tag: `w:${c.address}:${m}` }, "signal").catch(() => 0);
    }
  } catch (e) {
    tgError = e;
    console.error("[tg alerts]", e);
  }

  const push = await pushRun;
  if (push) console.log("[push]", JSON.stringify(push));
  // hourly: drop holders-room members who no longer hold the tier (it throttles itself)
  const sweep = await sweepGroupMembers().catch((e) => { console.error("[holders room sweep]", e); return null; });
  if (sweep && sweep.removed) console.log("[holders room]", JSON.stringify(sweep));
  if (tgError) return NextResponse.json({ ok: false, error: "telegram step failed", first, ...out, push }, { status: 500 });
  return NextResponse.json({ ok: true, first, ...out, push });
}
