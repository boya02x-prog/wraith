"use client";

import { useMemo, useState } from "react";
import Radar from "@/components/Radar";
import { DAY_MS, computeTraderStats, fmtHold, type StatTrade } from "@/lib/traderStats";

/** "Statistics" panel: strengths radar and a stat list. 7D / All time switch. */
export default function TraderStats({
  trades,
  money,
  title = "Statistics",
}: {
  trades: StatTrade[];
  money: (sol: number, signed?: boolean) => string;
  title?: string;
}) {
  const [range, setRange] = useState<"7d" | "all">("all");
  const s = useMemo(() => computeTraderStats(trades, { sinceMs: range === "7d" ? 7 * DAY_MS : undefined }), [trades, range]);
  const g = (v: number) => ({ cls: v > 0 ? "up" : v < 0 ? "down" : "", txt: money(v, true) });
  const gains = [
    { k: "24H", ...g(s.pnlSol.d1) },
    { k: "7D", ...g(s.pnlSol.d7) },
    { k: "30D", ...g(s.pnlSol.d30) },
  ];

  return (
    <section className="ts-panel" aria-label={title}>
      <div className="ts-head">
        <div>
          <span className="profile-eyebrow">TRADING PROFILE</span>
          <h2 className="ts-title">{title}</h2>
        </div>
        <div className="ts-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={range === "7d"} className={range === "7d" ? "on" : ""} onClick={() => setRange("7d")}>7D</button>
          <button type="button" role="tab" aria-selected={range === "all"} className={range === "all" ? "on" : ""} onClick={() => setRange("all")}>All time</button>
        </div>
      </div>

      <div className="ts-gains">
        {gains.map((x) => (
          <div key={x.k}>
            <small>{x.k}</small>
            <b className={x.cls}>{x.txt}</b>
          </div>
        ))}
      </div>

      {s.tags.length > 0 && (
        <div className="ts-tags">
          {s.tags.map((t) => (
            <span key={t} title={t === "Unrated" ? "Needs at least 3 closed trades to be rated" : undefined}>{t}</span>
          ))}
        </div>
      )}

      <div className="ts-body">
        <div className="ts-radar">
          <Radar values={s.radar.map((p) => p.value)} labels={s.radar.map((p) => p.label)} size={250} showLabels />
        </div>
        <dl className="ts-list">
          <div><dt>Biggest win</dt><dd className="up">{s.bestPct > 0 ? `+${s.bestPct.toFixed(0)}%` : "-"}</dd></div>
          <div><dt>Avg win</dt><dd className="up">{s.wins ? `+${s.avgWinPct.toFixed(0)}%` : "-"}</dd></div>
          <div><dt>Avg loss</dt><dd className="down">{s.losses ? `-${s.avgLossPct.toFixed(0)}%` : "-"}</dd></div>
          <div><dt>Wins / losses</dt><dd>{s.wins} / {s.losses}</dd></div>
          <div><dt>Longest streak</dt><dd>{s.streak || "-"}</dd></div>
          <div title={s.holdSamples ? `${s.holdSamples} trades measured` : "Hold time is tracked on trades closed from now on"}>
            <dt>Avg hold</dt>
            <dd>{fmtHold(s.avgHoldMs)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
