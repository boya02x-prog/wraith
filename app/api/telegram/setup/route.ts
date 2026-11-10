// GET /api/telegram/setup?key=<TELEGRAM_SETUP_KEY>[&url=https://your-domain]
// One-time: points the bot webhook at /api/telegram/bot, registers the command menu, name and description.
import { NextRequest, NextResponse } from "next/server";
import { APP_URL } from "@/lib/telegramUi";
import { sameSecret, webhookSecret } from "@/lib/telegramSecret";

export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const key = process.env.TELEGRAM_SETUP_KEY;
  if (!token || !key) return NextResponse.json({ error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_SETUP_KEY" }, { status: 503 });
  if (!sameSecret(req.nextUrl.searchParams.get("key") ?? "", key)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const base = (req.nextUrl.searchParams.get("url") || APP_URL).replace(/\/$/, "");
  const api = (m: string, body: unknown) =>
    fetch(`https://api.telegram.org/bot${token}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  // ?invite=1 creates the join-REQUEST link for the private holders room (TELEGRAM_VIP_CHAT_ID). Share only this link.
  if (req.nextUrl.searchParams.get("invite") === "1") {
    const vip = process.env.TELEGRAM_VIP_CHAT_ID;
    if (!vip) return NextResponse.json({ error: "Set TELEGRAM_VIP_CHAT_ID to the private group's id first" }, { status: 400 });
    return NextResponse.json(await api("createChatInviteLink", { chat_id: vip, name: "Wraith holders gate", creates_join_request: true }));
  }
  const out = {
    webhook: await api("setWebhook", { url: `${base}/api/telegram/bot`, allowed_updates: ["message", "callback_query", "chat_join_request"], secret_token: webhookSecret() }),
    commands: await api("setMyCommands", {
      commands: [
        { command: "start", description: "Set up Wraith alerts" },
        { command: "top", description: "Best live signals right now" },
        { command: "wins", description: "Call record and best performers" },
        { command: "token", description: "Full read on any token address" },
        { command: "settings", description: "Chains, min score, quiet mode" },
        { command: "mute", description: "Quiet mode: 1h, 8h or off" },
        { command: "status", description: "Is this chat linked?" },
                { command: "help", description: "Alert types and commands" },
        { command: "unlink", description: "Stop alerts to this chat" },
      ],
    }),
    description: await api("setMyDescription", { description: "Live Wraith scanner signals and wins, across Solana, Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain. Press Start." }),
    short: await api("setMyShortDescription", { short_description: "Live multi-chain signals and wins from Wraith" }),
  };
  return NextResponse.json(out);
}
