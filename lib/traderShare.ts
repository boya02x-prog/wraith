// lib/traderShare.ts  (pure)
// What the share studio needs from ANOTHER trader's public profile. Their wallet balance is private, so there is no portfolio value to show:
// the Profit card is built from their closed trades and open positions (the same sums the profile page uses for your own card), and the Bio card's
// big number is their win rate. Sizes are SOL; `perSol` turns SOL into the viewer's display currency.
export type PubTrade = { amountSol?: number; pnlPct?: number; ts?: number; closedAt?: number };
export type PubPos = { amountSol?: number; currentPnlPct?: number; ts?: number };

export function traderShareData(closed: PubTrade[], open: PubPos[], perSol: number) {
  const trades: { ts: number; usd: number }[] = []; // realized profit or loss of each closed trade, at the time it closed
  const volumeItems: { ts: number; usd: number }[] = []; // the size of every trade, closed or open
  let wins = 0, counted = 0;
  for (const t of closed) {
    const size = (t.amountSol ?? 0) * perSol;
    const at = t.closedAt ?? t.ts;
    if (typeof at !== "number" || !Number.isFinite(size) || size <= 0) continue;
    if (typeof t.pnlPct === "number" && Number.isFinite(t.pnlPct)) {
      trades.push({ ts: at, usd: size * (t.pnlPct / 100) });
      counted++;
      if (t.pnlPct > 0) wins++;
    }
    volumeItems.push({ ts: at, usd: size });
  }
  let unrealized = 0; // profit or loss on positions still open right now
  for (const p of open) {
    const size = (p.amountSol ?? 0) * perSol;
    if (!(size > 0)) continue;
    const pct = typeof p.currentPnlPct === "number" && Number.isFinite(p.currentPnlPct) ? p.currentPnlPct : 0;
    unrealized += size * (pct / 100);
    if (typeof p.ts === "number") volumeItems.push({ ts: p.ts, usd: size });
  }
  const winRate = counted ? Math.round((wins / counted) * 100) : null;
  return {
    trades,
    volumeItems,
    unrealized,
    winRate,
    closedCount: counted,
    /** the Bio card's headline */
    bioBig: winRate === null
      ? { text: "—", caption: "No closed trades yet" }
      : { text: `${winRate}%`, caption: `Win rate · ${counted} trade${counted === 1 ? "" : "s"}` },
  };
}
