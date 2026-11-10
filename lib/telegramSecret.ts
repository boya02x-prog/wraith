// The secret Telegram sends back in the x-telegram-bot-api-secret-token header of every webhook call. It proves a request really
// came from Telegram. TELEGRAM_WEBHOOK_SECRET wins when set; otherwise one is derived from the bot token, so the webhook is
// authenticated even when nobody remembered to create a separate variable (an open webhook lets anyone forge bot updates).
import { createHmac, timingSafeEqual } from "node:crypto";

export function webhookSecret(): string | null {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (explicit) return explicit;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  // hex only: Telegram accepts A-Z a-z 0-9 _ - and 1 to 256 characters
  return createHmac("sha256", token).update("wraith-telegram-webhook").digest("hex").slice(0, 48);
}

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
