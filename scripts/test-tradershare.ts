// Checks how another trader's public profile becomes share-card numbers (lib/traderShare.ts). Run: npx tsx scripts/test-tradershare.ts
import { traderShareData } from "../lib/traderShare";

let bad = 0;
const t = (name: string, ok: boolean, extra = "") => { console.log(ok ? "PASS" : "FAIL", name.padEnd(64), extra); if (!ok) bad++; };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const now = 1_000_000_000_000;

// SOL is worth 150 in the viewer's currency
const d = traderShareData(
  [
    { amountSol: 2, pnlPct: 50, closedAt: now - 1000, ts: now - 9000 },   // +1 SOL = +150
    { amountSol: 1, pnlPct: -20, ts: now - 2000 },                        // -0.2 SOL = -30, no closedAt: uses ts
    { amountSol: 4, pnlPct: 0, closedAt: now - 3000 },                    // flat: a closed trade, not a win
    { amountSol: 0, pnlPct: 80, closedAt: now - 4000 },                   // zero size: ignored
    { amountSol: 1, pnlPct: 30 },                                         // no time: ignored
    { amountSol: 3, closedAt: now - 5000 },                               // no result yet: counts as volume only
  ],
  [
    { amountSol: 1, currentPnlPct: 10, ts: now - 100 },                   // +0.1 SOL = +15 open
    { amountSol: 2, currentPnlPct: -50, ts: now - 200 },                  // -1 SOL = -150 open
    { amountSol: 1, ts: now - 300 },                                      // no price yet: 0
  ],
  150,
);

t("realized rows: three closed trades with a result and a time", d.trades.length === 3);
t("winner is 2 SOL x 50% x 150 = +150", near(d.trades[0].usd, 150) && d.trades[0].ts === now - 1000);
t("loser uses ts when closedAt is missing: -30", near(d.trades[1].usd, -30) && d.trades[1].ts === now - 2000);
t("flat trade is realized 0", near(d.trades[2].usd, 0));
t("win rate: 1 win of 3 = 33%", d.winRate === 33 && d.closedCount === 3);
t("unrealized: +15 - 150 + 0 = -135", near(d.unrealized, -135));
t("volume counts closed (2+1+4+3 SOL) and open (1+2+1 SOL)", near(d.volumeItems.reduce((a, v) => a + v.usd, 0), (2 + 1 + 4 + 3 + 1 + 2 + 1) * 150));
t("bio headline", d.bioBig.text === "33%" && d.bioBig.caption === "Win rate · 3 trades");

const e = traderShareData([], [], 150);
t("no trades: dash and a calm caption", e.winRate === null && e.bioBig.text === "—" && e.bioBig.caption === "No closed trades yet" && e.unrealized === 0 && e.trades.length === 0);
const one = traderShareData([{ amountSol: 1, pnlPct: 10, closedAt: now }], [], 100);
t("one trade says 'trade', not 'trades'", one.bioBig.caption === "Win rate · 1 trade" && one.bioBig.text === "100%");

if (bad) { console.log(`\n${bad} FAILED`); process.exitCode = 1; } else console.log("\nall passed");
