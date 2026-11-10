"use client";

import { useId, useMemo, useState } from "react";

export type PnlTrade = { ts?: number; pnlPct?: number; amountSol?: number };
type Range = "7D" | "30D" | "ALL";

const DAY = 86_400_000;
const W = 600;
const H = 150;

function fmtSigned(n: number, unit: "SOL" | "%") {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return unit === "SOL" ? `${sign}${abs.toFixed(abs >= 10 ? 2 : 3)} SOL` : `${sign}${abs.toFixed(abs >= 100 ? 0 : 1)}%`;
}

export default function PnlChart({
  trades,
  title = "Realized P&L",
}: {
  trades: PnlTrade[];
  title?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [range, setRange] = useState<Range>("ALL");
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const now = Date.now();
    const from = range === "7D" ? now - 7 * DAY : range === "30D" ? now - 30 * DAY : 0;
    const rows = trades
      .filter((t) => typeof t.ts === "number" && typeof t.pnlPct === "number" && (t.ts as number) >= from)
      .sort((a, b) => (a.ts as number) - (b.ts as number));
    const useSol = rows.some((t) => (t.amountSol ?? 0) > 0);
    let run = 0;
    const pts = rows.map((t) => {
      run += useSol ? ((t.amountSol ?? 0) * (t.pnlPct as number)) / 100 : (t.pnlPct as number);
      return { ts: t.ts as number, v: run };
    });
    if (pts.length) pts.unshift({ ts: pts[0].ts - 1, v: 0 });
    return { pts, unit: (useSol ? "SOL" : "%") as "SOL" | "%", count: rows.length };
  }, [trades, range]);

  const chart = useMemo(() => {
    const { pts } = model;
    if (pts.length < 2) return null;
    const t0 = pts[0].ts;
    const t1 = pts[pts.length - 1].ts;
    const span = Math.max(1, t1 - t0);
    const vals = pts.map((p) => p.v);
    const min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    const rng = max - min || 1;
    const xy = pts.map((p) => ({
      x: ((p.ts - t0) / span) * W,
      y: 8 + (H - 16) - ((p.v - min) / rng) * (H - 16),
    }));
    const line = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `M0,${H} L${line.replace(/ /g, " L")} L${W},${H} Z`;
    const zeroY = 8 + (H - 16) - ((0 - min) / rng) * (H - 16);
    return { xy, line, area, zeroY, last: pts[pts.length - 1].v };
  }, [model]);

  const total = chart?.last ?? 0;
  const positive = total >= 0;
  const active = hover !== null && chart ? hover : chart ? chart.xy.length - 1 : null;
  const shown = active !== null && chart ? model.pts[active] : null;

  return (
    <section className="pnlc">
      <div className="pnlc-head">
        <div>
          <span className="pnlc-label">{title}</span>
          <strong className={`pnlc-value${chart ? (positive ? " pos" : " neg") : ""}`}>
            {chart && shown ? fmtSigned(shown.v, model.unit) : model.unit === "SOL" ? "0.00 SOL" : "—"}
          </strong>
          <small>
            {chart
              ? hover !== null && shown
                ? new Date(shown.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : `${model.count} closed trade${model.count === 1 ? "" : "s"}`
              : "No closed trades in this range yet"}
          </small>
        </div>
        <div className="wx-seg sm" role="tablist" aria-label="Range">
          {(["7D", "30D", "ALL"] as Range[]).map((r) => (
            <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => setRange(r)}>
              {r === "ALL" ? "All" : r}
            </button>
          ))}
        </div>
      </div>

      <div
        className="pnlc-plot"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!chart) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          let best = 0;
          let bestD = Infinity;
          chart.xy.forEach((p, i) => {
            const d = Math.abs(p.x / W - frac);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          setHover(best);
        }}
      >
        {chart ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? "#22c55e" : "#ef4444"} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={positive ? "#22c55e" : "#ef4444"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" x2={W} y1={chart.zeroY} y2={chart.zeroY} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              <path d={chart.area} fill={`url(#g${gid})`} />
              <polyline
                points={chart.line}
                fill="none"
                stroke={positive ? "#22c55e" : "#ef4444"}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {active !== null && (
              <>
                <i className="pnlc-cursor" style={{ left: `${(chart.xy[active].x / W) * 100}%` }} />
                <i
                  className={`pnlc-dot${positive ? " pos" : " neg"}`}
                  style={{ left: `${(chart.xy[active].x / W) * 100}%`, top: `${(chart.xy[active].y / H) * 100}%` }}
                />
              </>
            )}
          </>
        ) : (
          <div className="pnlc-empty">
            <i />
          </div>
        )}
      </div>
    </section>
  );
}
