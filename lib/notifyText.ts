// lib/notifyText.ts  (pure: used by the phone push on the server AND the in-app bell in the browser)
//
// One place that decides what every notification says, so the push on your phone and the entry in the bell are always the same
// words with the same emoji. Add a new kind of notification here first.
//
//   📣 New call          Wraith's scanner flagged a token
//   🏆 Win               a call reached 2x, 3x, 5x, 10x ...
//   🟢 Buy / 💰 / 🔴     a trader you follow bought, or sold (profit / loss)
//   💬 Intel             someone you follow posted intel
//   📈 / 📉 Saved token  a token you saved moved 25% or more

export const WIN_LADDER = [2, 3, 5, 10, 25, 50, 100, 250, 500, 1000];
export const winMilestone = (x: number) => [...WIN_LADDER].reverse().find((m) => x >= m) ?? 0;

export type NotifyKind = "call" | "win" | "trade" | "intel" | "saved";
export interface NotifyText { title: string; body: string }

/** $1.2K, $34.5M ... */
export function compactUsd(n?: number | null): string {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

const sym = (s?: string | null) => (s ? `$${s}` : "a token");

export function callText(o: { symbol: string; mcap?: number | null; score: number }): NotifyText {
  return { title: `📣 New call: $${o.symbol}`, body: `Spotted at ${compactUsd(o.mcap)} · score ${Math.round(o.score)}` };
}

export function winText(o: { symbol: string; milestone: number; x: number; nowMcap?: number | null }): NotifyText {
  return { title: `🏆 $${o.symbol} hit ${o.milestone}x`, body: `${o.x.toFixed(2)}x from the call${o.nowMcap ? ` · now ${compactUsd(o.nowMcap)}` : ""}` };
}

export function tradeText(o: { name?: string | null; type: "open" | "closed"; symbol?: string | null; entryMcap?: number | null; pnlPct?: number | null }): NotifyText {
  const who = o.name || "A trader you follow";
  if (o.type === "open") return { title: `🟢 ${who} bought ${sym(o.symbol)}`, body: `In at ${compactUsd(o.entryMcap)} market cap` };
  const pnl = o.pnlPct ?? 0;
  return { title: `${pnl >= 0 ? "💰" : "🔴"} ${who} sold ${sym(o.symbol)}`, body: `${pnl >= 0 ? "+" : ""}${Math.round(pnl)}% result` };
}

export function intelText(o: { name?: string | null; text?: string | null }): NotifyText {
  return { title: `💬 ${o.name || "Someone you follow"} posted intel`, body: (o.text ?? "").slice(0, 110) };
}

export function savedText(o: { symbol: string; move: number }): NotifyText {
  const pct = Math.abs(Math.round(o.move * 100));
  return { title: `${o.move > 0 ? "📈" : "📉"} $${o.symbol} is ${o.move > 0 ? "up" : "down"} ${pct}%`, body: "A token you saved just moved" };
}

export const TEST_TEXT: NotifyText = {
  title: "🔔 Wraith notifications are on",
  body: "You will get 📣 new calls, 🏆 wins, trader buys and sells, 💬 intel and 📈 saved-token moves here.",
};
