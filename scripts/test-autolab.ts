// Checks the auto-trader lab rules on made-up price moves (no database writes). Run: MONGODB_URI=mongodb://127.0.0.1:27017/none npx tsx scripts/test-autolab.ts
import { evaluateTrade, netOf } from "../lib/autoLab";
const now = 1_000_000_000_000, min = 60_000;
const o = (style: "scalp" | "day" | "long", ageMin = 5, peak = 100) => ({ style, openedAt: now - ageMin * min, entryMcap: 100, peak });
const c = (price: number, extra: Record<string, unknown> = {}) => ({ lastMcap: price, lastCheck: now - 30_000, peakMcap: price, rugged: false, ...extra });
const t = (name: string, got: { reason: string | null; exit: number }, wantReason: string | null, wantExit?: number) => {
  const ok = got.reason === wantReason && (wantExit === undefined || Math.abs(got.exit - wantExit) < 1e-6);
  console.log(ok ? "PASS" : "FAIL", name.padEnd(62), "->", got.reason, got.exit.toFixed(1));
  if (!ok) process.exitCode = 1;
};
t("scalp: +31% hits the +30% target, sells at the target level", evaluateTrade(o("scalp"), c(131), now), "tp", 130);
t("scalp: -12% hits the -10% stop, sells at the price seen", evaluateTrade(o("scalp"), c(88), now), "stop", 88);
t("scalp: peaked +15% then fell to +3% (trail 10%)", evaluateTrade(o("scalp", 5, 115), c(103), now), "trail", 103);
t("scalp: +5%, nothing happens yet", evaluateTrade(o("scalp"), c(105), now), null);
t("scalp: 125 minutes old, flat -> time exit", evaluateTrade(o("scalp", 125), c(101), now), "time", 101);
t("scalp: stop beats target when both happened (cautious)", evaluateTrade(o("scalp", 5, 100), c(85, { peakMcap: 140, peakAt: now - min }), now), "stop", 85);
t("scalp: peak after opening above target, price back down at +20% -> target (resting order)", evaluateTrade(o("scalp"), c(120, { peakMcap: 135, peakAt: now - min }), now), "tp", 130);
t("day: +60% then back to +18% (trail 25% from +60% = +20%)", evaluateTrade(o("day", 60, 160), c(118), now), "trail", 118);
t("day: +90%, still running", evaluateTrade(o("day", 60), c(190), now), null);
t("day: +105% -> target +100%", evaluateTrade(o("day", 60), c(205), now), "tp", 200);
t("long: +300% then -35% from the top -> trail", evaluateTrade(o("long", 600, 400), c(255), now), "trail", 255);
t("long: -40% -> stop", evaluateTrade(o("long", 600), c(60), now), "stop", 60);
t("token vanished from the price source -> total loss", evaluateTrade(o("scalp"), c(0, { rugged: true }), now), "rug", 5);
t("price data older than 6h -> do nothing", evaluateTrade(o("scalp"), c(80, { lastCheck: now - 7 * 3_600_000 }), now), null);
// the money: +30% target after 1.5% in and 3% out
const win = netOf(100, 130, false), stopped = netOf(100, 90, true);
console.log("target trade net:", (win * 100).toFixed(2) + "%  (130/100 * 0.97 / 1.015 - 1 = 24.236%)", " stopped at -10% net:", (stopped * 100).toFixed(2) + "%");
if (Math.abs(win - 0.24236) > 0.0001) process.exitCode = 1;
export {};
