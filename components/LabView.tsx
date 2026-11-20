"use client";
// The paper auto-trader lab's numbers, drawn the same way for the owner (admin page) and for the people the owner picked (the Auto-trader page).
import type { LabReport } from "@/lib/autoLab";

const pct = (v: number | null, d = 1) => (v === null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const usd = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
const WHY: Record<string, string> = { tp: "target", stop: "stop", trail: "trailing stop", time: "time", rug: "token vanished" };

export default function LabView({ d }: { d: LabReport }) {
  const days = d.since ? Math.max(1, Math.round((Date.now() - d.since) / 86_400_000)) : 0;
  return (
    <>
      <div className="lab-grid">
        {d.styles.map((s) => {
          const verdict = s.closed < 30 ? "Too early to say" : s.low !== null && s.low > 0 ? "Earning, range above zero" : s.high !== null && s.high < 0 ? "Losing, range below zero" : "Not proven: range includes zero";
          return (
            <div key={s.style} className="lab-card">
              <b>{s.label}</b><small>{s.blurb}</small>
              <div className={`lab-avg ${s.avg !== null && s.avg >= 0 ? "up" : "down"}`}>{pct(s.avg)}<i>average per trade</i></div>
              <div className="lab-rows">
                <span>Trades finished<b>{s.closed}</b></span>
                <span>Win rate<b>{s.closed ? `${Math.round((s.wins / s.closed) * 100)}%` : "–"}</b></span>
                <span>Typical trade<b>{pct(s.middle, 0)}</b></span>
                <span>Range of the average<b>{s.low === null ? "–" : `${pct(s.low, 0)} to ${pct(s.high, 0)}`}</b></span>
                <span>Pretend profit<b className={s.totalUsd >= 0 ? "g" : "r"}>{usd(s.totalUsd)}</b></span>
                <span>Still open<b>{s.open}</b></span>
                <span>Only the best calls (score 75+)<b>{s.top.closed ? `${pct(s.top.avg)} (${s.top.closed} trades)` : "–"}</b></span>
              </div>
              <em className="lab-verdict">{verdict}</em>
            </div>
          );
        })}
      </div>
      <p className="q-note">{d.since ? `Running for about ${days} day${days > 1 ? "s" : ""}. ` : "Waiting for the first call. "}It needs 30+ finished trades per style before a number means anything, and a range that includes zero is a coin flip minus fees. Prices are checked about every 2 minutes; a real bot would watch closer, so real results could differ either way.</p>
      {d.recent.length > 0 && (
        <div className="lab-recent">
          {d.recent.map((t, i) => <span key={i} className={t.net >= 0 ? "g" : "r"}>${t.symbol} {t.style} {pct(t.net, 0)} <i>{WHY[t.reason] ?? t.reason}</i></span>)}
        </div>
      )}
    </>
  );
}
