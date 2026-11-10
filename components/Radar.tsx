"use client";

import { useId } from "react";

/** Hexagon "skill fingerprint". Pure SVG, orange fill, optional axis labels. */
export default function Radar({
  values,
  labels,
  size = 120,
  showLabels = false,
  className,
}: {
  values: number[];
  labels?: string[];
  size?: number;
  showLabels?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const n = values.length;
  const c = size / 2;
  const r = showLabels ? size * 0.3 : size * 0.42;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, k: number) => [c + Math.cos(ang(i)) * r * k, c + Math.sin(ang(i)) * r * k] as const;
  const ring = (k: number) => Array.from({ length: n }, (_, i) => pt(i, k).join(",")).join(" ");
  const poly = values.map((v, i) => pt(i, Math.max(0.04, Math.min(1, v / 100))).join(",")).join(" ");
  const has = values.some((v) => v > 0);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={`wr-radar${has ? "" : " is-empty"}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label="Trader strengths"
    >
      <defs>
        <linearGradient id={`rg-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ff9a5c" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#f26a35" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {[1, 0.66, 0.33].map((k) => (
        <polygon key={k} points={ring(k)} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" />
      ))}
      {values.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,.07)" strokeWidth="1" />;
      })}
      {has && <polygon points={poly} fill={`url(#rg-${id})`} stroke="#f26a35" strokeWidth="1.5" strokeLinejoin="round" />}
      {has &&
        values.map((v, i) => {
          const [x, y] = pt(i, Math.max(0.04, Math.min(1, v / 100)));
          return <circle key={i} cx={x} cy={y} r={size > 100 ? 2.6 : 1.8} fill="#f26a35" />;
        })}
      {showLabels &&
        labels?.map((l, i) => {
          const [x, y] = pt(i, 1.28);
          const anchor = Math.abs(x - c) < 4 ? "middle" : x > c ? "start" : "end";
          return (
            <text key={l} x={x} y={y + 3} textAnchor={anchor} className="wr-radar-label">
              {l}
            </text>
          );
        })}
    </svg>
  );
}
