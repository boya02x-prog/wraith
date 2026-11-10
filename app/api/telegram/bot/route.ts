// app/api/telegram/bot/route.ts — Wraith Signals bot webhook.
import { NextRequest, NextResponse } from "next/server";
import clientPromise from "@/lib/mongoClient";
import { APP_URL, chainName, esc, fmtUsd, footer, rule, scoreBar, tokenKeyboard } from "@/lib/telegramUi";
import { DEFAULT_PREFS, prefsOf, tg, type TgPrefs } from "@/lib/telegramBot";
import { fmtAge, fmtPct } from "@/lib/market";
import { featureTier } from "@/lib/launchSettingsServer";
import { CHAINS } from "@/lib/chains";
import type { Signal } from "@/app/api/signals/route";
import type { SignalCall } from "@/lib/signalCalls";
import { callGet } from "@/lib/internalCall";
import { checkLimit, telegramChatLimiter } from "@/lib/ratelimit";
import { sameSecret, webhookSecret } from "@/lib/telegramSecret";
import { handleJoinRequest } from "@/lib/telegramGate";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

type Btn = { text: string; url?: string; callback_data?: string };
type Markup = { inline_keyboard: Btn[][] };
const openApp: Markup = { inline_keyboard: [[{ text: "👻 Open Wraith", url: `${APP_URL}/app` }]] };
const scannerBtn: Markup = { inline_keyboard: [[{ text: "📡 Open Scanner", url: `${APP_URL}/app` }, { text: "🏆 Wins", url: `${APP_URL}/app` }]] };

async function send(chatId: number, text: string, markup?: Markup) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup }),
  });
}

const CHAINS_LINE = "Solana · Base · Ethereum · BNB Chain · Monad · Arc · Robinhood Chain";

function msgStart(name: string) {
  return `👻 <b>WRAITH SIGNALS</b>
${rule}
Welcome, <b>${esc(name)}</b>.

Live momentum signals from the Wraith scanner, pushed here the moment they fire, across <b>every chain</b>:
<i>${CHAINS_LINE}</i>

Each alert carries mcap at detection, AI score, the contract, and one-tap links to the chart and swap.

<b>Get connected</b>
<b>1</b>  Open Wraith and sign in
<b>2</b>  Profile menu → <b>Connect Telegram</b>
<b>3</b>  Tap the link, press <b>Start</b> here. Done.

/top  ·  /wins  ·  /token  ·  /settings  ·  /status

${footer}`;
}

function msgHelp() {
  return `👻 <b>WRAITH SIGNALS · HELP</b>
${rule}
<b>Pushed to you, even when you're away</b>
🟢 <b>HOT SIGNAL</b>  score 70+, strong momentum and liquidity
🟡 <b>WATCH SIGNAL</b>  moderate conviction
🏆 <b>WRAITH WIN</b>  a call hits 2x, 3x, 5x, 10x and up

<b>Ask the bot</b>
/top  best live signals right now
/wins  call record and best performers (7d)
/token <code>&lt;address&gt;</code>  full read on any token
/settings  choose chains, minimum score, mute
/mute <code>1h</code> · <code>8h</code> · <code>off</code>  quick quiet mode
/status  link and tier check
/unlink  stop alerts to this chat

${footer}`;
}

function msgTier() {
  return `👻 <b>WHO GETS ALERTS</b>
${rule}
Telegram alerts are a <b>SPECTER</b> and <b>WRAITH</b> tier feature.

◌ <b>GHOST</b>  free · scanner only
◈ <b>SHADE</b>  250,000 OMEN · sniper &amp; hot wallet
◆ <b>SPECTER</b>  500,000 OMEN · AI score, live signals, <b>Telegram alerts</b>
⬡ <b>WRAITH</b>  1,000,000 OMEN · everything, 0% fees

Your tier updates automatically when you connect your wallet.

${footer}`;
}

function msgSignals() {
  return `👻 <b>WHAT ALERTS LOOK LIKE</b>
${rule}
🟢 <b>HOT SIGNAL</b>
<b>$PEPELON</b>  <i>Solana</i>
${rule}
💰 <b>MCap</b>  $18.4K
📈 <b>Score</b>  84/100  <code>▰▰▰▰▰▰▰▰▱▱</code>
🔥 <b>Tier</b>  ULTRA
🧠 Multi-platform traction with on-chain confirmation
${rule}
📡 PUMPFUN · TWITTER

then a <b>Wraith Win</b> when it runs:

✅ <b>WRAITH WIN</b>
<b>$DOGEAI</b>  <i>Base</i>
🚀 <b>4.70x</b> from spotted price
📍 <b>Spotted</b>  $9.1K
📊 <b>Now</b>  $42.8K

${footer}`;
}

async function msgStatus(chatId: number) {
  try {
    const db = (await clientPromise).db();
    const u = await db.collection("users").findOne({ telegramChatId: String(chatId) }, { projection: { email: 1, name: 1, tier: 1, tierSource: 1 } });
    if (!u) {
      return {
        text: `👻 <b>STATUS</b>\n${rule}\n🔴 <b>Not linked</b>\n\nThis chat isn't connected to a Wraith account yet. In Wraith open the profile menu and choose <b>Connect Telegram</b>.\n\n${footer}`,
        markup: openApp,
      };
    }
    const tier = await featureTier(u as { tier?: unknown; tierSource?: unknown });
    const eligible = tier === "SPECTER" || tier === "WRAITH";
    return {
      text: `👻 <b>STATUS</b>\n${rule}\n🟢 <b>Linked</b>  ${esc(String(u.email ?? u.name ?? "your account"))}\n🎚 <b>Tier</b>  ${esc(tier)}\n${eligible ? "📡 <b>Alerts are ON</b>" : "⚠️ <b>Alerts are OFF</b>  needs SPECTER (500,000 OMEN)"}\n\n${footer}`,
      markup: eligible ? scannerBtn : openApp,
    };
  } catch {
    return { text: `👻 <b>STATUS</b>\n${rule}\nCouldn't check right now. Try again in a moment.`, markup: openApp };
  }
}

async function cmdTop(chatId: number, origin: string) {
  // in-process call: fetching our own /api/signals over HTTP has no session cookie, so proxy.ts answered 401 and /top always said "warming up"
  const data = await callGet<{ signals?: Signal[] }>(() => import("@/app/api/signals/route"), `${origin}/api/signals`, 20_000).catch(() => null);
  const list = (data?.signals ?? []).slice(0, 6);
  if (!list.length) return send(chatId, `👻 <b>TOP SIGNALS</b>\n${rule}\nThe feed is warming up. Try again in a minute.`, openApp);
  const lines = list.map((s, i) => {
    const t = s.token;
    return `<b>${i + 1}. $${esc(t.symbol.toUpperCase())}</b>  <i>${chainName(t.chain)}</i>  ${s.tier === "HOT" ? "🟢" : "🟡"} <b>${s.score}</b>\n     ${fmtUsd(t.mcap)} mcap · ${fmtPct(t.change.h1)} 1h · ${fmtUsd(t.volume.h1)} vol · ${t.createdAt ? fmtAge(t.createdAt) : "—"}${s.tags[0] ? `\n     ✅ ${esc(s.tags.slice(0, 3).join(" · "))}` : ""}`;
  });
  const kb: Btn[][] = [];
  for (let i = 0; i < list.length; i += 3) kb.push(list.slice(i, i + 3).map((s, j) => ({ text: `${i + j + 1} · $${s.token.symbol.toUpperCase().slice(0, 8)}`, url: `${APP_URL}/app/token/${s.token.address}${s.token.chain && s.token.chain !== "solana" ? `?chain=${s.token.chain}` : ""}` })));
  await send(chatId, `🔥 <b>TOP SIGNALS NOW</b>\n${rule}\n${lines.join("\n\n")}\n\n${footer}`, { inline_keyboard: kb });
}

async function cmdWins(chatId: number) {
  const db = (await clientPromise).db();
  const calls = await db.collection<SignalCall>("signal_calls").find({ spottedAt: { $gt: Date.now() - 7 * 86_400_000 }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2 }).toArray();
  if (!calls.length) return send(chatId, `🏆 <b>WRAITH RECORD</b>\n${rule}\nNo calls tracked yet.`, scannerBtn);
  const x = (c: SignalCall) => c.peakMcap / c.spottedMcap;
  const hit2 = calls.filter((c) => x(c) >= 2).length;
  const hit5 = calls.filter((c) => x(c) >= 5).length;
  const best = [...calls].sort((a, b) => x(b) - x(a)).slice(0, 6);
  const lines = best.map((c, i) => `<b>${i + 1}. $${esc(c.symbol)}</b>  <i>${chainName(c.chain)}</i>  <b>${x(c).toFixed(x(c) >= 10 ? 1 : 2)}x</b>\n     ${fmtUsd(c.spottedMcap)} → ${fmtUsd(c.peakMcap)} peak · called ${fmtAge(c.spottedAt)} ago`);
  const kb = [[...best.slice(0, 3).map((c) => ({ text: `$${c.symbol.slice(0, 8)}`, url: tokenKeyboard(c.address, c.chain ?? "solana").inline_keyboard[0][0].url }))]];
  await send(
    chatId,
    `🏆 <b>WRAITH RECORD · 7 DAYS</b>\n${rule}\n📡 <b>${calls.length}</b> calls    ✅ <b>${hit2}</b> hit 2x+  (<b>${Math.round((hit2 / calls.length) * 100)}%</b>)    🚀 <b>${hit5}</b> hit 5x+\n${rule}\n<b>Best performers</b>\n${lines.join("\n")}\n\n${footer}`,
    { inline_keyboard: kb },
  );
}

const DEX_CHAIN: Record<string, string> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc", monad: "monad", arc: "arc", robinhood: "robinhood" };
async function cmdToken(chatId: number, ca: string | null) {
  if (!ca) return send(chatId, `Send a contract address:\n<code>/token 6bW6xsZxY…pump</code>`);
  type Pair = { chainId: string; baseToken: { address: string; symbol: string; name: string }; priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number }; volume?: { h1?: number; h24?: number }; priceChange?: { h1?: number; h24?: number }; pairCreatedAt?: number; txns?: { h1?: { buys: number; sells: number } } };
  let pairs: Pair[] = [];
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`, { signal: AbortSignal.timeout(10_000) });
    pairs = ((await r.json()) as { pairs?: Pair[] }).pairs ?? [];
  } catch { /* handled below */ }
  const p = pairs.filter((x) => x.baseToken.address.toLowerCase() === ca.toLowerCase()).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!p) return send(chatId, `🔍 <b>No market found</b>\n${rule}\nNothing trading for <code>${esc(ca)}</code> yet.`);
  const chain = DEX_CHAIN[p.chainId] ?? p.chainId;
  const mcap = p.marketCap ?? p.fdv ?? 0;
  const b = p.txns?.h1;
  const db = (await clientPromise).db();
  const call = await db.collection<SignalCall>("signal_calls").findOne({ address: ca, shadow: { $ne: true }, engine: 2 });
  const L = [
    `🔍 <b>TOKEN</b>\n<b>$${esc(p.baseToken.symbol.toUpperCase())}</b>  <i>${esc(p.baseToken.name)} · ${esc(CHAINS[chain]?.name ?? chainName(chain))}</i>\n${rule}`,
    `💰 <b>MCap</b>  ${fmtUsd(mcap)}    💧 <b>Liq</b>  ${fmtUsd(p.liquidity?.usd)}`,
    `${(p.priceChange?.h1 ?? 0) >= 0 ? "🟩" : "🟥"} <b>1h</b>  ${fmtPct(p.priceChange?.h1)}    <b>24h</b>  ${fmtPct(p.priceChange?.h24)}`,
    `📊 <b>Vol 1h</b>  ${fmtUsd(p.volume?.h1)}    <b>24h</b>  ${fmtUsd(p.volume?.h24)}`,
    `🕒 <b>Age</b>  ${p.pairCreatedAt ? fmtAge(p.pairCreatedAt) : "—"}${b ? `    ⚖️ <b>Buys/Sells 1h</b>  ${b.buys}/${b.sells}` : ""}`,
  ];
  if (call && call.spottedMcap > 0) {
    const cx = call.lastMcap / call.spottedMcap;
    L.push(rule, `👻 <b>Wraith called it</b> at ${fmtUsd(call.spottedMcap)}  →  <b>${cx.toFixed(2)}x</b>  (score ${call.score}  <code>${scoreBar(call.score)}</code>)`);
  }
  L.push(rule, `<code>${ca}</code>`, "", footer);
  await send(chatId, L.join("\n"), tokenKeyboard(ca, chain));
}

// ── settings panel ────────────────────────────────────────────────────────
const CHAIN_KEYS = ["solana", "base", "ethereum", "bsc", "monad", "arc", "robinhood"];
function settingsView(p: TgPrefs): { text: string; markup: Markup } {
  const muted = p.muteUntil > Date.now();
  const text = `⚙️ <b>ALERT SETTINGS</b>\n${rule}\n📡 <b>Signals</b>  ${p.signals ? "ON" : "OFF"}\n🏆 <b>Wins</b>  ${p.wins ? "ON" : "OFF"}\n🎯 <b>Min score</b>  ${p.minScore}  <i>(70+ = HOT only)</i>\n⛓ <b>Chains</b>  ${p.chains.length ? p.chains.map((c) => chainName(c)).join(", ") : "All"}\n🔕 <b>Quiet mode</b>  ${muted ? "until " + new Date(p.muteUntil).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" }) : "off"}\n\n${footer}`;
  const chainBtn = (k: string): Btn => ({ text: `${p.chains.length === 0 || p.chains.includes(k) ? "✅" : "▫️"} ${chainName(k)}`, callback_data: `s:ch:${k}` });
  const mk: Btn[][] = [
    [{ text: `${p.signals ? "✅" : "▫️"} Signals`, callback_data: "s:sig" }, { text: `${p.wins ? "✅" : "▫️"} Wins`, callback_data: "s:win" }],
    [50, 60, 70, 80].map((n) => ({ text: `${p.minScore === n ? "🎯 " : ""}${n}+`, callback_data: `s:min:${n}` })),
    CHAIN_KEYS.slice(0, 3).map(chainBtn),
    CHAIN_KEYS.slice(3, 6).map(chainBtn),
    [chainBtn(CHAIN_KEYS[6]), { text: "⛓ All chains", callback_data: "s:chall" }],
    [{ text: "🔕 1h", callback_data: "s:mute:1" }, { text: "🌙 8h", callback_data: "s:mute:8" }, { text: "🔔 Unmute", callback_data: "s:mute:0" }],
  ];
  return { text, markup: { inline_keyboard: mk } };
}

async function loadPrefs(chatId: number) {
  const db = (await clientPromise).db();
  const u = await db.collection("users").findOne({ telegramChatId: String(chatId) }, { projection: { tgPrefs: 1 } });
  return { db, linked: !!u, prefs: prefsOf(u as { tgPrefs?: Partial<TgPrefs> } | null) };
}
async function savePrefs(chatId: number, prefs: TgPrefs) {
  const db = (await clientPromise).db();
  await db.collection("users").updateOne({ telegramChatId: String(chatId) }, { $set: { tgPrefs: prefs } });
}

async function cmdSettings(chatId: number) {
  const { linked, prefs } = await loadPrefs(chatId);
  if (!linked) return send(chatId, `⚙️ <b>SETTINGS</b>\n${rule}\nLink this chat first: Wraith → profile menu → <b>Connect Telegram</b>.`, openApp);
  const v = settingsView(prefs);
  await send(chatId, v.text, v.markup);
}

async function cmdMute(chatId: number, arg: string | null) {
  const { linked, prefs } = await loadPrefs(chatId);
  if (!linked) return send(chatId, `This chat isn't linked yet.`, openApp);
  const h = !arg ? 1 : arg === "off" ? 0 : parseInt(arg, 10) || 1;
  prefs.muteUntil = h ? Date.now() + h * 3_600_000 : 0;
  await savePrefs(chatId, prefs);
  await send(chatId, h ? `🔕 <b>Quiet mode</b> for ${h}h. No alerts until then.\n/mute off to resume.` : `🔔 <b>Alerts resumed.</b>`);
}

async function handleCallback(cb: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }) {
  const chatId = cb.message?.chat.id;
  if (!chatId || !cb.data?.startsWith("s:")) return void (await tg("answerCallbackQuery", { callback_query_id: cb.id }));
  const { linked, prefs } = await loadPrefs(chatId);
  if (!linked) return void (await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Link this chat first." }));
  const [, act, arg] = cb.data.split(":");
  if (act === "sig") prefs.signals = !prefs.signals;
  else if (act === "win") prefs.wins = !prefs.wins;
  else if (act === "min") prefs.minScore = parseInt(arg, 10) || DEFAULT_PREFS.minScore;
  else if (act === "chall") prefs.chains = [];
  else if (act === "ch") {
    const all = prefs.chains.length === 0 ? [...CHAIN_KEYS] : prefs.chains;
    const next = all.includes(arg) ? all.filter((c) => c !== arg) : [...all, arg];
    prefs.chains = next.length === CHAIN_KEYS.length || next.length === 0 ? [] : next;
  } else if (act === "mute") {
    const h = parseInt(arg, 10) || 0;
    prefs.muteUntil = h ? Date.now() + h * 3_600_000 : 0;
  }
  await savePrefs(chatId, prefs);
  const v = settingsView(prefs);
  await tg("editMessageText", { chat_id: chatId, message_id: cb.message!.message_id, text: v.text, parse_mode: "HTML", reply_markup: v.markup });
  await tg("answerCallbackQuery", { callback_query_id: cb.id });
}

export async function POST(req: NextRequest) {
  // Every update must carry the secret registered with setWebhook (see /api/telegram/setup). It used to be optional, which left the
  // webhook open: anyone could POST a fake update and unlink people, change their alert settings or run commands as them.
  const secret = webhookSecret();
  if (!secret) return NextResponse.json({ ok: false }, { status: 503 });
  if (!sameSecret(req.headers.get("x-telegram-bot-api-secret-token") ?? "", secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: { message?: { chat: { id: number; type: string }; from?: { first_name?: string }; text?: string }; callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } } };
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Someone asked to join the private holders room: approve only linked SPECTER / WRAITH accounts (see lib/telegramGate.ts)
  const jr = (update as unknown as { chat_join_request?: Parameters<typeof handleJoinRequest>[0] }).chat_join_request;
  if (jr) {
    await handleJoinRequest(jr).catch((e) => console.error("[telegram gate]", e));
    return NextResponse.json({ ok: true });
  }

  // one chat cannot flood the bot (every command reads the database or calls a market API); always answer 200 so Telegram does not retry
  const rateId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;
  if (rateId !== undefined) {
    const rl = await checkLimit(telegramChatLimiter, `tg:${rateId}`);
    if (!rl.success) return NextResponse.json({ ok: true });
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return NextResponse.json({ ok: true });
  }
  const msg = update.message;
  if (!msg?.text) return NextResponse.json({ ok: true });
  if (msg.chat.type !== "private") return NextResponse.json({ ok: true }); // groups only receive pushed signals

  const chatId = msg.chat.id;
  const name = msg.from?.first_name ?? "trader";
  const parts = msg.text.trim().split(/\s+/);
  const cmd = parts[0].split("@")[0].toLowerCase();
  const param = parts[1] ?? null;
  if (!cmd.startsWith("/")) return NextResponse.json({ ok: true });

  switch (cmd) {
    case "/start": {
      if (!param) {
        await send(chatId, msgStart(name), openApp);
        break;
      }
      const db = (await clientPromise).db();
      // take the one-time token atomically: two chats pressing the same link at once can no longer both win
      const taken = /^[A-Za-z0-9_-]{16,100}$/.test(param)
        ? await db.collection("telegram_links").findOneAndDelete({ token: param, expiresAt: { $gt: new Date() } })
        : null;
      const link = taken?.value ?? null;
      if (!link) {
        await send(chatId, `⚠️ <b>Link expired</b>\n${rule}\nThat connect link was already used or timed out (they last 10 minutes).\n\nGenerate a fresh one from <b>Profile → Connect Telegram</b> in Wraith.`, openApp);
        break;
      }
      // one Telegram chat belongs to one Wraith account: unlink it from any other account first
      await db.collection("users").updateMany({ telegramChatId: String(chatId), _id: { $ne: link.userId } }, { $unset: { telegramChatId: "", telegramLinkedAt: "" } });
      await db.collection("users").updateOne({ _id: link.userId }, { $set: { telegramChatId: String(chatId), telegramLinkedAt: new Date() } });
      const u = await db.collection("users").findOne({ _id: link.userId }, { projection: { tier: 1, tierSource: 1 } });
      const tier = await featureTier(u as { tier?: unknown; tierSource?: unknown });
      const eligible = tier === "SPECTER" || tier === "WRAITH";
      await send(
        chatId,
        `✅ <b>TELEGRAM CONNECTED</b>\n${rule}\nYou're linked, <b>${esc(name)}</b>.\n\n${eligible ? "📡 Signals and wins will land in this chat the moment they fire, across every chain." : "⚠️ Your tier is <b>" + esc(tier) + "</b>. Alerts start once you reach <b>SPECTER</b> (500,000 OMEN)."}\n\n/top  ·  /wins  ·  /settings  ·  /status\n\n${footer}`,
        scannerBtn,
      );
      break;
    }
    case "/help":
      await send(chatId, msgHelp(), openApp);
      break;
    case "/tier":
      await send(chatId, msgTier(), openApp);
      break;
    case "/signals":
      await send(chatId, msgSignals(), scannerBtn);
      break;
    case "/top":
      await cmdTop(chatId, req.nextUrl.origin);
      break;
    case "/wins":
      await cmdWins(chatId);
      break;
    case "/token":
      await cmdToken(chatId, param);
      break;
    case "/settings":
      await cmdSettings(chatId);
      break;
    case "/mute":
      await cmdMute(chatId, param);
      break;
    case "/status": {
      const s = await msgStatus(chatId);
      await send(chatId, s.text, s.markup);
      break;
    }
    case "/unlink": {
      const db = (await clientPromise).db();
      const r = await db.collection("users").updateMany({ telegramChatId: String(chatId) }, { $unset: { telegramChatId: "", telegramLinkedAt: "" } });
      await send(chatId, r.modifiedCount ? `🔕 <b>Unlinked</b>\n${rule}\nAlerts to this chat are off. Reconnect any time from Wraith.` : `This chat wasn't linked to a Wraith account.`, openApp);
      break;
    }
    default:
      await send(chatId, `Unknown command <code>${esc(cmd)}</code>\n\n/top  ·  /wins  ·  /token  ·  /settings  ·  /mute  ·  /status  ·  /help`);
  }

  return NextResponse.json({ ok: true });
}
