"use client";

// components/TokenChart.tsx
// Pump.fun / Fomo style chart: candles or orange area, volume histogram,
// MCap/Price toggle, live tick merged into the current candle, proper
// loading / empty / error states. Data comes from /api/token-chart.

import { createPortal } from "react-dom";
import { visibleInterval } from "@/lib/visibleInterval";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw, Trash2, X } from "lucide-react";
import ChartToolsMenu, { type ToolId } from "@/components/ChartToolsMenu";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/market";
import { peekCandles } from "@/lib/candleCache";
import { usePresence } from "@/lib/usePresence";
import WalletAvatar from "@/components/WalletAvatar";
import { walletName } from "@/lib/walletIdentity";

export interface ChartCandle {
  t: number; // bucket start, ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const TIMEFRAMES = [
  { key: "1m", label: "1m", sec: 60 },
  { key: "5m", label: "5m", sec: 300 },
  { key: "15m", label: "15m", sec: 900 },
  { key: "1h", label: "1h", sec: 3600 },
  { key: "4h", label: "4h", sec: 14400 },
  { key: "1d", label: "1D", sec: 86400 },
] as const;
type TfKey = (typeof TIMEFRAMES)[number]["key"];
type Metric = "mcap" | "price";
type Style = "candles" | "line";

const ACCENT = "#ff7b3d";
type PinItem = { kind: "dumper" | "proven" | "intel"; id: string; ts: number; name: string; href: string; line: string; wallet?: string; avatar?: string; text?: string; sol?: number; mcap?: number };

const UP = "#26a69a";
const DOWN = "#ef5350";
const POLL_MS = 10_000;
const rowCache = new Map<string, ChartCandle[]>(); // last good series per token+timeframe: instant repaint on switch/revisit
const EMPTY_POLL_MS = 2_500;
const FINER_TF: Record<string, string[]> = { "5m": ["1m"], "15m": ["5m", "1m"], "1h": ["15m", "5m", "1m"], "4h": ["1h", "15m", "5m"], "1d": ["4h", "1h", "15m"] };
/** Build `tf` from any finer series already cached for this token, so switching timeframe never starts from blank. */
function deriveLocal(mint: string, chain: string | undefined, tf: string, sec: number): ChartCandle[] {
  for (const fk of FINER_TF[tf] ?? []) {
    const src = rowCache.get(`${mint}:${chain ?? ""}:${fk}`);
    if (!src || src.length < 3) continue;
    const step = sec * 1000;
    const out = new Map<number, ChartCandle>();
    for (const r of src) {
      const t = Math.floor(r.t / step) * step;
      const cur = out.get(t);
      if (!cur) out.set(t, { ...r, t });
      else { cur.h = Math.max(cur.h, r.h); cur.l = Math.min(cur.l, r.l); cur.c = r.c; cur.v += r.v; }
    }
    const list = [...out.values()].sort((a, b) => a.t - b.t);
    if (list.length >= 3) return list;
  }
  return [];
}

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

// lightweight-charts renders UTC; shift into the viewer's local time.
function chartTime(tMs: number): UTCTimestamp {
  return (tMs / 1000 - new Date(tMs).getTimezoneOffset() * 60) as UTCTimestamp;
}

type Status = "loading" | "ready" | "empty" | "error";

export default function TokenChart({
  mint,
  livePrice,
  supply,
  spottedMcap,
  spottedAt,
  spotCard,
  trades,
  onCurve,
  chain,
}: {
  mint: string;
  /** EVM chain key (e.g. "base"); omit for Solana */
  chain?: string;
  /** still on the pump.fun bonding curve (lets the server rebuild candles on-chain) */
  onCurve?: boolean;
  /** latest spot price in USD, merged into the current candle */
  livePrice?: number | null;
  /** circulating supply (mcap / price) — enables the MCap view */
  supply?: number | null;
  /** market cap when Wraith flagged this token: drawn as a "Spotted" line */
  spottedMcap?: number | null;
  /** when Wraith flagged it (ms epoch): draws the Wraith marker on that candle in every timeframe */
  spottedAt?: number | null;
  /** hover card for the Wraith marker */
  spotCard?: ReactNode;
  /** recent swaps, drawn as buy/sell dots on their candles */
  trades?: { id: string; ts: number; side: "buy" | "sell"; usd: number; priceUsd: number; wallet: string }[];
}) {
  const onCurveRef = useRef(Boolean(onCurve));
  onCurveRef.current = Boolean(onCurve);
  const livePriceRef = useRef<number | null>(null);
  livePriceRef.current = livePrice && livePrice > 0 ? livePrice : null;
  const [tf, setTf] = useState<TfKey>("15m");
  const [metric, setMetric] = useState<Metric>("mcap");
  const [style, setStyle] = useState<Style>("candles");
  const [status, setStatus] = useState<Status>("loading");
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [source, setSource] = useState<string>("");
  const [stale, setStale] = useState(false);
  const [legend, setLegend] = useState<ChartCandle | null>(null);
  const [away, setAway] = useState(false);
  const pushedRef = useRef<{ key: string; first: number; len: number } | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef<ChartCandle[]>([]);
  const needFitRef = useRef(true);
  const reqRef = useRef(0);
  const lastTickRef = useRef<number>(0);

  // ── measure tool (Shift+click to start, click again to lock) ───────────
  type MPt = { logical: number; value: number };
  type Measure = { a: MPt; b: MPt; locked: boolean };
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [, setViewTick] = useState(0);
  const [spotTick, setSpotTick] = useState(0);
  const [spotHover, setSpotHover] = useState(false);
  const spotPres = usePresence(spotHover, 200);
  const spotPinRef = useRef(false);
  const spotCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  const [dots, setDots] = useState<{ key: string; x: number; y: number; side: "buy" | "sell"; n: number; avatar: string; name: string; userId: string }[]>([]);
  const [wTraders, setWTraders] = useState<{ userId: string; displayName: string; avatar: string; lastSide: "buy" | "sell"; lastAt: number; count: number }[]>([]);
  // who else is on this chart: wallets Wraith knows (repeat dumpers, proven) at the candle they first bought, and intel posted by people on Wraith
  const [pinItems, setPinItems] = useState<PinItem[]>([]);
  const [pins, setPins] = useState<{ key: string; x: number; y: number; kind: PinItem["kind"]; items: PinItem[]; value: number; cardLeft: number; up: boolean }[]>([]);
  const [pinOpen, setPinOpen] = useState<string | null>(null);
  const [spotPos, setSpotPos] = useState<{ x: number; y: number } | null>(null);
  const [spotRect, setSpotRect] = useState<DOMRect | null>(null);
  const measureRef = useRef<Measure | null>(null);
  measureRef.current = measure;
  const measureModeRef = useRef(false);
  measureModeRef.current = measureMode;

  // ── drawing tools: horizontal line, trend line, rectangle, fib. Stored by time + price, so they survive timeframe changes ──
  type DrawKind = "hline" | "trend" | "rect" | "fib";
  type DPt = { t: number; p: number };
  type Drawing = { id: string; kind: DrawKind; a: DPt; b: DPt };
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<DrawKind | null>(null);
  const [draft, setDraft] = useState<Drawing | null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  drawingsRef.current = drawings;
  const toolRef = useRef<DrawKind | null>(null);
  toolRef.current = tool;
  const draftRef = useRef<Drawing | null>(null);
  draftRef.current = draft;
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const selectModeRef = useRef(false);
  selectModeRef.current = selectMode;
  const selectedRef = useRef<string[]>([]);
  selectedRef.current = selected;
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const boxFnRef = useRef<(d: Drawing) => { l: number; t: number; r: number; b: number } | null>(() => null);
  const drawKey = `wraith_draw_${mint}`;
  useEffect(() => {
    try { const raw = localStorage.getItem(drawKey); setDrawings(raw ? (JSON.parse(raw) as Drawing[]) : []); } catch { setDrawings([]); }
  }, [drawKey]);
  useEffect(() => {
    try { if (drawings.length) localStorage.setItem(drawKey, JSON.stringify(drawings)); else localStorage.removeItem(drawKey); } catch { /* storage blocked */ }
  }, [drawings, drawKey]);

  const supplyKey = supply && supply > 0 ? Math.round(supply) : 0;
  const effectiveMetric: Metric = metric === "mcap" && supplyKey ? "mcap" : "price";
  const mult = effectiveMetric === "mcap" ? supplyKey : 1;
  const tfSec = TIMEFRAMES.find((x) => x.key === tf)?.sec ?? 900;
  const tfSecRef = useRef(900);
  tfSecRef.current = tfSec;

  // ── persisted prefs (after mount: avoids hydration mismatch) ───────────
  useEffect(() => {
    setTf(readPref("wraith_chart_tf", TIMEFRAMES.map((x) => x.key), "15m"));
    setMetric(readPref("wraith_chart_metric", ["mcap", "price"] as const, "mcap"));
    setStyle(readPref("wraith_chart_style", ["candles", "line"] as const, "candles"));
  }, []);

  // ── create chart once ──────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b8b92",
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,123,61,0.45)", labelBackgroundColor: ACCENT },
        horzLine: { color: "rgba(255,123,61,0.45)", labelBackgroundColor: ACCENT },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 9,
        minBarSpacing: 1.5,
        rightBarStaysOnScroll: true,
        lockVisibleTimeRangeOnResize: true,
        shiftVisibleRangeOnNewBar: true,
      },
      kineticScroll: { mouse: false, touch: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const applyMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !mainRef.current) {
        setLegend(null);
        return;
      }
      const data = param.seriesData.get(mainRef.current) as
        | { open?: number; high?: number; low?: number; close?: number; value?: number }
        | undefined;
      const vol = volRef.current ? (param.seriesData.get(volRef.current) as { value?: number } | undefined) : undefined;
      if (!data) {
        setLegend(null);
        return;
      }
      const m = metricMultRef.current;
      const c = (data.close ?? data.value ?? 0) / m;
      setLegend({
        t: 0,
        o: (data.open ?? data.value ?? 0) / m,
        h: (data.high ?? data.value ?? 0) / m,
        l: (data.low ?? data.value ?? 0) / m,
        c,
        v: vol?.value ?? 0,
      });
    };
    // one legend update per frame: React no longer re-renders on every mouse-move event
    let raf = 0;
    let pending: MouseEventParams<Time> | null = null;
    const onMove = (param: MouseEventParams<Time>) => {
      pending = param;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending) applyMove(pending);
      });
    };
    chart.subscribeCrosshairMove(onMove);
    // "Latest" button appears when you've scrolled into history
    const onRange = () => {
      const away = chart.timeScale().scrollPosition() < -2;
      setAway((prev) => (prev === away ? prev : away));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onMove);
      chartRef.current = null;
      mainRef.current = null;
      volRef.current = null;
      // The chart may still have a paint queued. Disposing it right now makes that paint throw "Object is disposed",
      // so let the queued frame run first, then remove it.
      requestAnimationFrame(() => requestAnimationFrame(() => { try { chart.remove(); } catch { /* already gone */ } }));
    };
  }, []);

  // crosshair handler needs the current multiplier without re-subscribing
  const metricMultRef = useRef(1);
  metricMultRef.current = mult;

  // measure tool: pointer handling on the chart surface
  useEffect(() => {
    const host = hostRef.current;
    const chart = chartRef.current;
    if (!host || !chart) return;
    const toPt = (e: { clientX: number; clientY: number }): MPt | null => {
      const main = mainRef.current;
      if (!main) return null;
      const r = host.getBoundingClientRect();
      const logical = chart.timeScale().coordinateToLogical(e.clientX - r.left);
      const value = main.coordinateToPrice(e.clientY - r.top);
      if (logical === null || value === null) return null;
      return { logical: logical as number, value: value as number };
    };
    const toD = (e: { clientX: number; clientY: number }): DPt | null => {
      const pt = toPt(e);
      const first = candlesRef.current[0];
      if (!pt || !first) return null;
      const m = metricMultRef.current || 1;
      return { t: first.t + pt.logical * (tfSecRef.current * 1000), p: pt.value / m };
    };
    const placeTool = (kind: DrawKind, pt: { clientX: number; clientY: number }) => {
      const p = toD(pt);
      if (!p) return;
      if (kind === "hline") {
        setDrawings((d) => [...d, { id: String(Date.now()), kind, a: p, b: p }]);
        setTool(null);
        return;
      }
      const dr = draftRef.current;
      if (!dr) { setDraft({ id: String(Date.now()), kind, a: p, b: p }); return; }
      setDrawings((d) => [...d, { ...dr, b: p }]);
      setDraft(null);
      setTool(null);
    };
    // select mode: drag a box (like the Windows desktop) or tap a drawing to select it
    const hostPos = (cx: number, cy: number) => { const r = host.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };
    const startSel = (cx: number, cy: number) => {
      const q = hostPos(cx, cy);
      marqueeStartRef.current = q;
      setMarquee({ x1: q.x, y1: q.y, x2: q.x, y2: q.y });
    };
    const moveSel = (cx: number, cy: number) => {
      const st = marqueeStartRef.current;
      if (!st) return;
      const q = hostPos(cx, cy);
      setMarquee({ x1: st.x, y1: st.y, x2: q.x, y2: q.y });
    };
    const endSel = (cx: number, cy: number, additive: boolean) => {
      const st = marqueeStartRef.current;
      marqueeStartRef.current = null;
      setMarquee(null);
      if (!st) return;
      const q = hostPos(cx, cy);
      let L = Math.min(st.x, q.x), R = Math.max(st.x, q.x), T = Math.min(st.y, q.y), B = Math.max(st.y, q.y);
      if (R - L < 4 && B - T < 4) { L -= 8; R += 8; T -= 8; B += 8; } // a tap: forgiving hit area
      const hits = drawingsRef.current
        .filter((d) => { const b = boxFnRef.current(d); return !!b && b.l <= R && b.r >= L && b.t <= B && b.b >= T; })
        .map((d) => d.id);
      setSelected((prev) => (additive ? Array.from(new Set([...prev, ...hits])) : hits));
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const kind = toolRef.current;
      if (kind) {
        e.stopPropagation();
        e.preventDefault();
        placeTool(kind, e);
        return;
      }
      if (selectModeRef.current) {
        e.stopPropagation();
        e.preventDefault();
        startSel(e.clientX, e.clientY);
        const mv = (ev: MouseEvent) => moveSel(ev.clientX, ev.clientY);
        const up = (ev: MouseEvent) => {
          endSel(ev.clientX, ev.clientY, ev.shiftKey || ev.ctrlKey || ev.metaKey);
          window.removeEventListener("mousemove", mv);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", mv);
        window.addEventListener("mouseup", up);
        return;
      }
      const m = measureRef.current;
      if (m && !m.locked) {
        // second click: stop here
        e.stopPropagation();
        e.preventDefault();
        setMeasure({ a: m.a, b: toPt(e) ?? m.b, locked: true });
        setMeasureMode(false);
        return;
      }
      if (e.shiftKey || measureModeRef.current) {
        e.stopPropagation();
        e.preventDefault();
        const p = toPt(e);
        if (p) setMeasure({ a: p, b: p, locked: false });
        return;
      }
      if (m && m.locked) setMeasure(null); // plain click clears a finished measurement
    };
    const onMove = (e: MouseEvent) => {
      const dr = draftRef.current;
      if (dr) { const p = toD(e); if (p) setDraft({ ...dr, b: p }); return; }
      const m = measureRef.current;
      if (!m || m.locked) return;
      const p = toPt(e);
      if (p) setMeasure({ a: m.a, b: p, locked: false });
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
      if (e.key === "Escape") {
        setMeasure(null);
        setMeasureMode(false);
        setTool(null);
        setDraft(null);
        setSelected([]);
      }
      if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedRef.current.length) {
        const gone = new Set(selectedRef.current);
        setDrawings((d) => d.filter((x) => !gone.has(x.id)));
        setSelected([]);
      }
      if (!typing && selectModeRef.current && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(drawingsRef.current.map((x) => x.id));
      }
    };
    const bump = () => { if (measureRef.current || drawingsRef.current.length || draftRef.current) setViewTick((t) => t + 1); };
    // finger tracking for drawing and measuring: press and drag to size a shape, or tap start then tap end
    const dragTouch = (start: Touch, onMoveTo: (t: Touch) => void, onEnd: (t: Touch | undefined, moved: boolean) => void) => {
      let moved = false;
      const mv = (ev: TouchEvent) => {
        ev.preventDefault();
        const t = ev.touches[0];
        if (!t) return;
        if (Math.hypot(t.clientX - start.clientX, t.clientY - start.clientY) > 10) moved = true;
        if (moved) onMoveTo(t);
      };
      const up = (ev: TouchEvent) => {
        window.removeEventListener("touchmove", mv);
        window.removeEventListener("touchend", up);
        window.removeEventListener("touchcancel", up);
        onEnd(ev.changedTouches[0], moved);
      };
      window.addEventListener("touchmove", mv, { passive: false });
      window.addEventListener("touchend", up);
      window.addEventListener("touchcancel", up);
    };
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0];
      const kind = toolRef.current;
      if (kind) {
        e.stopPropagation();
        e.preventDefault();
        const hadDraft = !!draftRef.current;
        placeTool(kind, t0);
        if (kind !== "hline" && !hadDraft) {
          dragTouch(t0, (t) => { const p = toD(t); const d = draftRef.current; if (p && d) setDraft({ ...d, b: p }); }, (t, moved) => { if (moved && t) placeTool(kind, t); });
        }
        return;
      }
      const m = measureRef.current;
      if (m && !m.locked) { // second tap ends the measurement
        e.stopPropagation();
        e.preventDefault();
        setMeasure({ a: m.a, b: toPt(t0) ?? m.b, locked: true });
        setMeasureMode(false);
        return;
      }
      if (measureModeRef.current) {
        e.stopPropagation();
        e.preventDefault();
        const p = toPt(t0);
        if (!p) return;
        setMeasure({ a: p, b: p, locked: false });
        dragTouch(t0, (t) => { const q = toPt(t); const cur = measureRef.current; if (q && cur) setMeasure({ a: cur.a, b: q, locked: false }); }, (t, moved) => {
          const q = t ? toPt(t) : null; const cur = measureRef.current;
          if (moved && q && cur) { setMeasure({ a: cur.a, b: q, locked: true }); setMeasureMode(false); }
        });
        return;
      }
      if (m && m.locked) setMeasure(null); // a plain tap clears a finished measurement
      if (!selectModeRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      startSel(t0.clientX, t0.clientY);
      const mv = (ev: TouchEvent) => { ev.preventDefault(); const t = ev.touches[0]; if (t) moveSel(t.clientX, t.clientY); };
      const up = (ev: TouchEvent) => {
        const t = ev.changedTouches[0];
        if (t) endSel(t.clientX, t.clientY, false);
        window.removeEventListener("touchmove", mv);
        window.removeEventListener("touchend", up);
        window.removeEventListener("touchcancel", up);
      };
      window.addEventListener("touchmove", mv, { passive: false });
      window.addEventListener("touchend", up);
      window.addEventListener("touchcancel", up);
    };
    host.addEventListener("touchstart", onTouch, { capture: true, passive: false });
    host.addEventListener("mousedown", onDown, true);
    host.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.subscribeCrosshairMove(bump);
    return () => {
      host.removeEventListener("touchstart", onTouch, true);
      host.removeEventListener("mousedown", onDown, true);
      host.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
      chart.unsubscribeCrosshairMove(bump);
    };
  }, []);

  // a measurement only makes sense for the series it was drawn on
  useEffect(() => {
    setMeasure(null);
  }, [tf, effectiveMetric, style]);

  // ── (re)build series when style / metric changes ──────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (mainRef.current) chart.removeSeries(mainRef.current);
    if (volRef.current) chart.removeSeries(volRef.current);

    const formatter = effectiveMetric === "mcap" ? (p: number) => (p < 0 ? "" : p === 0 ? "$0" : fmtUsd(p, { decimals: 2 })) : (p: number) => fmtPrice(p);
    const priceFormat = {
      type: "custom" as const,
      minMove: effectiveMetric === "mcap" ? 1 : 1e-12,
      formatter,
    };

    mainRef.current =
      style === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            borderUpColor: UP,
            borderDownColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            priceFormat,
            priceLineColor: ACCENT,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            topColor: "rgba(255,123,61,0.28)",
            bottomColor: "rgba(255,123,61,0.0)",
            lineWidth: 2,
            priceFormat,
            priceLineColor: ACCENT,
          });

    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    pushedRef.current = null;
    needFitRef.current = true;
  }, [style, effectiveMetric]);

  // ── "Spotted" marker line ─────────────────────────────────────────────
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !spottedMcap || !(spottedMcap > 0)) return;
    const value = effectiveMetric === "mcap" ? spottedMcap : supplyKey ? spottedMcap / supplyKey : 0;
    if (!(value > 0)) return;
    const line = main.createPriceLine({
      price: value,
      color: "#facc15",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "Spotted",
    });
    return () => {
      try { main.removePriceLine(line); } catch { /* series already replaced */ }
    };
  }, [style, effectiveMetric, spottedMcap, supplyKey]);

  // ── Wraith marker: where it spotted the token, on whatever timeframe is showing ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bump = () => setSpotTick((t) => t + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    chart.timeScale().subscribeSizeChange(bump);
    return () => {
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump); chart.timeScale().unsubscribeSizeChange(bump); } catch { /* chart gone */ }
    };
  }, []);
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || !spottedAt || !candles.length) { setSpotPos(null); return; }
    const step = tfSec * 1000;
    const bucket = Math.floor(spottedAt / step) * step;
    const c = candles.find((k) => k.t === bucket);
    if (!c) { setSpotPos(null); return; } // spotted before the first candle we have
    const x = chart.timeScale().timeToCoordinate(chartTime(bucket));
    // pin it to the price Wraith actually flagged it at (same level as the yellow Spotted line), not to a candle's high
    const spotValue = spottedMcap && spottedMcap > 0 ? (effectiveMetric === "mcap" ? spottedMcap : supplyKey ? spottedMcap / supplyKey : 0) : 0;
    const y = main.priceToCoordinate(spotValue > 0 ? spotValue : c.h * mult);
    setSpotPos((prev) => {
      if (x == null || y == null) return null;
      // ignore sub-pixel drift so the marker holds still under the cursor while live ticks arrive
      if (prev && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2) return prev;
      return { x, y };
    });
  }, [spottedAt, spottedMcap, supplyKey, candles, tfSec, mult, spotTick, style, effectiveMetric]);

  // ── Wraith traders: who on the platform bought / sold this token ──
  useEffect(() => {
    if (!mint || !showTrades) return;
    let alive = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/token-traders?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        if (!r.ok) return;
        const d: { traders?: typeof wTraders } = await r.json();
        if (alive && Array.isArray(d.traders)) setWTraders(d.traders);
      } catch { /* optional */ }
    };
    void run();
    const t = visibleInterval(run, 45_000);
    return () => { alive = false; clearInterval(t); };
  }, [mint, showTrades]);

  // ── their buys / sells drawn as avatars on the candle they traded in ──
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || !showTrades || !wTraders.length || !candles.length) { setDots([]); return; }
    const step = tfSec * 1000;
    const byBucket = new Map<number, ChartCandle>();
    for (const c of candles) byBucket.set(c.t, c);
    const groups = new Map<string, { bucket: number; side: "buy" | "sell"; n: number; avatar: string; name: string; userId: string; c: ChartCandle }>();
    for (const t of wTraders) {
      if (!(t.lastAt > 0)) continue;
      const bucket = Math.floor(t.lastAt / step) * step;
      const c = byBucket.get(bucket);
      if (!c) continue;
      const k = `${bucket}:${t.lastSide}`;
      const g = groups.get(k);
      if (g) g.n += 1;
      else groups.set(k, { bucket, side: t.lastSide, n: 1, avatar: t.avatar, name: t.displayName, userId: t.userId, c });
    }
    const out: typeof dots = [];
    for (const [key, g] of groups) {
      const x = chart.timeScale().timeToCoordinate(chartTime(g.bucket));
      const y = main.priceToCoordinate(((g.c.h + g.c.l) / 2) * mult);
      if (x == null || y == null) continue;
      out.push({ key, x, y, side: g.side, n: g.n, avatar: g.avatar, name: g.name, userId: g.userId });
    }
    setDots(out.slice(0, 60));
  }, [wTraders, candles, tfSec, mult, spotTick, showTrades, style]);

  // ── known wallets + platform intel for this token ──
  useEffect(() => {
    setPinItems([]); setPinOpen(null);
    if (!mint || !showTrades) return;
    let alive = true;
    const run = async () => {
      const [wi, co] = await Promise.all([
        chain ? Promise.resolve(null) : fetch(`/api/wallet-intel?mint=${encodeURIComponent(mint)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/callouts?mint=${encodeURIComponent(mint)}&limit=40`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      const out: PinItem[] = [];
      for (const m of ((wi as { marks?: { wallet: string; kind: "dumper" | "proven"; ts: number; sol: number; n: number; wins: number; dumps: number }[] } | null)?.marks ?? [])) {
        out.push({
          kind: m.kind, id: `w:${m.wallet}`, ts: m.ts, wallet: m.wallet, name: walletName(m.wallet), href: `/app/w/${m.wallet}`,
          line: m.kind === "dumper" ? `Repeat dumper · ${m.dumps} of ${m.n} past calls ended in a big loss` : `Proven wallet · early in ${m.wins} past winner${m.wins === 1 ? "" : "s"}`,
          sol: m.sol,
        });
      }
      type Callout = { id: string; userId: string; displayName: string; username: string | null; avatarDataUrl: string; text: string; createdAt: string | number; mcapAtPost: number | null };
      for (const c of ((co as { callouts?: Callout[] } | null)?.callouts ?? [])) {
        const ts = typeof c.createdAt === "number" ? c.createdAt : Date.parse(String(c.createdAt));
        if (!(ts > 0)) continue;
        out.push({ kind: "intel", id: `i:${c.id}`, ts, name: c.displayName, avatar: c.avatarDataUrl, href: `/app/u/${encodeURIComponent(c.username || c.userId)}`, line: "Intel from a Wraith trader", text: String(c.text ?? "").slice(0, 220), mcap: c.mcapAtPost ?? 0 });
      }
      setPinItems(out);
    };
    void run();
    const t = visibleInterval(run, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, [mint, chain, showTrades]);

  // ── place them on the candle they happened in ──
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || !showTrades || !pinItems.length || !candles.length) { setPins([]); return; }
    const step = tfSec * 1000;
    const byBucket = new Map<number, ChartCandle>();
    for (const c of candles) byBucket.set(c.t, c);
    const groups = new Map<string, { bucket: number; kind: PinItem["kind"]; items: PinItem[]; c: ChartCandle }>();
    for (const it of pinItems) {
      // the candle it happened in; thin tokens skip candles when nobody trades, so fall back to the closest one before it
      // (within 3 candles), or the first candle on the chart when it happened just before the chart's data starts
      let c = byBucket.get(Math.floor(it.ts / step) * step);
      if (!c) {
        let lo = 0, hi = candles.length - 1, at = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].t <= it.ts) { at = mid; lo = mid + 1; } else hi = mid - 1; }
        if (at >= 0 && it.ts - candles[at].t <= 3 * step) c = candles[at];
        else if (at < 0 && candles[0].t - it.ts <= 12 * step) c = candles[0];
      }
      if (!c) continue;
      const bucket = c.t;
      const k = `${bucket}:${it.kind}`;
      const g = groups.get(k);
      if (g) g.items.push(it); else groups.set(k, { bucket, kind: it.kind, items: [it], c });
    }
    const W = hostRef.current?.clientWidth ?? 0, H = hostRef.current?.clientHeight ?? 0;
    const out: typeof pins = [];
    for (const [key, g] of groups) {
      const x = chart.timeScale().timeToCoordinate(chartTime(g.bucket));
      const first = g.items[0];
      const at = g.kind === "intel" && effectiveMetric === "mcap" && (first.mcap ?? 0) > 0 ? (first.mcap as number) : ((g.c.h + g.c.l) / 2) * mult;
      const y0 = main.priceToCoordinate(at);
      if (x == null || y0 == null || x < 0 || (W && x > W)) continue;
      // on a shared candle: intel sits above, proven below, dumpers on the price
      const shift = g.kind === "intel" ? -26 : g.kind === "proven" && groups.has(`${g.bucket}:dumper`) ? 26 : 0;
      const y = Math.max(16, y0 + shift);
      // keep the whole card inside the chart: slide it sideways when the pin is near an edge
      const CARD = Math.min(248, Math.max(180, W - 16));
      const cardLeft = (W > 0 ? Math.min(Math.max(x - CARD / 2, 8), Math.max(8, W - CARD - 8)) : x - CARD / 2) - (x - 14);
      out.push({ key, x, y, kind: g.kind, items: g.items, value: g.c.c * mult, cardLeft, up: H > 0 && y > H / 2 });
    }
    setPins(out.slice(0, 80));
  }, [pinItems, candles, tfSec, mult, spotTick, showTrades, style, effectiveMetric]);

  // a tap anywhere else closes the open card
  useEffect(() => {
    if (!pinOpen) return;
    const away = (e: PointerEvent) => { if (!(e.target as HTMLElement | null)?.closest?.(".wx-pin")) setPinOpen(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinOpen]);

  // ── push candles into series ──────────────────────────────────────────
  useEffect(() => {
    const main = mainRef.current;
    const vol = volRef.current;
    const chart = chartRef.current;
    if (!main || !vol || !chart) return;

    candlesRef.current = candles.map((c) => ({ ...c }));
    if (!candles.length) {
      main.setData([]);
      vol.setData([]);
      pushedRef.current = null;
      return;
    }

    // The 10s history poll can lag the live price (different providers, cached bars). Re-applying the newest live tick to the
    // running candle on every poll keeps ONE source of truth: before this the poll reset the last bar to its stale close, the
    // next live tick pulled it back, and the candle jumped up and down forever.
    {
      const lp = livePriceRef.current;
      const rows = candlesRef.current;
      const tail = rows[rows.length - 1];
      if (lp && tail && lp < tail.c * 20 && lp > tail.c / 20) {
        const stepMs = tfSec * 1000;
        const bucket = Math.floor(Date.now() / stepMs) * stepMs;
        if (tail.t < bucket) {
          rows.push({ t: bucket, o: tail.c, h: Math.max(tail.c, lp), l: Math.min(tail.c, lp), c: lp, v: 0 });
        } else {
          tail.c = lp;
          tail.h = Math.max(tail.h, lp);
          tail.l = Math.min(tail.l, lp);
        }
      }
    }
    const candlesView = candlesRef.current;

    const mkMain = (c: ChartCandle) =>
      style === "candles"
        ? { time: chartTime(c.t), open: c.o * mult, high: c.h * mult, low: c.l * mult, close: c.c * mult }
        : { time: chartTime(c.t), value: c.c * mult };
    const mkVol = (c: ChartCandle) => ({ time: chartTime(c.t), value: c.v, color: c.c >= c.o ? "rgba(38,166,154,0.42)" : "rgba(239,83,80,0.42)" });

    // Same series, only the tail changed (the 10s poll): update the last bars in place.
    // No full redraw, no flicker, and the viewport and any measure box stay put.
    const key = `${mint}|${chain ?? ""}|${tf}|${style}|${mult}`;
    const prev = pushedRef.current;
    if (prev && prev.key === key && prev.first === candlesView[0].t && candlesView.length >= prev.len && candlesView.length - prev.len <= 4) {
      try {
        for (let i = Math.max(0, prev.len - 2); i < candlesView.length; i++) {
          (main as ISeriesApi<"Candlestick">).update(mkMain(candlesView[i]) as never);
          vol.update(mkVol(candlesView[i]));
        }
        pushedRef.current = { key, first: candlesView[0].t, len: candlesView.length };
        return;
      } catch {
        // chart already holds a newer live bar than this poll (or similar): fall through to a full redraw
      }
    }

    const seen = new Set<number>();
    const mainData: unknown[] = [];
    const volData: { time: UTCTimestamp; value: number; color: string }[] = [];
    for (const c of candlesView) {
      const time = chartTime(c.t);
      if (seen.has(time)) continue;
      seen.add(time);
      mainData.push(mkMain(c));
      volData.push(mkVol(c));
    }
    (main as ISeriesApi<"Candlestick">).setData(mainData as never);
    vol.setData(volData);
    pushedRef.current = { key, first: candlesView[0].t, len: candlesView.length };

    if (needFitRef.current) {
      needFitRef.current = false;
      const n = mainData.length;
      // Always the same comfortable framing: ~60-90 bars across, newest bar near the right edge.
      // A young token with 8 candles therefore sits at the right with normal-width candles, not stretched wide.
      const span = Math.max(60, Math.min(n, 90));
      chart.timeScale().setVisibleLogicalRange({ from: n - span, to: n + 6 });
      // a previous token (or a drag on the price axis) can leave auto-scale off: turn it back on so every token is framed properly
      try { main.priceScale().applyOptions({ autoScale: true }); } catch { /* series gone */ }
    }
  }, [candles, style, mult, mint, chain, tf, tfSec]);

  // ── merge live price into the running candle ──────────────────────────
  useEffect(() => {
    const main = mainRef.current;
    const list = candlesRef.current;
    if (!main || !livePrice || !(livePrice > 0)) return;
    if (livePrice === lastTickRef.current) return;
    lastTickRef.current = livePrice;

    const step = tfSec * 1000;
    const bucket = Math.floor(Date.now() / step) * step;
    // No history yet (new token / provider slow): start the chart from live trades.
    if (!list.length) list.push({ t: bucket, o: livePrice, h: livePrice, l: livePrice, c: livePrice, v: 0 });
    let last = list[list.length - 1];
    // Ignore ticks wildly off the series (stale provider glitch).
    if (livePrice > last.c * 20 || livePrice < last.c / 20) return;

    if (last.t < bucket) {
      const next: ChartCandle = { t: bucket, o: last.c, h: Math.max(last.c, livePrice), l: Math.min(last.c, livePrice), c: livePrice, v: 0 };
      list.push(next);
      last = next;
    } else {
      last.c = livePrice;
      last.h = Math.max(last.h, livePrice);
      last.l = Math.min(last.l, livePrice);
    }
    const time = chartTime(last.t);
    if (statusRef.current !== "ready" && list.length >= 3) setStatus("ready"); // a lone live bar is not a chart: wait for history (or 3+ live bars)
    if (style === "candles") {
      (main as ISeriesApi<"Candlestick">).update({
        time,
        open: last.o * mult,
        high: last.h * mult,
        low: last.l * mult,
        close: last.c * mult,
      });
    } else {
      (main as ISeriesApi<"Area">).update({ time, value: last.c * mult });
    }
  }, [livePrice, style, mult, tfSec]);

  // ── fetch + poll ──────────────────────────────────────────────────────
  const load = useCallback(
    async (initial: boolean) => {
      const id = ++reqRef.current;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const res = await fetch(chain ? `/api/evm-chart?address=${encodeURIComponent(mint)}&chain=${encodeURIComponent(chain)}&tf=${tf}` : `/api/token-chart?address=${encodeURIComponent(mint)}&tf=${tf}${onCurveRef.current ? "&curve=1" : ""}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (id !== reqRef.current) return;
        if (!res.ok) throw new Error(String(res.status));
        const data: { candles?: ChartCandle[]; source?: string; stale?: boolean } = await res.json();
        if (id !== reqRef.current) return;
        let rows = Array.isArray(data.candles) ? data.candles : [];
        // Sanity check against the live price. The last candle is minutes old, so it can only be a few % from the live price.
        // If it is off by 8x or more, the series came from the wrong pool or the wrong units (this is how a $253K token showed
        // $968M). Rescale so the chart ends at the real price instead of showing a number that is plainly wrong.
        const lp = livePriceRef.current;
        const lastC = rows.length ? rows[rows.length - 1].c : 0;
        if (lp && lastC > 0) {
          const r = lp / lastC;
          if (r > 8 || r < 1 / 8) rows = rows.map((c) => ({ ...c, o: c.o * r, h: c.h * r, l: c.l * r, c: c.c * r }));
        }
        setSource(data.source ?? "");
        setStale(Boolean(data.stale));
        if (rows.length) {
          rowCache.set(`${mint}:${chain ?? ""}:${tf}`, rows);
          setCandles(rows);
          setStatus("ready");
        } else if (initial || candlesRef.current.length === 0) {
          setCandles([]);
          setStatus("empty");
        }
      } catch {
        if (id !== reqRef.current) return;
        if (candlesRef.current.length === 0) setStatus("error");
      } finally {
        clearTimeout(timer);
      }
    },
    [mint, tf, chain],
  );

  const statusRef = useRef<Status>("loading");
  statusRef.current = status;

  useEffect(() => {
    needFitRef.current = true;
    lastTickRef.current = 0;
    setLegend(null);

    // Instant first paint from the client cache (populated by MemeScanner
    // hover-prefetch or a prior visit). Falls back to the shimmer overlay if
    // the cache is cold — the background load() below fills it either way.
    const mem = rowCache.get(`${mint}:${chain ?? ""}:${tf}`);
    let cached: Partial<ChartCandle>[] = mem ?? peekCandles(mint, tf);
    if (!cached.length) cached = deriveLocal(mint, chain, tf, TIMEFRAMES.find((x) => x.key === tf)?.sec ?? 900);
    if (cached.length) {
      const withVol: ChartCandle[] = (cached as Partial<ChartCandle>[]).map((c) => ({ v: 0, ...c } as ChartCandle));
      candlesRef.current = withVol.map((c) => ({ ...c }));
      setCandles(withVol);
      setStatus("ready");
    } else {
      candlesRef.current = [];
      setCandles([]);
      setStatus("loading");
    }

    void load(true);

    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(
        () => {
          if (!document.hidden) void load(false);
          tick();
        },
        statusRef.current === "ready" ? POLL_MS : EMPTY_POLL_MS,
      );
    };
    tick();
    const onPull = () => void load(true); // pull-to-refresh
    window.addEventListener("wraith:refresh", onPull);
    return () => {
      reqRef.current++;
      clearTimeout(timer);
      window.removeEventListener("wraith:refresh", onPull);
    };
  // mint and tf are also captured via peekCandles — adding them is redundant
  // (load already re-creates when they change) but keeps exhaustive-deps happy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, mint, tf]);

  const last = candles[candles.length - 1];
  const shown = legend ?? last ?? null;
  const first = candles[0];
  const rangeChange = first && last ? ((last.c - first.o) / first.o) * 100 : null;
  const fmtVal = (n: number) => (effectiveMetric === "mcap" ? fmtUsd(n * mult, { decimals: 2 }) : fmtPrice(n));

  // measure overlay geometry (recomputed every render so it follows pan/zoom)
  const measureView = (() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!measure || !chart || !main) return null;
    const ts = chart.timeScale();
    const x1 = ts.logicalToCoordinate(measure.a.logical as Logical);
    const x2 = ts.logicalToCoordinate(measure.b.logical as Logical);
    const y1 = main.priceToCoordinate(measure.a.value);
    const y2 = main.priceToCoordinate(measure.b.value);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
    const delta = measure.b.value - measure.a.value;
    const pct = measure.a.value > 0 ? (delta / measure.a.value) * 100 : 0;
    const bars = Math.round(measure.b.logical - measure.a.logical);
    const secs = Math.abs(bars) * tfSec;
    const dur = secs < 3600 ? `${Math.round(secs / 60)}m` : secs < 86400 ? `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m` : `${Math.floor(secs / 86400)}d ${Math.round((secs % 86400) / 3600)}h`;
    const absDelta = Math.abs(delta);
    return {
      left: Math.min(x1, x2), top: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      x1, x2, y1, y2, up: delta >= 0, pct, bars,
      // same layout as TradingView: change, then (percent)
      line1: `${delta < 0 ? "-" : ""}${effectiveMetric === "mcap" ? fmtUsd(absDelta, { decimals: 2 }) : fmtPrice(absDelta)} (${pct.toFixed(2)}%)`,
      line2: `${bars >= 0 ? "" : "-"}${Math.abs(bars)} bars, ${dur}`,
    };
  })();

  // screen-space box of each drawing, used for drag-select / tap-select hit tests
  boxFnRef.current = (d: Drawing) => {
    const chart = chartRef.current, main = mainRef.current, first = candlesRef.current[0];
    if (!chart || !main || !first) return null;
    const ts = chart.timeScale();
    const step = tfSec * 1000;
    const X = (t: number) => ts.logicalToCoordinate(((t - first.t) / step) as Logical);
    const Y = (pr: number) => main.priceToCoordinate(pr * mult);
    const W = hostRef.current?.clientWidth ?? 0;
    const x1 = X(d.a.t), x2 = X(d.b.t), y1 = Y(d.a.p), y2 = Y(d.b.p);
    if (y1 === null) return null;
    if (d.kind === "hline") return { l: 0, r: W, t: y1 - 5, b: y1 + 5 };
    if (x1 === null || x2 === null || y2 === null) return null;
    return { l: Math.min(x1, x2), r: Math.max(x1, x2), t: Math.min(y1, y2) - 4, b: Math.max(y1, y2) + 4 };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* toolbar */}
      <div className="wx-chart-toolbar">
        <div className="wx-seg" role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tf === x.key}
              className={tf === x.key ? "on" : ""}
              onClick={() => {
                setTf(x.key);
                writePref("wraith_chart_tf", x.key);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="wx-seg" aria-label="Chart value">
          {(["mcap", "price"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={effectiveMetric === m ? "on" : ""}
              disabled={m === "mcap" && !supplyKey}
              title={m === "mcap" && !supplyKey ? "Market cap unavailable for this token" : undefined}
              onClick={() => {
                setMetric(m);
                writePref("wraith_chart_metric", m);
              }}
            >
              {m === "mcap" ? "MCap" : "Price"}
            </button>
          ))}
        </div>
        <div className="wx-seg" aria-label="Chart style">
          {(["candles", "line"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={style === s ? "on" : ""}
              onClick={() => {
                setStyle(s);
                writePref("wraith_chart_style", s);
              }}
            >
              {s === "candles" ? "Candles" : "Line"}
            </button>
          ))}
        </div>
        <ChartToolsMenu
          active={tool ?? (measureMode || (measure && !measure.locked) ? "measure" : selectMode ? "select" : null)}
          drawCount={drawings.length}
          selCount={selected.length}
          onPick={(id: ToolId) => {
            // one tool at a time: picking one switches the others off, picking the active one again turns it off
            const wasTool = tool, wasMeasure = measureMode || !!(measure && !measure.locked), wasSelect = selectMode;
            setMeasure(null); setMeasureMode(false); setDraft(null); setSelectMode(false); setSelected([]); setTool(null);
            if (id === "measure") { if (!wasMeasure) setMeasureMode(true); }
            else if (id === "select") { if (!wasSelect) setSelectMode(true); }
            else if (wasTool !== id) setTool(id);
          }}
          onDelete={() => {
            if (selected.length) { const gone = new Set(selected); setDrawings((d) => d.filter((x) => !gone.has(x.id))); setSelected([]); }
            else { setDrawings([]); setDraft(null); }
          }}
        />
        {trades && (
          <button type="button" className={`wx-icon-btn${showTrades ? " on" : ""}`} onClick={() => setShowTrades((v) => !v)} aria-pressed={showTrades} aria-label="Show who bought here: Wraith traders, known wallets and intel. Wraith trader buys and sells" title="Buys / sells by Wraith traders" style={{ width: "auto", padding: "0 9px", fontSize: 10, fontWeight: 700 }}>
            B/S
          </button>
        )}
        <button type="button" className="wx-icon-btn" onClick={() => { try { chartRef.current?.priceScale("right").applyOptions({ autoScale: true }); chartRef.current?.timeScale().scrollToRealTime(); } catch { /* ignore */ } void load(true); }} aria-label="Reset chart" title="Reset view / refresh">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* OHLC legend */}
      <div className="wx-legend">
        {shown ? (
          <>
            <span>O <b>{fmtVal(shown.o)}</b></span>
            <span>H <b>{fmtVal(shown.h)}</b></span>
            <span>L <b>{fmtVal(shown.l)}</b></span>
            <span>C <b style={{ color: shown.c >= shown.o ? UP : DOWN }}>{fmtVal(shown.c)}</b></span>
            {shown.v > 0 && <span>Vol <b>{fmtUsd(shown.v)}</b></span>}
            {rangeChange !== null && !legend && (
              <span style={{ color: rangeChange >= 0 ? UP : DOWN }}>{fmtPct(rangeChange)}</span>
            )}
          </>
        ) : (
          <span style={{ opacity: 0.6 }}>—</span>
        )}
        <span style={{ flex: 1 }} />
        {source && (
          <span className="wx-src" title={stale ? "Showing last known data; provider is slow" : `Source: ${source}`}>
            {stale ? "stale · " : ""}
            {source.replace("geckoterminal", "gecko").replace("pumpfun-onchain", "on-chain")}
          </span>
        )}
      </div>

      {/* chart surface */}
      <div style={{ position: "relative", flex: 1, minHeight: 260 }}>
        <div ref={hostRef} style={{ position: "absolute", inset: 0, cursor: measureMode || tool || selectMode || (measure && !measure.locked) ? "crosshair" : undefined, touchAction: tool || selectMode || measureMode || (measure && !measure.locked) ? "none" : undefined }} />

        {(tool || selectMode || measureMode || (measure && !measure.locked)) && (
          <div className="wx-tool-hint" role="status">
            <span>
              {tool === "hline" ? "Tap where the line should go"
                : tool ? (draft ? "Tap or lift your finger at the end point" : "Tap or press where it starts")
                : selectMode ? "Drag a box over drawings to select them"
                : measure && !measure.locked ? "Tap the end point" : "Tap or press the start point"}
            </span>
            <button type="button" onClick={() => { setTool(null); setDraft(null); setMeasure(null); setMeasureMode(false); setSelectMode(false); setSelected([]); }} aria-label="Cancel tool"><X size={13} /></button>
          </div>
        )}

        {status === "ready" && showTrades && dots.length > 0 && (
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 2 }}>
            {dots.map((d) => (
              <a
                key={d.key}
                href={`/app/u/${encodeURIComponent(d.userId)}`}
                title={`${d.name} ${d.side === "buy" ? "bought" : "sold"}${d.n > 1 ? ` (+${d.n - 1} more)` : ""}`}
                style={{ position: "absolute", left: d.x, top: d.y, width: 24, height: 24, transform: "translate(-50%,-50%)", borderRadius: "50%", border: `2px solid ${d.side === "buy" ? UP : DOWN}`, background: "#14141a", overflow: "hidden", pointerEvents: "auto", display: "grid", placeItems: "center", color: "#fff", fontSize: 10, fontWeight: 800, boxShadow: "0 0 0 2px rgba(0,0,0,.5)" }}
              >
                {d.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.avatar} alt="" width={20} height={20} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span>{d.side === "buy" ? "B" : "S"}</span>
                )}
                {d.n > 1 && <i style={{ position: "absolute", right: -2, bottom: -2, minWidth: 12, height: 12, padding: "0 3px", borderRadius: 6, background: d.side === "buy" ? UP : DOWN, color: "#fff", fontSize: 8, fontStyle: "normal", lineHeight: "12px", textAlign: "center" }}>{d.n}</i>}
              </a>
            ))}
          </div>
        )}

        {status === "ready" && showTrades && pins.length > 0 && (
          <div className="wx-pins">
            {pins.map((p) => {
              const first = p.items[0];
              const open = pinOpen === p.key;
              return (
                <div key={p.key} className={`wx-pin ${p.kind}${open ? " open" : ""}`} style={{ left: p.x, top: p.y }}
                  onMouseEnter={() => setPinOpen(p.key)} onMouseLeave={() => setPinOpen((k) => (k === p.key ? null : k))}>
                  <button type="button" className="wx-pin-dot" aria-expanded={open}
                    aria-label={p.kind === "intel" ? `Intel from ${first.name}` : `${p.items.length} ${p.kind === "dumper" ? "repeat-dumper" : "proven"} wallet${p.items.length > 1 ? "s" : ""} bought here`}
                    onClick={(e) => { e.stopPropagation(); setPinOpen(p.key); }}>
                    {p.kind === "intel" && first.avatar
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={first.avatar} alt="" />
                      : first.wallet ? <WalletAvatar address={first.wallet} size={22} /> : <span>{first.name.slice(0, 1).toUpperCase()}</span>}
                    {p.items.length > 1 && <i>{p.items.length}</i>}
                  </button>
                  {open && (
                    <div className={`wx-pin-card${p.up ? " up" : ""}`} style={{ left: p.cardLeft }} role="dialog">
                      <b className="wx-pin-head">
                        {p.kind === "dumper" ? `${p.items.length} repeat dumper${p.items.length > 1 ? "s" : ""} bought here` : p.kind === "proven" ? `${p.items.length} proven wallet${p.items.length > 1 ? "s" : ""} bought here` : "Intel on Wraith"}
                        <em>{effectiveMetric === "mcap" ? `${fmtUsd(p.value)} mcap` : fmtPrice(p.value)}</em>
                      </b>
                      {p.items.slice(0, 5).map((it) => (
                        <a key={it.id} href={it.href} className="wx-pin-row">
                          <span className="wx-pin-who">
                            <strong>{it.name}</strong>
                            <small>{new Date(it.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{it.sol && it.sol > 0 ? ` · bought ${it.sol >= 10 ? it.sol.toFixed(1) : it.sol.toFixed(2)} SOL` : ""}</small>
                          </span>
                          {it.text ? <span className="wx-pin-text">{it.text}</span> : <span className="wx-pin-line">{it.line}</span>}
                        </a>
                      ))}
                      {p.items.length > 5 && <small className="wx-pin-more">+{p.items.length - 5} more</small>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {spotPos && status === "ready" && (
          <div
            onMouseEnter={(e) => {
              if (spotCloseRef.current) { clearTimeout(spotCloseRef.current); spotCloseRef.current = null; }
              if (!spotPinRef.current) { setSpotRect(e.currentTarget.getBoundingClientRect()); setSpotHover(true); }
            }}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              if (spotPinRef.current) { spotPinRef.current = false; setSpotHover(false); }
              else { spotPinRef.current = true; setSpotRect(r); setSpotHover(true); }
            }}
            onMouseLeave={() => {
              if (spotPinRef.current) return;
              if (spotCloseRef.current) clearTimeout(spotCloseRef.current);
              spotCloseRef.current = setTimeout(() => setSpotHover(false), 350); // grace period: the chart may nudge the marker
            }}
            style={{ position: "absolute", left: spotPos.x, top: Math.max(4, spotPos.y - 34), transform: "translateX(-50%)", pointerEvents: "auto", cursor: "pointer", padding: "6px 8px", touchAction: "manipulation", display: "flex", flexDirection: "column", alignItems: "center", zIndex: 5 }}
          >
            {(spotHover || spotPres.mounted) && spotCard && spotRect && typeof document !== "undefined" && createPortal(
              (() => {
                // Rendered on <body> so the chart frame can never clip it; flips above/below by available room.
                const vh = window.innerHeight, vw = window.innerWidth;
                if (vw < 768) {
                  return (
                    <div className={`wx-spot-sheet-back${spotPres.out ? " out" : ""}`} onClick={(e) => { e.stopPropagation(); setSpotHover(false); }}>
                      <div className={`wx-spot-sheet${spotPres.out ? " out" : ""}`} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="wx-spot-sheet-x" onClick={() => setSpotHover(false)} aria-label="Close">×</button>
                        {spotCard}
                      </div>
                    </div>
                  );
                }
                const cx = Math.min(vw - 200, Math.max(200, spotRect.left + spotRect.width / 2));
                const above = spotRect.top > vh / 2;
                const pos = above
                  ? { bottom: vh - spotRect.top + 8, maxHeight: Math.max(160, spotRect.top - 16) }
                  : { top: spotRect.bottom + 8, maxHeight: Math.max(160, vh - spotRect.bottom - 16) };
                return <div style={{ position: "fixed", left: cx, transform: "translateX(-50%)", zIndex: 1300, overflowY: "auto", pointerEvents: "none", ...pos }}>{spotCard}</div>;
              })(),
              document.body,
            )}
            <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#0c0c10", border: "1.5px solid #ff7b3d", boxShadow: "0 0 12px rgba(255,123,61,.65)", display: "grid", placeItems: "center", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" width={15} height={17} style={{ objectFit: "contain" }} />
            </span>
            <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "6px solid #ff7b3d", marginTop: -1 }} />
          </div>
        )}

        {(drawings.length > 0 || draft || marquee) && chartRef.current && mainRef.current && (() => {
          const ts = chartRef.current!.timeScale();
          const main = mainRef.current!;
          const first = candlesRef.current[0];
          if (!first) return null;
          const step = tfSec * 1000;
          const X = (t: number) => ts.logicalToCoordinate(((t - first.t) / step) as Logical);
          const Y = (pr: number) => main.priceToCoordinate(pr * mult);
          const all = draft ? [...drawings, draft] : drawings;
          const W = hostRef.current?.clientWidth ?? 0;
          const LV = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
          const col = (id: string) => (selected.includes(id) ? "#ff7b3d" : "#4f9dff");
          return (
            <div className="wx-measure wx-draw" aria-hidden="true">
              <svg className="wx-measure-svg" width="100%" height="100%">
                {all.map((d) => {
                  const x1 = X(d.a.t), x2 = X(d.b.t), y1 = Y(d.a.p), y2 = Y(d.b.p);
                  if (y1 === null) return null;
                  if (d.kind === "hline") {
                    return (<g key={d.id}><line x1={0} x2={W} y1={y1} y2={y1} stroke={col(d.id)} strokeWidth={selected.includes(d.id) ? 2 : 1} /><text x={W - 8} y={y1 - 4} textAnchor="end" fill={col(d.id)} fontSize="10">{fmtVal(d.a.p * mult / (mult || 1))}</text></g>);
                  }
                  if (x1 === null || x2 === null || y2 === null) return null;
                  if (d.kind === "trend") return (<line key={d.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col(d.id)} strokeWidth={selected.includes(d.id) ? 2.5 : 1.5} />);
                  if (d.kind === "rect") return (<rect key={d.id} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={selected.includes(d.id) ? "rgba(255,123,61,.16)" : "rgba(79,157,255,.14)"} stroke={col(d.id)} strokeWidth={selected.includes(d.id) ? 2 : 1} />);
                  const xl = Math.min(x1, x2), xr = Math.max(x1, x2);
                  return (
                    <g key={d.id}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeDasharray="3 3" />
                      {LV.map((lv) => {
                        const pr = d.b.p + (d.a.p - d.b.p) * lv;
                        const yy = Y(pr);
                        if (yy === null) return null;
                        return (<g key={lv}><line x1={xl} x2={xr} y1={yy} y2={yy} stroke={selected.includes(d.id) ? "#ff7b3d" : "#f0b90b"} strokeWidth={selected.includes(d.id) ? 2 : 1} opacity=".9" /><text x={xl + 4} y={yy - 3} fill="#f0b90b" fontSize="10">{lv} ({fmtVal(pr)})</text></g>);
                      })}
                    </g>
                  );
                })}
                {marquee && (
                  <rect x={Math.min(marquee.x1, marquee.x2)} y={Math.min(marquee.y1, marquee.y2)} width={Math.abs(marquee.x2 - marquee.x1)} height={Math.abs(marquee.y2 - marquee.y1)} fill="rgba(79,157,255,.15)" stroke="#4f9dff" strokeWidth="1" />
                )}
              </svg>
            </div>
          );
        })()}
        {selected.length > 0 && (
          <button
            type="button"
            className="wx-draw-del"
            onClick={() => { const gone = new Set(selected); setDrawings((d) => d.filter((x) => !gone.has(x.id))); setSelected([]); }}
          >
            <Trash2 size={13} /> Delete {selected.length}
          </button>
        )}

        {measureView && (
          <div className="wx-measure" aria-hidden="true">
            <div
              className={`wx-measure-box ${measureView.up ? "up" : "down"}${measure?.locked ? " locked" : ""}`}
              style={{ left: measureView.left, top: measureView.top, width: measureView.w, height: measureView.h }}
            />
            <svg className="wx-measure-svg" width="100%" height="100%">
              <defs>
                <marker id="wxm-arrow" markerUnits="userSpaceOnUse" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M1 1.5 L9 5 L1 8.5z" fill={measureView.up ? "#4f7cff" : "#ff5b5b"} />
                </marker>
              </defs>
              <line x1={measureView.x1} y1={(measureView.y1 + measureView.y2) / 2} x2={measureView.x2} y2={(measureView.y1 + measureView.y2) / 2} stroke={measureView.up ? "#4f7cff" : "#ff5b5b"} strokeWidth="1" markerEnd="url(#wxm-arrow)" />
              <line x1={(measureView.x1 + measureView.x2) / 2} y1={measureView.y1} x2={(measureView.x1 + measureView.x2) / 2} y2={measureView.y2} stroke={measureView.up ? "#4f7cff" : "#ff5b5b"} strokeWidth="1" markerEnd="url(#wxm-arrow)" />
            </svg>
            <div
              className={`wx-measure-label ${measureView.up ? "up" : "down"}`}
              style={
                measureView.top > 64
                  ? { left: measureView.left + measureView.w / 2, top: measureView.top - 8, transform: "translate(-50%, -100%)" }
                  : { left: measureView.left + measureView.w / 2, top: measureView.top + measureView.h + 8, transform: "translate(-50%, 0)" }
              }
            >
              <b>{measureView.line1}</b>
              <span>{measureView.line2}</span>
            </div>
          </div>
        )}

        {away && status === "ready" && (
          <button type="button" className="wx-chart-latest" onClick={() => chartRef.current?.timeScale().scrollToRealTime()} aria-label="Jump to latest candle">
            Latest ›
          </button>
        )}

        {status === "loading" && (
          <div className="wx-chart-overlay">
            <div className="wx-skel" style={{ width: "100%", height: "100%", borderRadius: 0, opacity: 0.55 }} />
            <span className="wx-chart-msg">Loading chart…</span>
          </div>
        )}
        {status === "empty" && (
          <div className="wx-chart-overlay">
            <div className="wx-chart-msg-box">
              <strong>No candles yet</strong>
              <span>Checking for first trades — this retries automatically.</span>
              <button type="button" className="wx-btn" onClick={() => void load(true)}>
                <RefreshCw size={12} /> Retry now
              </button>
            </div>
          </div>
        )}
        {status === "error" && (
          <div className="wx-chart-overlay">
            <div className="wx-chart-msg-box">
              <strong>Couldn&apos;t load the chart</strong>
              <span>The data providers didn&apos;t respond. Try again in a moment.</span>
              <button type="button" className="wx-btn" onClick={() => void load(true)}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
