// lib/quests.ts (server only)
// Quests + airdrop points. Every point is a row in `quest_ledger` with a unique key, so the same trade, task or referral can
// never be credited twice; `quest_profiles` keeps the running total for fast reads and the leaderboard.
import { randomBytes } from "crypto";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivyClient } from "@/lib/privyServer";
import { FEE_WALLET } from "@/lib/tiers";
import { getSolUsd } from "@/lib/marketProviders";
import { tg } from "@/lib/telegramBot";

// ─── RULES (edit here) ────────────────────────────────────────────────────────
export const QUEST_RULES = {
  airdropTokens: 50_000_000, // 5% of the 1B OMEN supply
  tradePointsPerUsd: 1, // 1 point per $1 traded through Wraith (verified on-chain)
  dailyTradeCap: 20_000, // most trade points one account can earn per UTC day
  minTradeUsd: 1, // trades under $1 earn nothing (stops dust farming)
  referralShare: 0.1, // referrer earns 10% of a friend's trade points
  referralFirstTradeBonus: 250, // referrer bonus when an invited friend makes their first verified trade
  firstTradeBonus: 500,
  xPostPoints: 200, // per verified post about Wraith, at most one a day
  bugMaxPoints: 5_000,
} as const;

export const TASKS = [
  { id: "tg_join", title: "Join the Wraith Telegram channel", points: 300, verify: "auto" },
  { id: "x_link", title: "Link your X account", points: 150, verify: "auto" },
  { id: "first_trade", title: "Make your first trade on Wraith", points: QUEST_RULES.firstTradeBonus, verify: "auto" },
] as const;
export type TaskId = (typeof TASKS)[number]["id"];

export const TG_CHANNEL_URL = process.env.NEXT_PUBLIC_TG_CHANNEL_URL || "https://t.me/wraithportal";
export const X_HANDLE = process.env.NEXT_PUBLIC_X_HANDLE || "wraithfarm";
/** OMEN airdrop switch: off = points only; on = the page shows each user's final allocation and the claim step. */
export const AIRDROP_FINAL = process.env.NEXT_PUBLIC_AIRDROP_FINAL === "1";

export type LedgerKind = "task" | "trade" | "referral" | "x_post" | "bug" | "admin";
export interface QuestProfile {
  _id: string; // users._id as a string
  points: number;
  refCode: string;
  referredBy?: string | null;
  refCount: number; // friends who signed up with the link
  refActive: number; // of those, friends who made a verified trade
  tasks: Partial<Record<TaskId, number>>; // task -> completed at (ms)
  lastXPostAt?: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
let indexed = false;
async function db(): Promise<Db> {
  const d = await getDb();
  if (!indexed) {
    indexed = true;
    void Promise.allSettled([
      d.collection("quest_ledger").createIndex({ key: 1 }, { unique: true }),
      d.collection("quest_ledger").createIndex({ userId: 1, at: -1 }),
      d.collection("quest_profiles").createIndex({ refCode: 1 }, { unique: true }),
      d.collection("quest_profiles").createIndex({ points: -1 }),
      d.collection("quest_bugs").createIndex({ status: 1, at: -1 }),
      d.collection("quest_bugs").createIndex({ userId: 1, at: -1 }),
    ]);
  }
  return d;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode(): string {
  const b = randomBytes(7);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

export async function getQuestProfile(userId: string): Promise<QuestProfile> {
  const d = await db();
  const col = d.collection<QuestProfile>("quest_profiles");
  const found = await col.findOne({ _id: userId });
  if (found) return found;
  for (let i = 0; i < 5; i++) {
    try {
      const now = new Date();
      const doc: QuestProfile = { _id: userId, points: 0, refCode: newCode(), referredBy: null, refCount: 0, refActive: 0, tasks: {}, createdAt: now, updatedAt: now };
      await col.insertOne(doc);
      return doc;
    } catch (e) {
      const again = await col.findOne({ _id: userId });
      if (again) return again; // created by a parallel request
      if (!(e instanceof Error) || !/E11000/.test(e.message)) throw e; // anything but a code clash
    }
  }
  throw new Error("Could not create quest profile");
}

/** Credit points once per `key`. Returns false when that key was already credited. */
export async function award(userId: string, kind: LedgerKind, pts: number, key: string, meta: Record<string, unknown> = {}): Promise<boolean> {
  const points = Math.round(pts);
  if (!(points > 0)) return false;
  const d = await db();
  try {
    await d.collection("quest_ledger").insertOne({ userId, kind, pts: points, key, meta, at: new Date() });
  } catch (e) {
    if (e instanceof Error && /E11000/.test(e.message)) return false;
    throw e;
  }
  await getQuestProfile(userId);
  await d.collection<QuestProfile>("quest_profiles").updateOne({ _id: userId }, { $inc: { points }, $set: { updatedAt: new Date() } });
  return true;
}

/** Link a new account to the friend who invited it. Only for accounts made in the last 3 days that have not traded yet. */
export async function attachReferrer(userId: string, code: string | null | undefined): Promise<void> {
  const ref = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,12}$/.test(ref) || !ObjectId.isValid(userId)) return;
  const d = await db();
  const me = await getQuestProfile(userId);
  if (me.referredBy || me.refCode === ref || me.tasks.first_trade) return;
  const user = await d.collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { createdAt: 1 } });
  const created = user?.createdAt instanceof Date ? user.createdAt.getTime() : 0;
  if (!created || Date.now() - created > 3 * 86_400_000) return;
  const inviter = await d.collection<QuestProfile>("quest_profiles").findOne({ refCode: ref });
  if (!inviter || inviter._id === userId || inviter.referredBy === userId) return;
  const res = await d.collection<QuestProfile>("quest_profiles").updateOne({ _id: userId, referredBy: null }, { $set: { referredBy: inviter._id, updatedAt: new Date() } });
  if (res.modifiedCount) await d.collection<QuestProfile>("quest_profiles").updateOne({ _id: inviter._id }, { $inc: { refCount: 1 } });
}

async function markTask(userId: string, task: TaskId, points: number): Promise<boolean> {
  const ok = await award(userId, "task", points, `task:${task}:${userId}`, { task });
  if (ok) {
    const d = await db();
    await d.collection<QuestProfile>("quest_profiles").updateOne({ _id: userId }, { $set: { [`tasks.${task}`]: Date.now() } });
  }
  return ok;
}

// ─── TASK CHECKS ─────────────────────────────────────────────────────────────
export type CheckResult = { ok: boolean; message: string };

export async function checkTelegram(userId: string): Promise<CheckResult> {
  const d = await db();
  const user = ObjectId.isValid(userId) ? await d.collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { telegramChatId: 1 } }) : null;
  const tgId = user?.telegramChatId ? Number(user.telegramChatId) : 0;
  if (!tgId) return { ok: false, message: "Connect Telegram first (profile menu → Connect Telegram), then check again." };
  const channel = process.env.TELEGRAM_CHANNEL_ID || "@wraithportal";
  const r = await tg<{ status?: string }>("getChatMember", { chat_id: channel, user_id: tgId });
  const status = r.result?.status ?? "";
  if (!r.ok && !status) return { ok: false, message: "Couldn't check the channel right now. Try again in a minute." };
  if (!["member", "administrator", "creator", "restricted"].includes(status)) return { ok: false, message: "Your linked Telegram account isn't in the channel yet. Join, then check again." };
  const done = await markTask(userId, "tg_join", taskPoints("tg_join"));
  return { ok: true, message: done ? "Telegram verified." : "Already done." };
}

async function linkedXUsername(userId: string): Promise<string | null> {
  const d = await db();
  const link = await d.collection("x_links").findOne({ userId }, { projection: { username: 1 } });
  return typeof link?.username === "string" && link.username ? link.username : null;
}

export async function checkXLink(userId: string): Promise<CheckResult> {
  if (!(await linkedXUsername(userId))) return { ok: false, message: "Link your X account in your profile first." };
  const done = await markTask(userId, "x_link", taskPoints("x_link"));
  return { ok: true, message: done ? "X account verified." : "Already done." };
}

/** A public post from the user's linked X account that mentions Wraith. Checked with X's free oEmbed endpoint. */
export async function checkXPost(userId: string, url: string): Promise<CheckResult> {
  const m = url.trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/);
  if (!m) return { ok: false, message: "Paste the link to your post (x.com/you/status/…)." };
  const [, author, id] = m;
  const handle = await linkedXUsername(userId);
  if (!handle) return { ok: false, message: "Link your X account first, so we know the post is yours." };
  if (handle.toLowerCase() !== author.toLowerCase()) return { ok: false, message: `That post isn't from @${handle}.` };
  const me = await getQuestProfile(userId);
  if (me.lastXPostAt && Date.now() - me.lastXPostAt < 20 * 3600_000) return { ok: false, message: "One post a day counts. Come back tomorrow." };
  let html = "";
  try {
    const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://x.com/${author}/status/${id}`)}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!r.ok) return { ok: false, message: "Couldn't find that post. Make sure it's public." };
    const j = (await r.json()) as { html?: string; author_url?: string };
    if (j.author_url && !j.author_url.toLowerCase().endsWith(`/${handle.toLowerCase()}`)) return { ok: false, message: `That post isn't from @${handle}.` };
    html = (j.html ?? "").toLowerCase();
  } catch {
    return { ok: false, message: "Couldn't reach X right now. Try again in a minute." };
  }
  if (!/wraith/.test(html)) return { ok: false, message: `The post needs to mention Wraith, @${X_HANDLE} or wraith.farm.` };
  const ok = await award(userId, "x_post", QUEST_RULES.xPostPoints, `x_post:${id}`, { url: `https://x.com/${author}/status/${id}` });
  if (!ok) return { ok: false, message: "That post was already counted." };
  const d = await db();
  await d.collection<QuestProfile>("quest_profiles").updateOne({ _id: userId }, { $set: { lastXPostAt: Date.now() } });
  return { ok: true, message: `Post verified: +${QUEST_RULES.xPostPoints} points.` };
}

export function taskPoints(id: TaskId): number {
  return TASKS.find((t) => t.id === id)?.points ?? 0;
}

// ─── TRADES ──────────────────────────────────────────────────────────────────
async function userWallets(userId: string): Promise<{ sol: Set<string>; evm: Set<string> }> {
  const out = { sol: new Set<string>(), evm: new Set<string>() };
  if (!ObjectId.isValid(userId)) return out;
  const d = await db();
  const user = await d.collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { privyUserId: 1, walletAddress: 1 } });
  const privy = getPrivyClient();
  if (privy && user?.privyUserId) {
    try {
      const pu = await privy.getUser(String(user.privyUserId));
      for (const a of pu.linkedAccounts ?? []) {
        if (a.type !== "wallet" || !("address" in a) || typeof a.address !== "string") continue;
        if (a.address.startsWith("0x")) out.evm.add(a.address.toLowerCase());
        else out.sol.add(a.address);
      }
    } catch { /* fall back to the stored wallet */ }
  }
  if (typeof user?.walletAddress === "string") out.sol.add(user.walletAddress);
  return out;
}

function heliusKey(): string | null {
  const raw = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || process.env.SOLANA_RPC || "";
  try { return new URL(raw).searchParams.get("api-key"); } catch { return null; }
}

const STABLES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFmCqLMqMHhM9gFm"]);
const WSOL = "So11111111111111111111111111111111111111112";

type Verified = { usd: number } | { pending: true } | { error: string };

/** A Solana swap counts when it succeeded, was paid by one of the user's wallets and paid Wraith's fee. */
async function verifySolana(sig: string, wallets: Set<string>): Promise<Verified> {
  const key = heliusKey();
  if (!key) return { error: "Trade checks are not set up on the server." };
  let tx: Record<string, any> | undefined;
  try {
    const r = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: [sig] }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return { pending: true };
    tx = ((await r.json()) as Array<Record<string, any>>)?.[0];
  } catch {
    return { pending: true };
  }
  if (!tx) return { pending: true };
  if (tx.transactionError) return { error: "That transaction failed on-chain." };
  const payer = String(tx.feePayer ?? "");
  if (!wallets.has(payer)) return { error: "That trade wasn't made from a wallet on your account." };
  const tts: Array<Record<string, any>> = tx.tokenTransfers ?? [];
  const nts: Array<Record<string, any>> = tx.nativeTransfers ?? [];
  const paidFee = tts.some((t) => t.toUserAccount === FEE_WALLET) || nts.some((n) => n.toUserAccount === FEE_WALLET);
  if (!paidFee) return { error: "That trade didn't go through Wraith." };
  let sol = 0;
  let stable = 0;
  for (const n of nts) if (n.fromUserAccount === payer || n.toUserAccount === payer) sol = Math.max(sol, (Number(n.amount) || 0) / 1e9);
  for (const t of tts) {
    if (t.fromUserAccount !== payer && t.toUserAccount !== payer) continue;
    if (t.mint === WSOL) sol = Math.max(sol, Number(t.tokenAmount) || 0);
    if (STABLES.has(t.mint)) stable = Math.max(stable, Number(t.tokenAmount) || 0);
  }
  const solUsd = sol > 0 ? Number(await getSolUsd().catch(() => 0)) || 0 : 0;
  return { usd: Math.max(sol * solUsd, stable) };
}

/** An EVM swap counts when LI.FI reports it finished, for our integrator, from one of the user's wallets. */
async function verifyEvm(hash: string, chainId: number, wallets: Set<string>): Promise<Verified> {
  const integrator = (process.env.LIFI_INTEGRATOR ?? "").toLowerCase();
  if (!integrator) return { error: "Trade checks are not set up on the server." };
  let j: Record<string, any>;
  try {
    const r = await fetch(`https://li.quest/v1/status?txHash=${hash}&fromChain=${chainId}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (r.status === 404) return { pending: true };
    if (!r.ok) return { pending: true };
    j = (await r.json()) as Record<string, any>;
  } catch {
    return { pending: true };
  }
  const status = String(j.status ?? "");
  if (status === "FAILED" || status === "INVALID") return { error: "That transaction failed." };
  if (status !== "DONE") return { pending: true };
  const from = String(j.fromAddress ?? j.sending?.fromAddress ?? "").toLowerCase();
  if (!wallets.has(from)) return { error: "That trade wasn't made from a wallet on your account." };
  const tag = String(j.metadata?.integrator ?? j.integrator ?? "").toLowerCase();
  if (tag !== integrator) return { error: "That trade didn't go through Wraith." };
  const leg = (x: Record<string, any> | undefined): number => {
    if (!x) return 0;
    const direct = Number(x.amountUSD);
    if (direct > 0) return direct;
    const amt = Number(x.amount), dec = Number(x.token?.decimals), px = Number(x.token?.priceUSD);
    return amt > 0 && dec >= 0 && px > 0 ? (amt / 10 ** dec) * px : 0;
  };
  return { usd: Math.max(leg(j.sending), leg(j.receiving)) };
}

export async function recordTrade(userId: string, chain: string, tx: string): Promise<{ status: "credited" | "pending" | "rejected" | "duplicate"; points?: number; message: string }> {
  const isSol = chain === "solana";
  const chainId = isSol ? 0 : Number(chain);
  if (isSol ? !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(tx) : !(/^0x[0-9a-fA-F]{64}$/.test(tx) && Number.isInteger(chainId) && chainId > 0)) {
    return { status: "rejected", message: "Invalid transaction." };
  }
  const key = `trade:${isSol ? tx : tx.toLowerCase()}`;
  const d = await db();
  if (await d.collection("quest_ledger").findOne({ key }, { projection: { _id: 1 } })) return { status: "duplicate", message: "Already counted." };
  const wallets = await userWallets(userId);
  const v = isSol ? await verifySolana(tx, wallets.sol) : await verifyEvm(tx, chainId, wallets.evm);
  if ("pending" in v) return { status: "pending", message: "Still confirming. We'll count it shortly." };
  if ("error" in v) return { status: "rejected", message: v.error };
  if (v.usd < QUEST_RULES.minTradeUsd) return { status: "rejected", message: `Trades under $${QUEST_RULES.minTradeUsd} don't earn points.` };

  // daily cap (UTC day)
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const [today] = await d.collection("quest_ledger").aggregate<{ s: number }>([
    { $match: { userId, kind: "trade", at: { $gte: dayStart } } },
    { $group: { _id: null, s: { $sum: "$pts" } } },
  ]).toArray();
  const room = Math.max(0, QUEST_RULES.dailyTradeCap - (today?.s ?? 0));
  const pts = Math.min(room, Math.floor(v.usd * QUEST_RULES.tradePointsPerUsd));
  const meta = { chain, usd: Math.round(v.usd * 100) / 100 };
  if (pts <= 0) {
    // still remember the trade so it can't be replayed tomorrow
    await d.collection("quest_ledger").insertOne({ userId, kind: "trade", pts: 0, key, meta: { ...meta, capped: true }, at: new Date() }).catch(() => undefined);
    return { status: "credited", points: 0, message: "You hit today's trade points cap. Trades count again tomorrow (UTC)." };
  }
  const ok = await award(userId, "trade", pts, key, meta);
  if (!ok) return { status: "duplicate", message: "Already counted." };

  const me = await getQuestProfile(userId);
  const first = !me.tasks.first_trade;
  if (first) await markTask(userId, "first_trade", QUEST_RULES.firstTradeBonus);
  if (me.referredBy) {
    await award(me.referredBy, "referral", pts * QUEST_RULES.referralShare, `ref:${key}`, { from: userId });
    if (first) {
      const got = await award(me.referredBy, "referral", QUEST_RULES.referralFirstTradeBonus, `ref-first:${userId}`, { from: userId });
      if (got) await d.collection<QuestProfile>("quest_profiles").updateOne({ _id: me.referredBy }, { $inc: { refActive: 1 } });
    }
  }
  return { status: "credited", points: pts + (first ? QUEST_RULES.firstTradeBonus : 0), message: `+${pts} points for a $${meta.usd} trade${first ? ` and +${QUEST_RULES.firstTradeBonus} for your first trade` : ""}.` };
}

// ─── READS ───────────────────────────────────────────────────────────────────
export async function totalPoints(): Promise<number> {
  const d = await db();
  const [r] = await d.collection("quest_profiles").aggregate<{ s: number }>([{ $group: { _id: null, s: { $sum: "$points" } } }]).toArray();
  return r?.s ?? 0;
}

export async function rankOf(points: number): Promise<number> {
  const d = await db();
  return (await d.collection("quest_profiles").countDocuments({ points: { $gt: points } })) + 1;
}

export async function leaderboard(limit = 25): Promise<{ userId: string; points: number; name: string; username: string | null; avatar: string }[]> {
  const d = await db();
  const rows = await d.collection<QuestProfile>("quest_profiles").find({ points: { $gt: 0 } }, { projection: { points: 1 } }).sort({ points: -1 }).limit(limit).toArray();
  const profiles = await d.collection("profiles").find({ userId: { $in: rows.map((r) => r._id) } }, { projection: { userId: 1, displayName: 1, username: 1, avatarUrl: 1 } }).toArray();
  const byId = new Map(profiles.map((p) => [String(p.userId), p]));
  return rows.map((r) => {
    const p = byId.get(r._id);
    return {
      userId: r._id,
      points: r.points,
      name: (typeof p?.displayName === "string" && p.displayName) || (typeof p?.username === "string" && p.username) || "Wraith trader",
      username: typeof p?.username === "string" ? p.username : null,
      avatar: typeof p?.avatarUrl === "string" && p.avatarUrl.startsWith("https://") ? p.avatarUrl : "",
    };
  });
}

export async function recentActivity(userId: string, limit = 20) {
  const d = await db();
  return d.collection("quest_ledger").find({ userId, pts: { $gt: 0 } }, { projection: { _id: 0, kind: 1, pts: 1, meta: 1, at: 1 } }).sort({ at: -1 }).limit(limit).toArray();
}

// The owner check behind /app/admin, the bug review page and every admin API. It fails closed: with neither variable set, nobody
// is an admin. QUESTS_ADMIN_EMAILS = the owner's sign-in email(s); QUESTS_ADMIN_USER_IDS = account ids. Both comma separated.
// The email comes from the account record the server made from Privy's verified sign-in, never from anything the browser sends.
export function isQuestAdmin(userId: string, email: string | null | undefined): boolean {
  const ids = (process.env.QUESTS_ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const emails = (process.env.QUESTS_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ids.includes(userId) || (!!email && emails.includes(email.toLowerCase()));
}
