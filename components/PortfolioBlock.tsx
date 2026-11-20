"use client";

// The balance at the top of someone's profile, the way a wallet app shows who you are looking at: the portfolio value in big type, how it moved
// over 24h / 7d / 30d with a chart, the cash, and the tokens they hold. It only appears when the trader chose to show it (Edit profile > Show my
// balance); otherwise a quiet line says it is private. Data: /api/traders/<id>/portfolio (Solana wallets only for now).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";

type Pos = { mint: string; symbol: string; image: string | null; amount: number; usd: number };
type Data = { enabled: boolean; isSelf?: boolean; totalUsd?: number; cashUsd?: number; positions?: Pos[]; series?: { t: number; usd: number }[] };
const PERIODS = [["24h", 86_400_000], ["7d", 7 * 86_400_000], ["30d", 30 * 86_400_000]] as const;

const amountText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n >= 1 ? n.toFixed(2) : n.toPrecision(2));

function Line({ pts, up }: { pts: { t: number; usd: number }[]; up: boolean }) {
  const W = 320, H = 96, P = 6;
  const lo = Math.min(...pts.map((p) => p.usd)), hi = Math.max(...pts.map((p) => p.usd));
  const span = hi - lo || hi || 1, t0 = pts[0].t, tN = pts[pts.length - 1].t || t0 + 1;
  const xy = pts.map((p) => [((p.t - t0) / (tN - t0 || 1)) * W, P + (1 - (p.usd - lo) / span) * (H - P * 2)] as const);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className={`pf-chart ${up ? "up" : "down"}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="area" d={`${d} L${W} ${H} L0 ${H} Z`} />
      <path className="line" d={d} />
      <circle className="dot" cx={lx} cy={ly} r="4" />
    </svg>
  );
}

export default function PortfolioBlock({ userId, fmt }: { userId: string; fmt: (usd: number) => string }) {
  // the answer is remembered together with the trader it belongs to and the time it arrived (so nothing impure runs while drawing)
  const [res, setRes] = useState<{ id: string; data: Data; at: number } | null>(null);
  const data = res && res.id === userId ? res.data : null;
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("24h");
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    const done = (d: Data) => { if (alive) setRes({ id: userId, data: d, at: Date.now() }); };
    fetch(`/api/traders/${encodeURIComponent(userId)}/portfolio`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: Data) => done(d))
      .catch(() => done({ enabled: false }));
    return () => { alive = false; };
  }, [userId]);

  const view = useMemo(() => {
    if (!data?.enabled) return null;
    const ms = PERIODS.find((p) => p[0] === period)![1];
    const now = res?.at ?? 0;
    const total = data.totalUsd ?? 0;
    const pts = [...(data.series ?? []).filter((p) => p.t >= now - ms), { t: now, usd: total }];
    const enough = pts.length >= 3 && pts[pts.length - 1].t - pts[0].t >= ms * 0.3;
    const change = enough ? total - pts[0].usd : null;
    const pct = enough && pts[0].usd > 0 ? (change! / pts[0].usd) * 100 : null;
    return { pts, enough, change, pct, total };
  }, [data, res, period]);

  if (data === null) return <div className="pf pf-skel" aria-busy="true" />;
  if (!data.enabled) {
    return <div className="pf-private"><Lock size={14} aria-hidden="true" /> This trader keeps their balance private.</div>;
  }
  const positions = data.positions ?? [];
  const shown = all ? positions : positions.slice(0, 8);
  const up = (view?.change ?? 0) >= 0;
  return (
    <section className="pf" aria-label="Portfolio">
      <div className="pf-head">
        <div className="pf-big">
          <strong>{fmt(view?.total ?? 0)}</strong>
          {view?.change != null
            ? <span className={up ? "up" : "down"}>{up ? "+" : "−"}{fmt(Math.abs(view.change))}{view.pct != null ? ` (${up ? "+" : "−"}${Math.abs(view.pct).toFixed(1)}%)` : ""} <em>{period}</em></span>
            : <span className="mut">{period} change fills in as Wraith checks this balance</span>}
        </div>
        <div className="pf-tabs" role="tablist" aria-label="Period">
          {PERIODS.map(([k]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{k}</button>)}
        </div>
      </div>
      {view?.enough ? <Line pts={view.pts} up={up} /> : <div className="pf-empty">The chart appears as the balance is checked over the next hours and days.</div>}

      <div className="pf-cash"><span className="ico">$</span><div><small>Total cash</small><b>{fmt(data.cashUsd ?? 0)}</b></div></div>

      <div className="pf-posthead"><h3>Positions <em>{positions.length}</em></h3></div>
      {positions.length === 0 ? (
        <p className="pf-none">No tokens held right now.</p>
      ) : (
        <ul className="pf-list">
          {shown.map((p) => (
            <li key={p.mint}>
              <Link href={`/app/token/${encodeURIComponent(p.mint)}`} className="pf-row">
                <TokenIcon contractAddress={p.mint} imageUrl={p.image ?? undefined} symbol={p.symbol} size={38} />
                <span className="n"><b>{p.symbol}</b><small>{amountText(p.amount)}</small></span>
                <strong>{fmt(p.usd)}</strong>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {positions.length > 8 && <button type="button" className="pf-more" onClick={() => setAll((v) => !v)}>{all ? "Show less" : `Show all ${positions.length}`}</button>}
    </section>
  );
}
