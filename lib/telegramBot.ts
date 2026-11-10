// lib/telegramBot.ts (server only)
// Everything the Wraith Telegram bot needs: user prefs, de-duplicated broadcasting, and the premium message layouts.
import { getDb } from "@/lib/mongoClient";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { fmtAge, fmtPct } from "@/lib/market";
import type { Signal } from "@/app/api/signals/route";
import type { SignalCall } from "@/lib/signalCalls";
import { APP_URL, chainName, esc, fmtUsd, footer, header, rule, scoreBar, tokenKeyboard } from "@/lib/telegramUi";

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
export const WIN_LADDER = [2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
export const milestoneFor = (x: number) => [...WIN_LADDER].reverse().find((m) => x >= m) ?? 0;

export interface TgPrefs { signals: boolean; wins: boolean; minScore: number; chains: string[]; muteUntil: number }
export const DEFAULT_PREFS: TgPrefs = { signals: true, wins: true, minScore: 70, chains: [], muteUntil: 0 };
export const prefsOf = (u: { tgPrefs?: Partial<TgPrefs> } | null | undefined): TgPrefs => ({ ...DEFAULT_PREFS, ...(u?.tgPrefs ?? {}) });

export type TgResult<T = unknown> = { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };

export async function tg<T = unknown>(method: string, body: unknown): Promise<TgResult<T>> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return await r.json();
  } catch {
    return { ok: false, description: "network" };
  }
}

/** Atomically claim a de-dupe key. True = first time (go ahead and send). */
export async function claim(key: string): Promise<boolean> {
  try {
    const db = await getDb();
    await db.collection<{ _id: string; at: Date }>("tg_sent").insertOne({ _id: key, at: new Date() });
    return true;
  } catch {
    return false;
  }
}

type Markup = ReturnType<typeof tokenKeyboard>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Telegram answers these when a person blocked the bot, deleted their account or the chat is gone: keep sending is pointless
const GONE = /bot was blocked|user is deactivated|chat not found|bot was kicked|PEER_ID_INVALID/i;

/** Photo with caption when there is an image (and the caption fits), plain message otherwise; one retry if Telegram says "slow down". */
async function post(chat: string | number, text: string, opts: { imageUrl?: string; markup?: Markup }, extra: Record<string, unknown> = {}): Promise<TgResult> {
  const sendOnce = async (): Promise<TgResult> => {
    let res: TgResult = { ok: false };
    if (opts.imageUrl && text.length < 1000) {
      res = await tg("sendPhoto", { chat_id: chat, photo: opts.imageUrl, caption: text, parse_mode: "HTML", reply_markup: opts.markup, ...extra });
    }
    if (!res.ok) res = await tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: opts.markup, ...extra });
    return res;
  };
  let res = await sendOnce();
  if (!res.ok && res.error_code === 429) {
    const wait = Math.min(5, res.parameters?.retry_after ?? 1);
    await sleep(wait * 1000);
    res = await sendOnce();
  }
  return res;
}

/**
 * Send to the public group, then to every linked, eligible user whose prefs allow it.
 *
 * The old version walked the subscribers one by one and posted to the public group last. At a few hundred subscribers that is
 * longer than the cron's 60 second limit: the run was killed half way, the de-dupe key was already used, so the remaining people
 * never got the alert and the group never got its post. Now the group goes first, subscribers are sent in parallel batches paced
 * to Telegram's ~30 messages per second, anyone who blocked the bot is unlinked, and the run stops cleanly before the time limit.
 */
export async function broadcast(kind: "signal" | "win", text: string, opts: { chain?: string; score?: number; markup?: Markup; imageUrl?: string; teaser?: string }) {
  const db = await getDb();
  const chain = opts.chain ?? "solana";

  // Optional PUBLIC group/topic: marketing only. It never gets a signal, and a win goes out as a teaser (the result, with no contract
  // address and no chart or swap links), so nobody can act on a call without holding the tier. Full messages go to subscribers' DMs
  // and the private holders room only. TELEGRAM_GROUP_SIGNALS is ignored on purpose.
  const gid = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (gid && kind === "win" && opts.teaser) {
    const thread = Number(process.env.TELEGRAM_GROUP_THREAD_ID);
    const extra = Number.isFinite(thread) && thread > 0 ? { message_thread_id: thread } : {};
    const res = await post(gid, opts.teaser, { imageUrl: opts.imageUrl, markup: teaserKeyboard() }, extra);
    if (!res.ok) console.error("[telegram] group post failed", res.description);
  }

  // Private, token-gated holders room (only approved SPECTER / WRAITH members can be in it): gets every signal and win
  const vip = process.env.TELEGRAM_VIP_CHAT_ID;
  if (vip) {
    const vthread = Number(process.env.TELEGRAM_VIP_THREAD_ID);
    const res = await post(vip, text, opts, Number.isFinite(vthread) && vthread > 0 ? { message_thread_id: vthread } : {});
    if (!res.ok) console.error("[telegram] holders room post failed", res.description);
  }

  const users = await db
    .collection("users")
    // Beta switch on: every linked account gets DM alerts. Otherwise only verified SPECTER / WRAITH holders.
    .find(
      (await getLaunchSettings()).featuresFree
        ? { telegramChatId: { $exists: true, $ne: null } }
        : { telegramChatId: { $exists: true, $ne: null }, tier: { $in: ["SPECTER", "WRAITH"] }, tierSource: { $in: ["chain", "whitelist"] } },
      { projection: { telegramChatId: 1, tgPrefs: 1 } },
    )
    .toArray();
  const now = Date.now();
  const targets = users.filter((u) => {
    const p = prefsOf(u as { tgPrefs?: Partial<TgPrefs> });
    return (
      p.muteUntil < now &&
      (kind === "signal" ? p.signals && (opts.score ?? 100) >= p.minScore : p.wins) &&
      (p.chains.length === 0 || p.chains.includes(chain))
    );
  });
  const skipped = users.length - targets.length;

  const BATCH = 25; // per second, safely under Telegram's bulk limit
  const deadline = Date.now() + 45_000;
  let sent = 0;
  let unsent = 0;
  const gone: unknown[] = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    if (Date.now() > deadline) { unsent = targets.length - i; console.warn(`[telegram] time budget reached, ${unsent} subscribers not reached`); break; }
    const started = Date.now();
    await Promise.all(
      targets.slice(i, i + BATCH).map(async (u) => {
        const res = await post(String(u.telegramChatId), text, opts);
        if (res.ok) sent++;
        else if (GONE.test(res.description ?? "")) gone.push(u._id);
      }),
    );
    const took = Date.now() - started;
    if (took < 1000 && i + BATCH < targets.length) await sleep(1000 - took);
  }
  if (gone.length) {
    await db.collection("users").updateMany({ _id: { $in: gone as never[] } }, { $unset: { telegramChatId: "", telegramLinkedAt: "" } }).catch(() => undefined);
  }
  return { sent, skipped, unsent, unlinked: gone.length };
}

// ── message layouts ────────────────────────────────────────────────────────

export function signalMessage(s: Signal): string {
  const t = s.token;
  const m = s.meta ?? {};
  const hot = s.tier === "HOT";
  const chain = t.chain ?? "solana";
  const h1 = t.change.h1;
  const buyShare = m.buyVol1h !== undefined && m.sellVol1h !== undefined && m.buyVol1h + m.sellVol1h > 0 ? Math.round((m.buyVol1h / (m.buyVol1h + m.sellVol1h)) * 100) : null;
  const L: string[] = [
    header(hot ? "🟢" : "🟡", hot ? "HOT SIGNAL" : "WATCH SIGNAL", t.symbol, chain, t.name),
    `💰 <b>MCap</b>  ${fmtUsd(t.mcap)}    💧 <b>Liq</b>  ${fmtUsd(t.liquidity)}`,
    `${(h1 ?? 0) >= 0 ? "🟩" : "🟥"} <b>1h</b>  ${fmtPct(h1)}    📊 <b>Vol 1h</b>  ${fmtUsd(t.volume.h1)}`,
    `🕒 <b>Age</b>  ${t.createdAt ? fmtAge(t.createdAt) : "—"}${m.holders ? `    🧑‍🤝‍🧑 <b>Holders</b>  ${m.holders.toLocaleString("en-US")}` : ""}`,
  ];
  if (buyShare !== null) L.push(`⚖️ <b>Buy / sell</b>  ${buyShare}% / ${100 - buyShare}%`);
  L.push(`📈 <b>Score</b>  ${s.score}/100  <code>${scoreBar(s.score)}</code>`);
  if (s.tags.length) L.push(rule, `✅ ${s.tags.map(esc).join("  ·  ")}`);
  if (s.risks.length) L.push(`⚠️ ${s.risks.map(esc).join("  ·  ")}`);
  L.push(rule, `<code>${t.address}</code>`, "", footer);
  return L.join("\n");
}

export function winMessage(c: Pick<SignalCall, "address" | "chain" | "symbol" | "name" | "spottedAt" | "spottedMcap" | "peakMcap" | "lastMcap" | "score" | "tier">, milestone: number): string {
  const x = c.lastMcap / c.spottedMcap;
  const peakX = c.peakMcap / c.spottedMcap;
  const spotted = new Date(c.spottedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
  const L: string[] = [
    header("🏆", `WRAITH WIN · ${milestone}x`, c.symbol, c.chain, c.name),
    `🚀 <b>${x.toFixed(x >= 10 ? 1 : 2)}x</b> from the call${peakX > x * 1.05 ? `   <i>(peak ${peakX.toFixed(peakX >= 10 ? 1 : 2)}x)</i>` : ""}`,
    `📍 <b>Called</b>  ${fmtUsd(c.spottedMcap)}  <i>${spotted} PHT</i>`,
    `📊 <b>Now</b>  ${fmtUsd(c.lastMcap)}    🏔 <b>Peak</b>  ${fmtUsd(c.peakMcap)}`,
    `⏱ <b>Since call</b>  ${fmtAge(c.spottedAt)}`,
    `📈 <b>Score at call</b>  ${c.score}/100  <code>${scoreBar(c.score)}</code>`,
    rule,
    `<code>${c.address}</code>`,
    "",
    footer,
  ];
  return L.join("\n");
}

/** Public-channel version of a win: the proof, without anything you could trade from. */
export function winTeaser(c: Pick<SignalCall, "symbol" | "spottedAt" | "spottedMcap" | "peakMcap" | "lastMcap">, milestone: number): string {
  const x = c.lastMcap / c.spottedMcap;
  const peakX = c.peakMcap / c.spottedMcap;
  const spotted = new Date(c.spottedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
  return [
    header("🏆", `WRAITH WIN · ${milestone}x`, c.symbol, undefined, undefined),
    `🚀 <b>${x.toFixed(x >= 10 ? 1 : 2)}x</b> from the call${peakX > x * 1.05 ? `   <i>(peak ${peakX.toFixed(peakX >= 10 ? 1 : 2)}x)</i>` : ""}`,
    `📍 <b>Called</b>  ${fmtUsd(c.spottedMcap)}  <i>${spotted} PHT</i>`,
    rule,
    "🔒 <i>Contract and live alerts are for SPECTER and WRAITH holders.</i>",
    "",
    footer,
  ].join("\n");
}
const teaserKeyboard = (): Markup => ({ inline_keyboard: [[{ text: "👻 Get alerts like this", url: `${APP_URL}/app` }]] }) as unknown as Markup;

export const walletLine = (chain?: string) => chainName(chain);
