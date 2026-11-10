"use client";
// Landing visuals driven by real data from /api/landing (the same call record the app and the bot use).
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import ChainLogo from "@/components/ChainLogo";

export interface Call { address: string; chain: string; symbol: string; imageUrl: string | null; tier: "HOT" | "WATCH"; score: number; spottedAt: number; spottedMcap: number; peakMcap: number; lastMcap: number; x: number; nowX?: number }
export interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number }
export interface TgBlock { html: string; kb?: { inline_keyboard?: { text: string }[][] } | null }
export interface LandingData {
  updatedAt: number;
  stats: { calls: number; hit2: number; rate: number };
  wins: Call[];
  recent: Call[];
  telegram: { signal: TgBlock | null; win: TgBlock | null };
  chart: { symbol: string; chain: string; spottedAt: number; spottedMcap: number; candles: Candle[] } | null;
}

export const fmtUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const TIER_COLOR = { HOT: "#ff7b3d", WATCH: "#facc15" } as const;
const ago = (t: number) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
export const xf = (x: number) => `${x >= 10 ? x.toFixed(1) : x.toFixed(2)}x`;

function Empty({ text }: { text: string }) { return <p className="lp-empty">{text}</p>; }
function Skeleton({ rows = 5 }: { rows?: number }) { return <div className="lp-skel">{Array.from({ length: rows }).map((_, i) => <i key={i} />)}</div>; }

/** Letter avatar is always there instantly; the token image fades in over it, and a broken image just leaves the letter. */
export function Coin({ c }: { c: Call }) {
  const [ok, setOk] = useState(true);
  return (
    <span className="lp-coin ph">
      {c.symbol.slice(0, 1).toUpperCase()}
      {c.imageUrl && ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="lp-ci" src={c.imageUrl} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" onLoad={(e) => e.currentTarget.classList.add("in")} onError={() => setOk(false)} />
      )}
    </span>
  );
}
const nowMult = (c: Call) => c.nowX ?? (c.spottedMcap > 0 ? c.lastMcap / c.spottedMcap : c.x);

export function Ticker({ data }: { data: LandingData | null }) {
  const items = useMemo(() => {
    const m = new Map<string, Call>();
    for (const c of [...(data?.wins ?? []), ...(data?.recent ?? [])]) m.set(c.address, c);
    return [...m.values()];
  }, [data]);
  if (!items.length) return null;
  const loop = items.length < 6 ? [...items, ...items, ...items] : items;
  const track = [...loop, ...loop];
  return (
    <div className="lp-ticker" aria-label="Recent Wraith calls">
      <span className="lp-ticker-tag">LIVE CALLS</span>
      <div className="lp-ticker-track">
        {track.map((c, i) => (
          <span key={i} className="lp-tick">
            <ChainLogo chain={c.chain} size={14} />
            <b>${c.symbol.toUpperCase()}</b>
            <i style={{ color: TIER_COLOR[c.tier], borderColor: TIER_COLOR[c.tier] }}>{c.tier}</i>
            <em style={{ color: nowMult(c) >= 1 ? "#22c55e" : "#ef4444" }}>{xf(nowMult(c))}</em>
            <small>{fmtUsd(c.spottedMcap)} → {fmtUsd(c.lastMcap)}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Hero card: the 7-day call record and the best calls. */
export function LiveBoard({ data, loading }: { data: LandingData | null; loading: boolean }) {
  const top = data?.wins.slice(0, 5) ?? [];
  return (
    <div className="lp-board">
      <div className="lp-board-head"><span><i /> Live call record</span><em>last 7 days</em></div>
      <div className="lp-board-stats">
        <div><small>Calls tracked</small><strong>{data ? data.stats.calls.toLocaleString() : "—"}</strong></div>
        <div><small>Reached 2x</small><strong>{data ? data.stats.hit2.toLocaleString() : "—"}</strong></div>
        <div><small>Hit rate</small><strong>{data && data.stats.calls ? `${data.stats.rate}%` : "—"}</strong></div>
      </div>
      <div className="lp-board-list">
        {loading && !data ? <Skeleton /> : !top.length ? <Empty text="No winning calls in the last 7 days yet." /> : top.map((c) => (
          <div key={c.address} className="lp-board-row">
            <Coin c={c} />
            <div className="nm"><b>${c.symbol.toUpperCase()}</b><span><ChainLogo chain={c.chain} size={12} /> called at {fmtUsd(c.spottedMcap)}</span></div>
            <div className="mx"><strong>{xf(nowMult(c))}</strong><span>now {fmtUsd(c.lastMcap)} · peak {fmtUsd(c.peakMcap)}</span></div>
          </div>
        ))}
      </div>
      <p className="lp-board-foot">Measured from the market cap where Wraith flagged each token. Past results do not predict future ones.</p>
    </div>
  );
}

export function CallsTable({ data }: { data: LandingData | null }) {
  const rows = data?.recent ?? [];
  if (!data) return <Skeleton rows={6} />;
  if (!rows.length) return <Empty text="No calls older than an hour yet." />;
  return (
    <div className="lp-scan">
      <div className="lp-scan-head"><span>Token</span><span>Called</span><span>Called at</span><span>Now</span><span>Peak</span></div>
      {rows.map((c) => {
        const now = c.spottedMcap > 0 ? c.lastMcap / c.spottedMcap : 0;
        return (
          <div key={c.address} className="lp-scan-row">
            <span className="id"><Coin c={c} /><b>{c.symbol.toUpperCase()}</b><ChainLogo chain={c.chain} size={13} /></span>
            <span>{ago(c.spottedAt)} ago</span>
            <span>{fmtUsd(c.spottedMcap)}</span>
            <span style={{ color: now >= 1 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{xf(now)}</span>
            <span>{xf(c.x)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ChartReal({ data }: { data: LandingData | null }) {
  const ch = data?.chart;
  if (!data) return <Skeleton rows={6} />;
  if (!ch || ch.candles.length < 8) return <Empty text="Chart appears once a call has price history." />;
  const cs = ch.candles;
  const W = 640, H = 300;
  const hi = Math.max(...cs.map((c) => c.h)), lo = Math.min(...cs.map((c) => c.l));
  const step = W / cs.length;
  const y = (v: number) => 20 + (1 - (v - lo) / Math.max(hi - lo, 1e-12)) * 190;
  const vmax = Math.max(...cs.map((c) => c.v ?? 0), 1);
  const calledIdx = cs.findIndex((c) => c.t >= ch.spottedAt);
  const last = cs[cs.length - 1];
  return (
    <div className="lp-chart">
      <div className="lp-chart-top"><b>${ch.symbol.toUpperCase()}</b><ChainLogo chain={ch.chain} size={14} /><span className="on">15m</span><span>price</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ch.symbol} price chart`}>
        {[0.2, 0.4, 0.6, 0.8].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="rgba(255,255,255,.05)" />)}
        {cs.map((c, i) => {
          const x = i * step + step / 2, up = c.c >= c.o, col = up ? "#22c55e" : "#ef4444";
          const vh = ((c.v ?? 0) / vmax) * 60;
          return (
            <g key={c.t}>
              <rect x={x - step * 0.32} width={step * 0.64} y={H - vh} height={vh} fill={col} opacity=".28" />
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={col} />
              <rect x={x - step * 0.32} width={step * 0.64} y={Math.min(y(c.o), y(c.c))} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} fill={col} />
            </g>
          );
        })}
        <line x1="0" x2={W} y1={y(last.c)} y2={y(last.c)} stroke="#ff7b3d" strokeDasharray="3 4" />
        {calledIdx > 0 && (<g><line x1={calledIdx * step} x2={calledIdx * step} y1="10" y2={H} stroke="#facc15" strokeDasharray="2 4" opacity=".7" /><text x={calledIdx * step + 6} y="22" fill="#facc15" fontSize="11" fontWeight="700">Called at {fmtUsd(ch.spottedMcap)}</text></g>)}
      </svg>
    </div>
  );
}

/** Paper-trade example computed from a real call. */
export function PaperExample({ data }: { data: LandingData | null }) {
  const c = data?.wins[0] ?? data?.recent[0];
  if (!data) return <Skeleton rows={4} />;
  if (!c) return <Empty text="An example appears once a call has been tracked." />;
  const size = 100;
  const nowX = c.spottedMcap > 0 ? c.lastMcap / c.spottedMcap : 1;
  const pnl = (nowX - 1) * 100;
  return (
    <div className="lp-paper">
      <div className="lp-pos">
        <div className="lp-pos-h"><b>${c.symbol.toUpperCase()}</b><span>Paper position · example from a real call</span></div>
        <div className="lp-pos-grid">
          <div><small>Entry</small><b>{fmtUsd(c.spottedMcap)}</b></div><div><small>Now</small><b>{fmtUsd(c.lastMcap)}</b></div>
          <div><small>Size</small><b>${size}</b></div><div><small>Value</small><b>${(size * nowX).toFixed(0)}</b></div>
          <div><small>Stop loss</small><b>you set</b></div><div><small>Take profit</small><b>you set</b></div>
        </div>
      </div>
      <div className="lp-pnl">
        <small>PnL CARD</small>
        <strong style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}%</strong>
        <span>${c.symbol.toUpperCase()} · {c.chain} · paper</span>
        <div className="share">Share</div>
      </div>
    </div>
  );
}

export function WinsReal({ data }: { data: LandingData | null }) {
  if (!data) return <Skeleton rows={5} />;
  return (
    <div className="lp-wins">
      <div className="lp-wins-top">
        <div><small>Reached 2x</small><strong>{data.stats.hit2} <i>of {data.stats.calls} calls</i></strong></div>
        <div><small>Hit rate · 7d</small><strong>{data.stats.calls ? `${data.stats.rate}%` : "—"}</strong></div>
      </div>
      {!data.wins.length ? <Empty text="No winning calls yet." /> : data.wins.slice(0, 5).map((c) => (
        <div key={c.address} className="lp-win">
          <span className="id"><Coin c={c} /><b>${c.symbol.toUpperCase()}</b><ChainLogo chain={c.chain} size={13} /></span>
          <i style={{ color: TIER_COLOR[c.tier], borderColor: TIER_COLOR[c.tier] }}>{c.tier}</i>
          <em>{xf(nowMult(c))}</em>
        </div>
      ))}
    </div>
  );
}

// ── Telegram: the bot's own HTML, rendered ──────────────────────────────
function tgHtml(html: string) {
  return html.replace(/<(?!\/?(b|i|code)>)[^>]*>/g, "").replace(/\n/g, "<br/>");
}

export function TelegramPhone({ data }: { data: LandingData | null }) {
  const reduce = useReducedMotion();
  const msgs = useMemo(() => [data?.telegram.signal, data?.telegram.win].filter(Boolean) as TgBlock[], [data]);
  const [n, setN] = useState(reduce ? 2 : 0);
  useEffect(() => {
    if (reduce || !msgs.length) return;
    const id = setInterval(() => setN((v) => (v >= msgs.length + 2 ? 0 : v + 1)), 2600);
    return () => clearInterval(id);
  }, [reduce, msgs.length]);
  return (
    <div className="lp-phone" role="img" aria-label="Alerts as they arrive from the Wraith Telegram bot">
      <div className="lp-phone-notch" />
      <div className="lp-phone-head"><img src="/logo.png" alt="" /><div><b>Wraith Scan</b><small>bot</small></div></div>
      <div className="lp-chat">
        {!data ? <Skeleton rows={3} /> : !msgs.length ? <Empty text="Alerts appear here once a call has been tracked." /> : (
          <AnimatePresence>
            {msgs.slice(0, n).map((m, i) => {
              const btns = (m.kb?.inline_keyboard ?? []).flat().map((b) => b.text);
              return (
                <motion.div key={i} className="lp-msg" initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4 }}>
                  <div className="tg" dangerouslySetInnerHTML={{ __html: tgHtml(m.html) }} />
                  {btns.length > 0 && <div className="btns">{btns.map((b) => <span key={b}>{b}</span>)}</div>}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/**
 * Shared feed for /api/landing (public proof data). Used by the landing page and the login page.
 * One request at a time, never overlapping: a browser only opens ~6 connections per host, so slow answers that stacked up
 * behind a fixed 30s interval used to starve every other call on the page, including the sign-in request. A request that
 * hangs is cut after 10s so it gives its connection back, the loop pauses while the tab is hidden, and a failed attempt
 * is retried quickly (6s) instead of waiting a whole minute.
 */
export function useLandingFeed(): { data: LandingData | null; loading: boolean } {
  const [state, setState] = useState<{ data: LandingData | null; loading: boolean }>({ data: null, loading: true });
  useEffect(() => {
    let alive = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    const run = async () => {
      if (!alive || busy || document.hidden) return; // hidden: the visibilitychange handler restarts the loop
      busy = true;
      const c = new AbortController();
      ctrl = c;
      const kill = setTimeout(() => c.abort(), 10_000);
      let ok = false;
      try {
        const r = await fetch("/api/landing", { cache: "no-store", signal: c.signal });
        if (r.ok && alive) {
          const d = (await r.json()) as LandingData;
          setState({ data: d, loading: false });
          ok = true;
        }
      } catch { /* keep last */ }
      clearTimeout(kill);
      busy = false;
      if (!alive) return;
      if (!ok) setState((s) => (s.loading ? { ...s, loading: false } : s));
      timer = setTimeout(run, ok ? 60_000 : 6_000);
    };
    const onVisible = () => {
      if (document.hidden || !alive || busy) return;
      clearTimeout(timer);
      void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return state;
}

export function useLandingData(): LandingData | null {
  return useLandingFeed().data;
}

/** Hero composition: the real call record, a real chart and a cycling real win. */
export function HeroStage({ data, loading }: { data: LandingData | null; loading: boolean }) {
  const reduce = useReducedMotion();
  const wins = (data?.wins ?? []).slice(0, 6);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || wins.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % wins.length), 3400);
    return () => clearInterval(id);
  }, [wins.length, reduce]);
  const w = wins.length ? wins[i % wins.length] : null;
  const ch = data?.chart;
  return (
    <div className="lp-stage">
      <div className="lp-orb a" aria-hidden="true" />
      <div className="lp-orb b" aria-hidden="true" />
      <LiveBoard data={data} loading={loading} />
      {w && (
        <div className="lp-float toast" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div key={w.address} className="lp-toast-in" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -14, scale: 0.96 }} transition={{ duration: 0.35 }}>
              <Coin c={w} />
              <div><b>${w.symbol.toUpperCase()} reached {xf(w.x)}</b><span>called at {fmtUsd(w.spottedMcap)} · peak {fmtUsd(w.peakMcap)}</span></div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}
      {ch && ch.candles.length >= 8 && (
        <div className="lp-float chart"><ChartReal data={data} /></div>
      )}
    </div>
  );
}
