// Local-only: lets the Wraith bot work on localhost without a public URL.
// Polls Telegram and forwards each update to your running dev server (/api/telegram/bot).
// Run:  node scripts/telegram-poll.mjs      (keep `npm run dev` running in another terminal)
// NOTE: this removes the bot's webhook. Don't run it if the bot is already live on a deployed site.
import { readFileSync } from "node:fs";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* fall back to process.env */ }
const TOKEN = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const SECRET = env.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
const TARGET = process.env.TARGET || "http://localhost:3000/api/telegram/bot";
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN missing in .env.local"); process.exit(1); }

const api = (m, body) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

await api("deleteWebhook", { drop_pending_updates: false });
await api("setMyCommands", { commands: [
  { command: "start", description: "Set up Wraith alerts" },
  { command: "top", description: "Best live signals right now" },
        { command: "wins", description: "Call record and best performers" },
        { command: "token", description: "Full read on any token address" },
        { command: "settings", description: "Chains, min score, quiet mode" },
        { command: "mute", description: "Quiet mode: 1h, 8h or off" },
        { command: "status", description: "Is this chat linked?" },
  { command: "help", description: "Alert types and commands" },
  { command: "unlink", description: "Stop alerts to this chat" },
] });
console.log(`Polling Telegram → ${TARGET}  (Ctrl+C to stop)`);

let offset = 0;
for (;;) {
  try {
    const r = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
    if (!r.ok) { console.error("getUpdates:", r.description); await new Promise((s) => setTimeout(s, 3000)); continue; }
    for (const u of r.result) {
      offset = u.update_id + 1;
      try {
        const res = await fetch(TARGET, { method: "POST", headers: { "Content-Type": "application/json", ...(SECRET ? { "x-telegram-bot-api-secret-token": SECRET } : {}) }, body: JSON.stringify(u) });
        console.log(u.message?.text ?? "(update)", "→", res.status);
      } catch (e) { console.error("forward failed (is `npm run dev` running?):", e.message); }
    }
  } catch (e) { console.error(e.message); await new Promise((s) => setTimeout(s, 3000)); }
}
