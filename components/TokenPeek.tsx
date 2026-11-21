"use client";

// The floating chart window on a computer: click a saved token in the bar (components/SavedStrip.tsx) and this opens under it, the way Fomo's does.
// A market-cap chart with 1H / 4H / 1D / 7D / 1M / ALL, the key numbers, and three tabs: Wraith's own call on the token, its biggest holders and its
// latest swaps. Drag it by the top, Esc or the x closes it. It reads the same endpoints the token page does; Buy opens that page, where the trade happens.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Copy, X } from "lucide-react";
import { AreaSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { MemeTrend } from "@/app/app/page";
import BookmarkBtn from "@/components/BookmarkBtn";
import { TokenIcon } from "@/components/TokenIcon";
import { getCandles, type Candle } from "@/lib/candleCache";
import { cacheTokenNav } from "@/lib/tokenNav";
import { ageShort, pctShort, priceShort, shortAddr, timesShort, usdShort } from "@/lib/tokenFmt";
import type { SignalCall } from "@/lib/signalCalls";

type Snap = {
  symbol?: string; name?: string; imageUrl?: string | null; priceUsd?: number; marketCap?: number | null; liquidity?: number; volume24h?: number;
  priceChange?: { h1?: number | null; h24?: number | null }; buys24h?: number; sells24h?: number; pairCreatedAt?: number | null; supply?: number | null;
};
type Holders = { holders: { wallet: string; quantity: number; share: number; label?: string | null }[]; top10: number; total: number; count?: number | null };
type Trade = { id: string; ts: number; side: "buy" | "sell"; usd: number; tokens: number; priceUsd: number; wallet: string };
type Tab = "calls" | "holders" | "swaps";

// Each range is a number of candles of one size. "auto" (ALL) picks the size from the token's age, so a day-old token is not one fat candle.
const RANGES = [
  { k: "1H", tf: "1m", bars: 60 }, { k: "4H", tf: "5m", bars: 48 }, { k: "1D", tf: "15m", bars: 96 },
  { k: "7D", tf: "1h", bars: 168 }, { k: "1M", tf: "4h", bars: 180 }, { k: "ALL", tf: "auto", bars: 300 },
] as const;
type RangeKey = (typeof RANGES)[number]["k"];
const LADDER = ["1m", "5m", "15m", "1h", "4h", "1d"];
const SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const W = 420;

function autoTf(created?: number | null): string {
  const d = created ? (Date.now() - created) / 86_400_000 : 3;
  return d <= 1.1 ? "5m" : d <= 11 ? "1h" : d <= 48 ? "4h" : "1d";
}
const valid = (c: Candle) => [c.t, c.o, c.h, c.l, c.c].every((n) => typeof n === "number" && Number.isFinite(n)) && c.c > 0;

/** One endpoint, refreshed on a timer while the tab is visible. undefined = loading, null = failed. Never shows another token's data. */
function useJson<T>(url: string | null, every = 0): T | null | undefined {
  const [got, setGot] = useState<{ url: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const pull = () => {
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .catch(() => null)
        .then((data) => { if (alive) setGot({ url, data }); });
    };
    pull();
    const t = every ? window.setInterval(() => { if (!document.hidden) pull(); }, every) : 0;
    return () => { alive = false; if (t) window.clearInterval(t); };
  }, [url, every]);
  return url ? (got?.url === url ? got.data : undefined) : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const place = (a: { left: number; top: number }) => ({ left: clamp(a.left, 8, Math.max(8, window.innerWidth - W - 8)), top: clamp(a.top, 8, Math.max(8, window.innerHeight - 120)) });

export default function TokenPeek({ token, anchor, onClose }: { token: MemeTrend; anchor: { left: number; top: number }; onClose: () => void }) {
  const mint = token.contractAddress ?? "";
  const router = useRouter();
  const win = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const [range, setRange] = useState<RangeKey>("1D");
  const [tab, setTab] = useState<Tab>("calls");
  const [pos, setPos] = useState(() => place(anchor));
  const [copied, setCopied] = useState(false);
  const [candles, setCandles] = useState<{ key: string; cs: Candle[] } | null>(null);
  const moved = useRef(false);
  const grab = useRef<{ dx: number; dy: number } | null>(null);

  const snap = useJson<Snap>(`/api/token-price?mint=${encodeURIComponent(mint)}`, 10_000);
  const calls = useJson<{ calls?: SignalCall[] }>(tab === "calls" ? `/api/signal-calls?mint=${encodeURIComponent(mint)}` : null);
  const holders = useJson<Holders>(tab === "holders" ? `/api/token-holders?mint=${encodeURIComponent(mint)}` : null);
  const swaps = useJson<{ trades?: Trade[] }>(tab === "swaps" ? `/api/token-trades?mint=${encodeURIComponent(mint)}` : null, 10_000);

  const supply = snap?.supply && snap.supply > 0 ? snap.supply : null;
  const created = snap?.pairCreatedAt ?? null;
  const def = RANGES.find((r) => r.k === range) ?? RANGES[2];
  const curKey = `${mint}|${range}`;

  // opening another token while this window is up moves it under that token's chip, unless it was dragged somewhere on purpose
  const { left: ax, top: ay } = anchor;
  useEffect(() => { if (!moved.current) setPos(place({ left: ax, top: ay })); }, [ax, ay]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // the chart itself: made once, data goes in below
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const c = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(255,255,255,0.45)", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(255,255,255,0.22)", labelBackgroundColor: "#2c2c32" },
        horzLine: { color: "rgba(255,255,255,0.22)", labelBackgroundColor: "#2c2c32" },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.08 }, minimumWidth: 60 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2 },
      handleScroll: false,
      handleScale: false,
      width: el.clientWidth,
      height: el.clientHeight,
    });
    series.current = c.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 4 });
    chart.current = c;
    const ro = new ResizeObserver(() => c.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => { ro.disconnect(); c.remove(); chart.current = null; series.current = null; };
  }, []);

  // the candles for the chosen range (a finer size is tried when a young token has too few), kept fresh while the window is open
  const createdForAll = range === "ALL" ? created : null;
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const start = def.tf === "auto" ? autoTf(createdForAll) : def.tf;
      const span = def.bars * SEC[start];
      let best: Candle[] = [];
      for (let i = LADDER.indexOf(start), n = 0; i >= 0 && n < 3; i--, n++) {
        const tf = LADDER[i];
        const cs = (await getCandles(mint, tf)).filter(valid).slice(-Math.min(300, Math.ceil(span / SEC[tf])));
        if (cs.length > best.length) best = cs;
        if (cs.length >= 12) break;
      }
      if (alive) setCandles({ key: `${mint}|${def.k}`, cs: best });
    };
    void pull();
    const t = window.setInterval(() => { if (!document.hidden) void pull(); }, 15_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [mint, def, createdForAll]);

  // draw it: market cap when the supply is known (the app talks in market caps), the price otherwise; green when the range ended higher than it began
  const have = candles && candles.key === curKey ? candles.cs : null;
  useEffect(() => {
    const s = series.current, c = chart.current;
    if (!s || !c || !have || have.length < 2) { s?.setData([]); return; }
    const k = supply ?? 1;
    const pts = have.map((x) => ({ time: (x.t / 1000) as Time, value: x.c * k }));
    const up = pts[pts.length - 1].value >= pts[0].value;
    s.applyOptions({
      lineColor: up ? "#3ddc97" : "#ff6b62",
      topColor: up ? "rgba(61,220,151,0.30)" : "rgba(255,107,98,0.28)",
      bottomColor: "rgba(0,0,0,0)",
      priceFormat: { type: "custom", minMove: 1e-12, formatter: supply ? (v: number) => usdShort(v) : (v: number) => priceShort(v) },
    });
    c.applyOptions({ timeScale: { timeVisible: range !== "1M" && range !== "ALL" } });
    s.setData(pts);
    c.timeScale().fitContent();
  }, [have, supply, range]);

  const rangePct = have && have.length > 1 ? (have[have.length - 1].c / have[0].c - 1) * 100 : null;
  const sym = (token.keyword || snap?.symbol || "").replace(/^\$/, "");
  const now = snap?.marketCap ?? null;
  const h24 = snap?.priceChange?.h24 ?? null;
  const call = calls?.calls?.[0] ?? null;

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button") || !win.current) return;
    const r = win.current.getBoundingClientRect();
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!grab.current) return;
    moved.current = true;
    setPos({ left: clamp(e.clientX - grab.current.dx, 8, Math.max(8, window.innerWidth - W - 8)), top: clamp(e.clientY - grab.current.dy, 8, Math.max(8, window.innerHeight - 120)) });
  };
  const copy = () => { void navigator.clipboard.writeText(mint).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }).catch(() => undefined); };
  const buy = () => { cacheTokenNav(token); router.push(`/app/token/${encodeURIComponent(mint)}`); onClose(); };

  if (typeof document === "undefined") return null;
  return createPortal(
    // maxHeight keeps the bottom of the window (and the Buy button) on screen: on a short window the list area shrinks first
    <div ref={win} className="tp" style={{ left: pos.left, top: pos.top, maxHeight: `calc(100dvh - ${pos.top}px - 8px)` }} role="dialog" aria-label={`${sym || "Token"} chart`}>
      <div className="tp-head" onPointerDown={down} onPointerMove={move} onPointerUp={() => { grab.current = null; }} onPointerCancel={() => { grab.current = null; }}>
        <TokenIcon contractAddress={mint} imageUrl={token.tokenImageUrl ?? snap?.imageUrl ?? undefined} symbol={sym || "T"} size={40} />
        <div className="tp-name">
          <b>${sym || "token"}</b>
          <small>{snap?.name ?? token.keyword}<i>·</i><code>{shortAddr(mint)}</code><button type="button" onClick={copy} aria-label="Copy the contract address">{copied ? <Check size={13} /> : <Copy size={13} />}</button></small>
        </div>
        <div className="tp-mc">
          <b>{usdShort(now)} MC</b>
          {h24 !== null && <small className={h24 >= 0 ? "up" : "down"}>{h24 >= 0 ? "▲" : "▼"} {Math.abs(h24).toFixed(2)}%</small>}
        </div>
        <BookmarkBtn meme={token} size={17} />
        <button type="button" className="tp-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      <div className="tp-ranges">
        {RANGES.map((r) => <button key={r.k} type="button" className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.k}</button>)}
        {rangePct !== null && <em className={rangePct >= 0 ? "up" : "down"}>{pctShort(rangePct)}</em>}
      </div>
      <div className="tp-chart">
        <div ref={box} className="tp-plot" />
        {(!have || have.length < 2) && <p className="tp-chart-note">{!have ? "Loading the chart…" : "No chart yet. It is too new for the chart sources."}</p>}
      </div>

      <div className="tp-stats">
        <div><small>Liquidity</small><b>{usdShort(snap?.liquidity)}</b></div>
        <div><small>Volume 24h</small><b>{usdShort(snap?.volume24h)}</b></div>
        <div><small>Buys / sells</small><b>{snap ? `${(snap.buys24h ?? 0).toLocaleString("en-US")} / ${(snap.sells24h ?? 0).toLocaleString("en-US")}` : "-"}</b></div>
        <div><small>Age</small><b>{ageShort(created)}</b></div>
      </div>

      <div className="tp-tabs" role="tablist">
        {(["calls", "holders", "swaps"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "calls" ? "Wraith call" : t === "holders" ? "Holders" : "Swaps"}</button>)}
      </div>
      <div className="tp-body">
        {tab === "calls" && (
          calls === undefined ? <Skeleton /> : calls === null ? <p className="tp-none">Wraith&rsquo;s calls could not be loaded right now.</p> : call ? (
            <div className="tp-call">
              <div className="tp-call-top">
                <span className={call.tier === "HOT" ? "tag hot" : "tag"}>{call.tier === "HOT" ? "Hot call" : "Watch call"}</span>
                {call.rugged && <span className="tag bad">Collapsed</span>}
                <small>{ageShort(call.spottedAt)} ago</small>
              </div>
              <div className="tp-call-grid">
                <div><small>Called at</small><b>{usdShort(call.spottedMcap)}</b></div>
                <div><small>Peak</small><b>{usdShort(call.peakMcap)}</b><em className="up">{timesShort(call.peakMcap / call.spottedMcap)}</em></div>
                <div><small>Now</small><b>{usdShort(now ?? call.lastMcap)}</b><em className={(now ?? call.lastMcap) >= call.spottedMcap ? "up" : "down"}>{timesShort((now ?? call.lastMcap) / call.spottedMcap)}</em></div>
              </div>
            </div>
          ) : (
            <p className="tp-none">Wraith has not called this token. A call is made when the scanner&rsquo;s signals line up.</p>
          )
        )}
        {tab === "calls" && token.aiContext && <p className="tp-why">{token.aiContext}</p>}
        {tab === "holders" && (
          holders === undefined ? <Skeleton /> : !holders?.holders?.length ? <p className="tp-none">The holder list is not available right now.</p> : (
            <>
              <p className="tp-sum">Top 10 hold <b>{holders.top10.toFixed(1)}%</b>{holders.count ? <> · <b>{holders.count.toLocaleString("en-US")}</b> holders</> : null}</p>
              <div className="tp-list">
                {holders.holders.slice(0, 10).map((h, i, a) => (
                  <div key={h.wallet} className="tp-h">
                    <span>{i + 1}</span>
                    <code>{h.label ?? shortAddr(h.wallet)}</code>
                    <i><u style={{ width: `${Math.max(3, (h.share / (a[0]?.share || 1)) * 100)}%` }} /></i>
                    <b>{h.share.toFixed(1)}%</b>
                  </div>
                ))}
              </div>
            </>
          )
        )}
        {tab === "swaps" && (
          swaps === undefined ? <Skeleton /> : !swaps?.trades?.length ? <p className="tp-none">No recent swaps to show.</p> : (
            <div className="tp-list">
              {swaps.trades.slice(0, 16).map((t) => (
                <div key={t.id} className="tp-s">
                  <span className={t.side}>{t.side === "buy" ? "Buy" : "Sell"}</span>
                  <b>{usdShort(t.usd)}</b>
                  <small>{supply ? `at ${usdShort(t.priceUsd * supply)} MC` : priceShort(t.priceUsd)}</small>
                  <code>{shortAddr(t.wallet)}</code>
                  <small>{ageShort(t.ts)}</small>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <div className="tp-foot">
        <button type="button" className="tp-buy" onClick={buy}>Buy ${sym || "token"}<ArrowUpRight size={17} /></button>
      </div>
    </div>,
    document.body,
  );
}

function Skeleton() {
  return <div className="tp-sk" aria-hidden="true"><i /><i /><i /><i /></div>;
}
