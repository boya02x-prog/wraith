// Phone notifications: Web Push (browser / installed web app) and native Android push through Firebase (the Wraith app).
// Needs env: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com) for web push,
// and FIREBASE_SERVICE_ACCOUNT for the Android app.
import webpush from "web-push";
import { isPushEndpoint } from "@/lib/pushEndpoint";
import { getDb } from "@/lib/mongoClient";
import { fcmConfigured, sendFcm } from "@/lib/fcm";
import type { SignalCall } from "@/lib/signalCalls";

export interface PushPrefs { trader: boolean; callout: boolean; saved: boolean; signal: boolean }
export interface PushSub {
  _id: string; // endpoint
  userId: string;
  p256dh: string;
  auth: string;
  prefs: PushPrefs;
  saved: { mint: string; symbol: string }[];
  base: Record<string, number>;
  cursor: number;
  createdAt: number;
  fcm?: boolean; // native Android push; _id is "fcm:<token>"
  lastSentAt?: number; // last time the push service accepted an alert for this device
  lastError?: { at: number; code: string }; // why the last alert could not be sent (cleared by the next success)
}
interface Msg { title: string; body: string; url: string; tag: string }
/** ok = accepted by the push service · dead = the device is gone and should be removed · error = could not send (why) */
interface Outcome { ok: boolean; dead: boolean; error?: string }

const COLLECTION = "push_subs";
const SAVED_MOVE = 0.25;
const MAX_PER_RUN = 5;

let ready: boolean | null = null;
/** true when either web push or native push can send */
export function pushAnyConfigured(): boolean { return pushConfigured() || fcmConfigured(); }

export function pushConfigured(): boolean {
  if (ready !== null) return ready;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { ready = false; return false; }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@wraith.farm", pub, priv);
    ready = true;
  } catch (e) {
    console.error("[push] bad VAPID keys", e);
    ready = false;
  }
  return ready;
}

const k = (n?: number | null) => {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const wants = (s: PushSub, key: keyof PushPrefs) => s.prefs?.[key] !== false;

/**
 * Which of the devices should get alerts: the Wraith app (Firebase) when a user has it linked AND the server can send to it,
 * otherwise the browser. One channel per user, so nothing arrives twice.
 */
function activeSubs(all: PushSub[]): PushSub[] {
  const appOk = fcmConfigured();
  const appUsers = new Set(appOk ? all.filter((s) => s.fcm).map((s) => s.userId) : []);
  return all.filter((s) => (s.fcm ? appOk : !appUsers.has(s.userId)));
}

async function deliver(sub: PushSub, msg: Msg): Promise<Outcome> {
  if (sub.fcm) {
    const r = await sendFcm(sub._id.slice(4), msg);
    if (r.status === "ok") return { ok: true, dead: false };
    if (r.status === "dead") return { ok: false, dead: true };
    return { ok: false, dead: false, error: r.code };
  }
  if (!pushConfigured()) return { ok: false, dead: false, error: "web-push-not-configured" };
  if (!isPushEndpoint(sub._id)) return { ok: false, dead: true }; // not a push-service URL: never call it, and drop the row
  try {
    await webpush.sendNotification({ endpoint: sub._id, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(msg), { TTL: 3600, urgency: "high" });
    return { ok: true, dead: false };
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return { ok: false, dead: true };
    console.error("[push] send failed", code ?? e);
    return { ok: false, dead: false, error: `web-${code ?? "error"}` };
  }
}

/** Runs `fn` over `items` a few at a time, so one slow phone cannot hold everyone else up. */
async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export interface TestReport {
  configured: { app: boolean; browser: boolean };
  registered: { app: number; browser: number };
  results: { kind: "app" | "browser"; ok: boolean; dead?: boolean; error?: string }[];
  sent: number;
}

/** Sends one test alert to this user's phone(s) and reports exactly what happened to each. */
export async function sendTest(userId: string): Promise<TestReport> {
  const db = await getDb();
  const col = db.collection<PushSub>(COLLECTION);
  const all = await col.find({ userId }).toArray();
  const report: TestReport = {
    configured: { app: fcmConfigured(), browser: pushConfigured() },
    registered: { app: all.filter((s) => s.fcm).length, browser: all.filter((s) => !s.fcm).length },
    results: [],
    sent: 0,
  };
  const dead: string[] = [];
  for (const s of activeSubs(all)) {
    const o = await deliver(s, { title: "Wraith notifications are on", body: "You will get calls, trader buys and saved-token moves here.", url: "/app", tag: "test" });
    report.results.push({ kind: s.fcm ? "app" : "browser", ok: o.ok, ...(o.dead ? { dead: true } : {}), ...(o.error ? { error: o.error } : {}) });
    if (o.ok) {
      report.sent++;
      await col.updateOne({ _id: s._id }, { $set: { lastSentAt: Date.now() }, $unset: { lastError: "" } });
    } else if (o.dead) {
      dead.push(s._id);
    } else if (o.error) {
      await col.updateOne({ _id: s._id }, { $set: { lastError: { at: Date.now(), code: o.error } } });
    }
  }
  if (dead.length) await col.deleteMany({ _id: { $in: dead } });
  return report;
}

/** What the server knows about this user's phones (never the tokens or keys themselves). */
export async function pushStatus(userId: string) {
  const db = await getDb();
  const all = await db.collection<PushSub>(COLLECTION).find({ userId }, { projection: { p256dh: 0, auth: 0 } }).toArray();
  return {
    configured: { app: fcmConfigured(), browser: pushConfigured() },
    devices: all.map((s) => ({
      kind: s.fcm ? ("app" as const) : ("browser" as const),
      since: s.createdAt,
      lastSentAt: s.lastSentAt ?? null,
      lastError: s.lastError?.code ?? null,
    })),
  };
}

/** Push one message to every subscriber who has that category on (one channel per user). Used for win milestones. */
export async function pushBroadcast(msg: Msg, pref: keyof PushPrefs = "signal"): Promise<number> {
  if (!pushAnyConfigured()) return 0;
  const db = await getDb();
  const col = db.collection<PushSub>(COLLECTION);
  const subs = activeSubs(await col.find({}).limit(3000).toArray()).filter((s) => wants(s, pref));
  const dead: string[] = [];
  let sent = 0;
  await inChunks(subs, 20, async (sub) => {
    const o = await deliver(sub, msg);
    if (o.ok) sent++;
    else if (o.dead) dead.push(sub._id);
  });
  if (dead.length) await col.deleteMany({ _id: { $in: dead } });
  return sent;
}

async function jupPrices(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < mints.length; i += 50) {
    try {
      const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.slice(i, i + 50).join(",")}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = (await r.json()) as Record<string, { usdPrice?: number }>;
      for (const [m, v] of Object.entries(d)) if (v?.usdPrice && v.usdPrice > 0) out[m] = v.usdPrice;
    } catch { /* skip this chunk */ }
  }
  return out;
}

/** Called every minute by the cron. Sends each subscriber only what happened since their last run. */
export async function runPushAlerts(): Promise<{ subs: number; sent: number; failed: number; removed: number; app: boolean }> {
  const res = { subs: 0, sent: 0, failed: 0, removed: 0, app: fcmConfigured() };
  if (!pushAnyConfigured()) return res;
  const db = await getDb();
  const col = db.collection<PushSub>(COLLECTION);
  const allSubs = await col.find({}).limit(3000).toArray();
  if (!res.app && allSubs.some((s) => s.fcm)) console.warn("[push] phones are linked through the Wraith app but FIREBASE_SERVICE_ACCOUNT is missing or invalid");
  const subs = activeSubs(allSubs);
  res.subs = subs.length;
  if (!subs.length) return res;
  const now = Date.now();
  const minCursor = Math.min(...subs.map((s) => s.cursor));

  // fresh HOT calls
  const hot = await db.collection<SignalCall>("signal_calls")
    .find({ spottedAt: { $gt: minCursor }, shadow: { $ne: true }, engine: 2, tier: "HOT" }).limit(50).toArray();

  // who follows whom
  const userIds = [...new Set(subs.map((s) => s.userId))];
  const follows = await db.collection("trader_follows").find({ followerId: { $in: userIds } }, { projection: { _id: 0, followerId: 1, traderId: 1 } }).limit(20000).toArray();
  const followMap = new Map<string, Set<string>>();
  for (const f of follows) {
    const set = followMap.get(String(f.followerId)) ?? new Set<string>();
    set.add(String(f.traderId));
    followMap.set(String(f.followerId), set);
  }
  const traderIds = [...new Set(follows.map((f) => String(f.traderId)))];

  type Ev = { traderId: string; name: string; type: "open" | "closed"; mint: string; symbol: string; entryMcap?: number; pnlPct?: number; ts: number };
  const events: Ev[] = [];
  type Co = { userId: string; name: string; text: string; mint?: string; id: string; ts: number };
  const callouts: Co[] = [];
  if (traderIds.length) {
    const [profiles, tradeDocs, posDocs, coDocs] = await Promise.all([
      db.collection("profiles").find({ userId: { $in: traderIds }, publicTrading: true }, { projection: { _id: 0, userId: 1, displayName: 1 } }).toArray(),
      db.collection("trades").find({ userId: { $in: traderIds } }, { projection: { _id: 0, userId: 1, trades: 1 } }).toArray(),
      db.collection("positions").find({ userId: { $in: traderIds } }, { projection: { _id: 0, userId: 1, positions: 1 } }).toArray(),
      db.collection("callouts").find({ userId: { $in: traderIds }, parentId: { $exists: false } }, { projection: { _id: 1, userId: 1, mint: 1, text: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(120).toArray(),
    ]);
    const names = new Map(profiles.map((p) => [String(p.userId), String(p.displayName || "A trader you follow")]));
    const publicIds = new Set(profiles.map((p) => String(p.userId)));
    for (const d of posDocs) {
      if (!publicIds.has(String(d.userId)) || !Array.isArray(d.positions)) continue;
      for (const p of d.positions as { mint?: string; symbol?: string; status?: string; entryMcap?: number; ts?: number }[]) {
        if (p.status === "watching" && p.mint && typeof p.ts === "number") events.push({ traderId: String(d.userId), name: names.get(String(d.userId)) ?? "", type: "open", mint: p.mint, symbol: p.symbol ?? "", entryMcap: p.entryMcap, ts: p.ts });
      }
    }
    for (const d of tradeDocs) {
      if (!publicIds.has(String(d.userId)) || !Array.isArray(d.trades)) continue;
      for (const t of d.trades as { mint?: string; symbol?: string; status?: string; pnlPct?: number; ts?: number }[]) {
        if (typeof t.pnlPct === "number" && t.status !== "failed" && t.mint && typeof t.ts === "number") events.push({ traderId: String(d.userId), name: names.get(String(d.userId)) ?? "", type: "closed", mint: t.mint, symbol: t.symbol ?? "", pnlPct: t.pnlPct, ts: t.ts });
      }
    }
    for (const c of coDocs) {
      if (!publicIds.has(String(c.userId))) continue;
      const ts = typeof c.createdAt === "number" ? c.createdAt : c.createdAt ? new Date(c.createdAt as Date).getTime() : 0;
      if (ts > 0) callouts.push({ userId: String(c.userId), name: names.get(String(c.userId)) ?? "", text: String(c.text ?? ""), mint: c.mint ? String(c.mint) : undefined, id: String(c._id), ts });
    }
  }

  // saved tokens
  const savedMints = [...new Set(subs.filter((s) => wants(s, "saved")).flatMap((s) => (s.saved ?? []).map((x) => x.mint)))].slice(0, 300);
  const prices = savedMints.length ? await jupPrices(savedMints) : {};

  const dead: string[] = [];
  const writes: Parameters<typeof col.bulkWrite>[0] = [];
  await inChunks(subs, 20, async (sub) => {
    try {
      const msgs: Msg[] = [];
      const cur = sub.cursor;
      if (wants(sub, "signal")) {
        for (const c of hot) if (c.spottedAt > cur) msgs.push({ title: `Fresh call: $${c.symbol}`, body: `Spotted at ${k(c.spottedMcap)} · score ${Math.round(c.score)}`, url: `/app/token/${c.address}`, tag: `s:${c.address}` });
      }
      const mine = followMap.get(sub.userId);
      if (mine && wants(sub, "trader")) {
        for (const e of events) {
          if (!mine.has(e.traderId) || e.ts <= cur || e.ts > now) continue;
          msgs.push({
            title: `${e.name} ${e.type === "open" ? "bought" : "closed"} ${e.symbol ? `$${e.symbol}` : "a token"}`,
            body: e.type === "open" ? `In at ${k(e.entryMcap)} market cap` : `${(e.pnlPct ?? 0) >= 0 ? "+" : ""}${Math.round(e.pnlPct ?? 0)}% result`,
            url: `/app/token/${e.mint}`, tag: `t:${e.traderId}:${e.mint}:${e.type}`,
          });
        }
      }
      if (mine && wants(sub, "callout")) {
        for (const c of callouts) {
          if (!mine.has(c.userId) || c.ts <= cur || c.ts > now) continue;
          msgs.push({ title: `${c.name} posted intel`, body: c.text.slice(0, 110), url: c.mint ? `/app/token/${c.mint}` : `/app/u/${encodeURIComponent(c.userId)}`, tag: `c:${c.id}` });
        }
      }
      const base = { ...(sub.base ?? {}) };
      if (wants(sub, "saved")) {
        for (const s of sub.saved ?? []) {
          const px = prices[s.mint];
          if (!px) continue;
          const b = base[s.mint];
          if (!b) { base[s.mint] = px; continue; }
          const move = px / b - 1;
          if (Math.abs(move) >= SAVED_MOVE) {
            msgs.push({ title: `$${s.symbol} is ${move > 0 ? "up" : "down"} ${Math.abs(Math.round(move * 100))}%`, body: "A token you saved just moved", url: `/app/token/${s.mint}`, tag: `p:${s.mint}` });
            base[s.mint] = px;
          }
        }
      }

      let alive = true;
      let okCount = 0;
      let failCode = "";
      const batch = msgs.slice(0, MAX_PER_RUN);
      if (msgs.length > MAX_PER_RUN) batch[MAX_PER_RUN - 1] = { title: `${msgs.length - MAX_PER_RUN + 1} more updates on Wraith`, body: "Open the app to see everything new.", url: "/app", tag: "more" };
      for (const m of batch) {
        const o = await deliver(sub, m);
        if (o.dead) { alive = false; break; }
        if (o.ok) { okCount++; res.sent++; } else { res.failed++; failCode = o.error ?? "error"; }
      }
      if (!alive) { dead.push(sub._id); return; }

      // Nothing got through (the phone is not gone, the send just failed): keep this window open so the next run tries
      // again, but never reach back more than 10 minutes.
      const retry = batch.length > 0 && okCount === 0 && failCode !== "";
      const set: Partial<PushSub> = { cursor: retry ? Math.max(cur, now - 10 * 60_000) : now, base };
      if (okCount) set.lastSentAt = now;
      if (failCode) set.lastError = { at: now, code: failCode };
      writes.push({ updateOne: { filter: { _id: sub._id }, update: okCount && !failCode ? { $set: set, $unset: { lastError: "" } } : { $set: set } } });
    } catch (e) {
      console.error("[push] one subscriber failed", e);
    }
  });
  if (writes.length) await col.bulkWrite(writes, { ordered: false }).catch((e) => console.error("[push] cursor update", e));
  if (dead.length) { await col.deleteMany({ _id: { $in: dead } }); res.removed = dead.length; }
  return res;
}
