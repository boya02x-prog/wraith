"use client";

import { useMemo } from "react";

export type CalTrade = { ts?: number; pnlPct?: number; amountSol?: number };

const DAY = 86_400_000;
const WEEKS = 18;

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export default function PnlCalendar({ trades }: { trades: CalTrade[] }) {
  const model = useMemo(() => {
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const t of trades) {
      if (typeof t.ts !== "number" || typeof t.pnlPct !== "number") continue;
      const k = dayKey(t.ts);
      const cur = byDay.get(k) ?? { sum: 0, n: 0 };
      cur.sum += t.pnlPct;
      cur.n += 1;
      byDay.set(k, cur);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - ((WEEKS - 1) * 7 + today.getDay()) * DAY);
    const cells: { date: Date; v: number | null; n: number; future: boolean }[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const date = new Date(start.getTime() + i * DAY);
      const rec = byDay.get(dayKey(date.getTime()));
      cells.push({ date, v: rec ? rec.sum : null, n: rec?.n ?? 0, future: date.getTime() > today.getTime() });
    }
    const active = cells.filter((c) => c.v !== null);
    const green = active.filter((c) => (c.v as number) > 0).length;
    const red = active.filter((c) => (c.v as number) < 0).length;
    let streak = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      if (c.future) continue;
      if (c.v === null) {
        if (streak === 0 && c.date.getTime() === today.getTime()) continue;
        break;
      }
      if ((c.v as number) > 0) streak++;
      else break;
    }
    const maxAbs = Math.max(1, ...active.map((c) => Math.abs(c.v as number)));
    const best = active.reduce<null | { v: number; date: Date }>(
      (a, c) => (!a || (c.v as number) > a.v ? { v: c.v as number, date: c.date } : a),
      null,
    );
    return { cells, green, red, streak, maxAbs, best, activeDays: active.length };
  }, [trades]);

  return (
    <section className="pcal">
      <div className="pcal-head">
        <div>
          <span className="profile-eyebrow">TRADING CALENDAR</span>
          <small>Daily realized result · last {WEEKS} weeks</small>
        </div>
        <div className="pcal-stats">
          <span><b className="pos">{model.green}</b> green</span>
          <span><b className="neg">{model.red}</b> red</span>
          <span><b>{model.streak}</b> day streak</span>
          {model.best && <span>best <b className="pos">+{model.best.v.toFixed(0)}%</b></span>}
        </div>
      </div>
      <div className="pcal-grid" role="img" aria-label="Daily realized profit and loss calendar">
        {model.cells.map((c, i) => {
          const a = c.v === null ? 0 : Math.min(1, 0.25 + (Math.abs(c.v) / model.maxAbs) * 0.75);
          const bg =
            c.v === null || c.future
              ? undefined
              : c.v >= 0
                ? `rgba(34,197,94,${a.toFixed(2)})`
                : `rgba(239,68,68,${a.toFixed(2)})`;
          return (
            <i
              key={i}
              className={`pcal-cell${c.future ? " future" : ""}`}
              style={bg ? { background: bg } : undefined}
              title={`${c.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}${c.v === null ? " · no closed trades" : ` · ${c.v >= 0 ? "+" : ""}${c.v.toFixed(1)}% · ${c.n} trade${c.n === 1 ? "" : "s"}`}`}
            />
          );
        })}
      </div>
      {model.activeDays === 0 && <p className="pcal-empty">Close a trade and your days fill in here.</p>}
    </section>
  );
}
