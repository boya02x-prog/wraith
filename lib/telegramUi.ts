// Shared Telegram look & feel for the Wraith bot: one header style, chain-aware links, inline buttons.
import { CHAINS } from "@/lib/chains";

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.wraith.farm").replace(/\/$/, "");
export const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "wraithscan_bot";
const RULE = "━━━━━━━━━━━━━━━━";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function fmtUsd(n?: number | null) {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function scoreBar(score: number) {
  const f = Math.max(0, Math.min(10, Math.round(score / 10)));
  return "▰".repeat(f) + "▱".repeat(10 - f);
}

export const chainName = (k?: string) => (!k || k === "solana" ? "Solana" : CHAINS[k]?.name ?? k);

const DEX_SLUG: Record<string, string> = { solana: "solana", ethereum: "ethereum", base: "base", bsc: "bsc", monad: "monad", arc: "arc", robinhood: "robinhood" };

export function tokenLinks(ca: string, chain = "solana") {
  const c = chain.toLowerCase();
  const app = `${APP_URL}/app/token/${ca}${c === "solana" ? "" : `?chain=${c}`}`;
  const dex = `https://dexscreener.com/${DEX_SLUG[c] ?? c}/${ca}`;
  const explorer = c === "solana" ? `https://solscan.io/token/${ca}` : `${CHAINS[c]?.explorer ?? ""}/token/${ca}`;
  const swap = c === "solana" ? `https://jup.ag/swap/SOL-${ca}` : null;
  const pump = c === "solana" ? `https://pump.fun/${ca}` : null;
  return { app, dex, explorer, swap, pump };
}

type Button = { text: string; url: string };
export function openKeyboard(rows: { text: string; url: string }[][]) { return { inline_keyboard: rows }; }

export function tokenKeyboard(ca: string, chain = "solana") {
  const l = tokenLinks(ca, chain);
  const row1: Button[] = [{ text: "👻 Open in Wraith", url: l.app }];
  const row2: Button[] = [{ text: "📊 Chart", url: l.dex }, { text: "🔎 Explorer", url: l.explorer }];
  if (l.swap) row2.push({ text: "⚡ Swap", url: l.swap });
  return { inline_keyboard: [row1, row2] };
}

export function header(emoji: string, title: string, symbol: string, chain?: string, name?: string) {
  const sub = [name && name !== symbol ? esc(name) : "", chainName(chain)].filter(Boolean).join("  ·  ");
  return `${emoji} <b>${title}</b>\n<b>$${esc(symbol.toUpperCase())}</b>  <i>${sub}</i>\n${RULE}`;
}
export const rule = RULE;
export const footer = `<i>Wraith · research, not financial advice</i>`;
