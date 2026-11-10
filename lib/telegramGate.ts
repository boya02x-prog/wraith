// lib/telegramGate.ts (server only)
// Token-gated Telegram group. The group is private; people can only knock ("request to join" invite link). The bot approves
// a request only when that Telegram account is linked to a Wraith account holding SPECTER or WRAITH (the same rule as DM alerts),
// and a periodic sweep removes anyone whose tier has lapsed. Set TELEGRAM_VIP_CHAT_ID to the private group's id.
import { getDb } from "@/lib/mongoClient";
import { getLaunchSettings, paidTier } from "@/lib/launchSettingsServer";
import { tg } from "@/lib/telegramBot";
import { APP_URL } from "@/lib/telegramUi";

export const vipChatId = () => process.env.TELEGRAM_VIP_CHAT_ID ?? "";
// Real holders only (the beta switch does not open this room). Closed until launch control opens it.
const eligible = async (u: { tier?: unknown; tierSource?: unknown } | null | undefined) => {
  const t = await paidTier(u);
  return t === "SPECTER" || t === "WRAITH";
};

interface Member { _id: string; telegramId: string; userId?: unknown; joinedAt: Date }

/** Decide one join request. Returns what happened, for logs. */
export async function handleJoinRequest(req: { chat: { id: number | string }; from: { id: number; first_name?: string }; user_chat_id?: number }): Promise<"approved" | "declined" | "ignored"> {
  const vip = vipChatId();
  if (!vip || String(req.chat.id) !== String(vip)) return "ignored";
  const db = await getDb();
  const tgId = String(req.from.id);
  const user = await db.collection("users").findOne({ telegramChatId: tgId }, { projection: { tier: 1, tierSource: 1 } });
  const dm = req.user_chat_id ?? req.from.id;

  const roomOpen = (await getLaunchSettings()).vipRoomOpen;
  if (roomOpen && user && (await eligible(user as { tier?: unknown; tierSource?: unknown }))) {
    const ok = await tg("approveChatJoinRequest", { chat_id: req.chat.id, user_id: req.from.id });
    if (ok.ok) {
      await db.collection<Member>("tg_group_members").updateOne({ _id: tgId }, { $set: { telegramId: tgId, userId: user._id, joinedAt: new Date() } }, { upsert: true });
      await tg("sendMessage", { chat_id: dm, text: "👻 You're in. Welcome to the Wraith holders room.", parse_mode: "HTML" });
      return "approved";
    }
    return "ignored";
  }

  await tg("declineChatJoinRequest", { chat_id: req.chat.id, user_id: req.from.id });
  const why = !roomOpen
    ? "The holders room opens when <b>$OMEN</b> launches. Watch the channel for the date."
    : user
    ? "Your account is linked, but this room is for <b>SPECTER</b> and <b>WRAITH</b> holders (500,000+ OMEN)."
    : "This chat isn't linked to a Wraith account yet. In Wraith open the profile menu, choose <b>Connect Telegram</b>, then ask to join again.";
  await tg("sendMessage", {
    chat_id: dm,
    text: `👻 <b>Wraith holders room</b>\n\n${why}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "👻 Open Wraith", url: `${APP_URL}/app` }]] },
  });
  return "declined";
}

/**
 * Removes members who no longer qualify (sold OMEN, unlinked Telegram, lost whitelist). They are removed, not banned,
 * so they can knock again once they qualify. Runs at most once an hour.
 */
export async function sweepGroupMembers(): Promise<{ checked: number; removed: number } | null> {
  const vip = vipChatId();
  if (!vip) return null;
  if (!(await getLaunchSettings()).vipRoomOpen) return null;
  const db = await getDb();
  const meta = db.collection<{ _id: string; at: number }>("tg_meta");
  const last = await meta.findOne({ _id: "vip-sweep" });
  if (last && Date.now() - last.at < 55 * 60_000) return null;
  await meta.updateOne({ _id: "vip-sweep" }, { $set: { at: Date.now() } }, { upsert: true });

  const members = await db.collection<Member>("tg_group_members").find({}).limit(2000).toArray();
  let removed = 0;
  const deadline = Date.now() + 40_000;
  for (const m of members) {
    if (Date.now() > deadline) break;
    const user = await db.collection("users").findOne({ telegramChatId: m.telegramId }, { projection: { tier: 1, tierSource: 1 } });
    if (user && (await eligible(user as { tier?: unknown; tierSource?: unknown }))) continue;
    const kick = await tg("banChatMember", { chat_id: vip, user_id: Number(m.telegramId), revoke_messages: false });
    if (kick.ok || /not a member|user not found|participant/i.test(kick.description ?? "")) {
      await tg("unbanChatMember", { chat_id: vip, user_id: Number(m.telegramId), only_if_banned: true });
      await db.collection("tg_group_members").deleteOne({ _id: m.telegramId } as never);
      await tg("sendMessage", { chat_id: Number(m.telegramId), text: "👻 You were removed from the Wraith holders room because your account no longer holds SPECTER or WRAITH. Hold the tier again and you can rejoin.", parse_mode: "HTML" });
      removed++;
    }
  }
  return { checked: members.length, removed };
}
