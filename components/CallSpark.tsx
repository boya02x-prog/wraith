"use client";

// A small price chart from the moment a call was posted until now, drawn under the token in the Intel feed, so a call can be judged at a glance:
// a dashed line marks the price at the call, the line is green above it and red below it, and it draws itself in from left to right.
// It loads only when the card is near the screen (a feed has many cards), reuses the chart route the token page uses, and says so quietly when
// there is no chart (a brand-new token, another chain).
import { useEffect, useId, useRef, useState } from "react";
import { SOLANA_MINT_RE } from "@/lib/market";

type Pt = { t: number; c: number };
const memo = new Map<string, { at: number; pts: Pt[] }>();
const MAX_PTS = 64;

function cut(all: Pt[], since: number, stepMs: number): Pt[] {
  const from = since - stepMs * 2;
  const rows = all.filter((p) => p.t >= from && Number.isFinite(p.c) && p.c > 0);
  if (rows.length <= MAX_PTS) return rows;
  const out: Pt[] = [];
  for (let i = 0; i < MAX_PTS; i++) out.push(rows[Math.round((i / (MAX_PTS - 1)) * (rows.length - 1))]);
  return out;
}

export default function CallSpark({ mint, since }: { mint: string; since: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const host = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [pts, setPts] = useState<Pt[] | null>(null); // null = not loaded yet, [] = no chart for this token
  const solana = SOLANA_MINT_RE.test(mint);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: "240px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !solana) return;
    const age = Date.now() - since;
    const tf = age < 20 * 3600e3 ? "15m" : age < 10 * 86400e3 ? "1h" : "4h";
    const stepMs = tf === "15m" ? 900e3 : tf === "1h" ? 3600e3 : 14400e3;
    const key = `${mint}:${tf}`;
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < 60_000) { setPts(cut(hit.pts, since, stepMs)); return; }
    let alive = true;
    fetch(`/api/token-chart?mint=${encodeURIComponent(mint)}&tf=${tf}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { candles?: { t: number; c: number }[] } | null) => {
        const all = (d?.candles ?? []).map((x) => ({ t: x.t, c: x.c }));
        memo.set(key, { at: Date.now(), pts: all });
        if (alive) setPts(cut(all, since, stepMs));
      })
      .catch(() => { if (alive) setPts([]); });
    return () => { alive = false; };
  }, [near, mint, since, solana]);

  const W = 300, H = 64, PAD = 7;
  const ready = !!pts && pts.length >= 3;
  const none = !solana || (pts !== null && !ready);
  let tone = "flat";
  let svg: React.ReactNode = null;
  let dots: React.ReactNode = null;
  if (ready && pts) {
    const lo = Math.min(...pts.map((p) => p.c)), hi = Math.max(...pts.map((p) => p.c));
    const span = hi - lo || hi || 1;
    const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, PAD + (1 - (p.c - lo) / span) * (H - PAD * 2)] as const);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const [x0, y0] = xy[0], [x1, y1] = xy[xy.length - 1];
    tone = pts[pts.length - 1].c >= pts[0].c ? "up" : "down";
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--cs)", stopOpacity: 0.3 }} />
            <stop offset="1" style={{ stopColor: "var(--cs)", stopOpacity: 0 }} />
          </linearGradient>
          <clipPath id={`c${uid}`}><rect className="cs-reveal" x="0" y="-8" width={W} height={H + 16} /></clipPath>
        </defs>
        <line className="cs-base" x1="0" x2={W} y1={y0} y2={y0} />
        <g clipPath={`url(#c${uid})`}>
          <path className="cs-area" d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#g${uid})`} />
          <path className="cs-line" d={line} />
        </g>
      </svg>
    );
    // the two dots are plain elements, not SVG circles: the drawing is stretched to the width of the card, which would turn circles into ovals
    dots = (
      <>
        <i className="cs-dot call" style={{ left: `${(x0 / W) * 100}%`, top: `${(y0 / H) * 100}%` }} />
        <i className="cs-dot now" style={{ left: `${(x1 / W) * 100}%`, top: `${(y1 / H) * 100}%` }} />
      </>
    );
  }
  return (
    <span ref={host} className={`cs ${tone}${ready ? " ready" : none ? " none" : " wait"}`} aria-hidden="true">
      {svg}
      {dots}
      {none && <small>No chart yet</small>}
    </span>
  );
}
