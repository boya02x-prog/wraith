"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CandlestickSeries,
} from "lightweight-charts";
import { Pencil, X, Check } from "lucide-react";
import { C } from "@/lib/theme";
import { getCandles, peekCandles, prefetchCandles, type Candle } from "@/lib/candleCache";
import { quickPaperBuy, getPaperBalance } from "@/lib/paperTrading";
import {
  getActivePreset,
  saveActivePresetAmounts,
} from "@/lib/quickBuyPresets";
import { useCash, readCurrency } from "@/lib/cash";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

const HOVER_DELAY_MS = 100;
const TIMEFRAMES = ["1m", "5m", "1h"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

/** Readable price for any size: 0.0000612, 0.0₅1234 style for micro-caps, plain for normal ones. */
function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "0";
  const a = Math.abs(p);
  if (a >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return p.toFixed(2);
  if (a >= 0.01) return p.toFixed(4);
  const zeros = Math.floor(-Math.log10(a)) - 1;
  if (zeros >= 4) {
    const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
    const digits = a.toFixed(zeros + 4).replace(/^0\.0*/, "").slice(0, 4);
    return `0.0${sub}${digits}`;
  }
  return p.toFixed(zeros + 4);
}

function sanitize(raw: Candle[]): Candle[] {
  if (!raw.length) return [];
  const sorted = [...raw].sort((a, b) => a.t - b.t);
  const deduped = Array.from(new Map(sorted.map((c) => [c.t, c])).values());
  const valid = deduped.filter((c) =>
    [c.o, c.h, c.l, c.c].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
    ),
  );
  if (!valid.length) return [];
  const closes = valid.map((c) => c.c).sort((a, b) => a - b);
  const median = closes[Math.floor(closes.length / 2)];
  if (!median) return valid;
  return valid.filter((c) =>
    [c.o, c.h, c.l, c.c].every((v) => v / median > 0.01 && v / median < 100),
  );
}

/**
 * The chart surface itself. No card chrome — just the plot, timeframe
 * strip, and TradingView badge, matching Telemetry's proportions (roughly
 * 340x260 including toolbar).
 */
function ChartSurface({
  contractAddress,
  tf,
  onTfChange,
}: {
  contractAddress: string;
  tf: Timeframe;
  onTfChange: (tf: Timeframe) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(false);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [up, setUp] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8a8a8a",
        fontSize: 11,
        attributionLogo: false,
        fontFamily: MONO.fontFamily,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#161616" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#333", labelBackgroundColor: "#1a1a1a" },
        horzLine: { color: "#333", labelBackgroundColor: "#1a1a1a" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.06 },
        minimumWidth: 64,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 6,
      },
      handleScroll: false,
      handleScale: false,
    });

    chartRef.current = chart;
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      borderVisible: false,
      wickUpColor: C.green,
      wickDownColor: C.red,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineStyle: 2,
      priceLineColor: "#444",
      priceFormat: { type: "custom", minMove: 1e-12, formatter: fmtPrice },
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    function applyData(candles: Candle[]) {
      if (!seriesRef.current) return;
      const data: CandlestickData<Time>[] = candles.map((c) => ({
        time: (c.t / 1000) as Time,
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      }));
      seriesRef.current.setData(data);
      // With only a few candles, fitContent would stretch them into fat bars; keep them slim and pinned to the right.
      if (data.length >= 40) chartRef.current?.timeScale().fitContent();
      else chartRef.current?.timeScale().setVisibleLogicalRange({ from: data.length - 48, to: data.length + 3 });
      const last = candles[candles.length - 1];
      const first = candles[0];
      setLastPrice(last.c);
      setUp(last.c >= first.c);
    }

    const cached = sanitize(peekCandles(contractAddress, tf));
    if (cached.length) {
      setHasData(true);
      setLoading(false);
      applyData(cached);
    }

    if (!cached.length) { seriesRef.current?.setData([]); setHasData(false); }

    const pull = (retry: boolean) =>
      getCandles(contractAddress, tf).then((raw) => {
        if (!alive) return;
        const valid = sanitize(raw);
        setLoading(false);
        if (valid.length) {
          setHasData(true);
          applyData(valid);
          // warm the other timeframes so switching is instant
          TIMEFRAMES.forEach((f) => { if (f !== tf) prefetchCandles(contractAddress, f); });
        } else if (retry) {
          setLoading(true);
          setTimeout(() => { if (alive) void pull(false); }, 1800);
        } else if (!cached.length) {
          setHasData(false);
        }
      });
    void pull(true);
    // keep the chart live while the card is open
    const live = setInterval(() => { if (alive && !document.hidden) void pull(false); }, 15_000);

    return () => {
      alive = false;
      clearInterval(live);
    };
  }, [contractAddress, tf]);

  return (
    <div style={{ width: "100%" }}>
      {/* Toolbar row — timeframe tabs + last price, Telemetry-style */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 2px 8px",
        }}
      >
        <div style={{ display: "flex", gap: 2 }}>
          {TIMEFRAMES.map((f) => (
            <button
              key={f}
              onClick={(e) => {
                e.stopPropagation();
                onTfChange(f);
              }}
              style={{
                background: tf === f ? "#222" : "transparent",
                border: "none",
                color: tf === f ? "#fff" : "#6a6a6a",
                fontSize: 11.5,
                fontWeight: tf === f ? 700 : 500,
                padding: "4px 10px",
                borderRadius: 6,
                cursor: "pointer",
                ...MONO,
              }}
            >
              {f}
            </button>
          ))}
        </div>
        {lastPrice !== null && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: up ? C.green : C.red,
              ...MONO,
            }}
          >
            ${fmtPrice(lastPrice)}
          </span>
        )}
      </div>

      <div style={{ width: "100%", height: 240, position: "relative" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {!hasData && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              color: "#3a3a3a",
              fontSize: 9,
              ...MONO,
            }}
          >
            <span>{loading ? "LOADING…" : "NO CHART DATA YET"}</span>
            {!loading && (
              <span style={{ fontSize: 8, color: "#2a2a2a" }}>
                too new for a DEX pair — check back after migration
              </span>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// Fixed-SOL presets vs percent-of-paper-balance presets. Percent ones are
// resolved against the LIVE paper balance at click time, not when the card
// mounted — someone could've bought something else in the meantime.
type QuickBuyPreset =
  | { kind: "fixed"; label: string; cashAmt: number }
  | { kind: "pct"; label: string; pct: number };

const DEFAULT_FIXED_AMOUNTS: [number, number] = [5, 20];

// Amounts now live in the shared preset store (lib/quickBuyPresets.ts) so
// they're the same ones shown/edited in the header's Presets panel — only
// the two fixed-SOL slots are editable here, the percent presets stay
// relative to live paper balance.
function buildPresets(fixed: [number, number], fmt: (n: number) => string): QuickBuyPreset[] {
  return [
    { kind: "fixed", label: fmt(fixed[0]), cashAmt: fixed[0] },
    { kind: "fixed", label: fmt(fixed[1]), cashAmt: fixed[1] },
    { kind: "pct", label: "50%", pct: 0.5 },
    { kind: "pct", label: "100%", pct: 1 },
  ];
}

/**
 * Small inline popover for editing the two fixed-SOL preset amounts.
 * Persists via the shared quick-buy preset store so the edited amounts
 * stick across tokens, the header's Presets panel, and future sessions —
 * not just this one hover card.
 */
function PresetEditor({
  fixed,
  onSave,
  onClose,
}: {
  fixed: [number, number];
  onSave: (next: [number, number]) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState(fixed[0].toString());
  const [b, setB] = useState(fixed[1].toString());

  function commit() {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    const next: [number, number] = [
      Number.isFinite(na) && na > 0 ? na : fixed[0],
      Number.isFinite(nb) && nb > 0 ? nb : fixed[1],
    ];
    onSave(next);
    onClose();
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 6,
        padding: 8,
        background: "#0d0d0d",
        border: "1px solid #1e1e1e",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {[[a, setA] as const, [b, setB] as const].map(([val, setVal], i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <input
            value={val}
            onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") onClose();
            }}
            inputMode="decimal"
            style={{
              width: 46,
              background: "#111",
              border: "1px solid #222",
              borderRadius: 3,
              color: "#ddd",
              fontSize: 10,
              padding: "4px 5px",
              ...MONO,
            }}
          />
          <span style={{ fontSize: 8, color: "#555", ...MONO }}>{readCurrency()}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
        <button
          onClick={commit}
          title="Save"
          style={{
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0d1f18",
            border: "1px solid #1c3a2c",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          <Check size={11} color={C.green} />
        </button>
        <button
          onClick={onClose}
          title="Cancel"
          style={{
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          <X size={11} color="#666" />
        </button>
      </div>
    </div>
  );
}

interface QuickBuyRowProps {
  mint: string;
  symbol: string;
  imageUrl?: string;
}

/**
 * PAPER-ACCOUNT quick buy — one click, no confirmation, fires instantly via
 * lib/paperTrading.ts. Deliberately never touches the live/hot-wallet path;
 * see the comment at the top of that module for why.
 */
function QuickBuyRow({ mint, symbol, imageUrl }: QuickBuyRowProps) {
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [fixedAmounts, setFixedAmounts] = useState<[number, number]>(
    DEFAULT_FIXED_AMOUNTS,
  );
  const [editing, setEditing] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the active preset's amounts on mount — this runs client-side only,
  // so the server-rendered pass still uses DEFAULT_FIXED_AMOUNTS and there's
  // no hydration mismatch beyond a one-frame flash of the defaults.
  useEffect(() => {
    setFixedAmounts(getActivePreset().amounts);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  const cash = useCash();
  const presets = buildPresets(fixedAmounts, cash.fmt);

  async function fire(preset: QuickBuyPreset) {
    if (pendingLabel) return; // one buy in flight at a time
    const solFromCash = preset.kind === "fixed" ? cash.toSol(preset.cashAmt) : null;
    if (preset.kind === "fixed" && !(solFromCash && solFromCash > 0)) {
      setFeedback({ ok: false, msg: "Loading price, try again in a second" });
      return;
    }
    const amountSol =
      preset.kind === "fixed"
        ? parseFloat((solFromCash as number).toFixed(5))
        : parseFloat((getPaperBalance() * preset.pct).toFixed(4));

    if (!amountSol || amountSol <= 0) {
      setFeedback({ ok: false, msg: "Nothing to buy with" });
      return;
    }

    setPendingLabel(preset.label);
    setFeedback(null);
    const result = await quickPaperBuy({ mint, symbol, amountSol, imageUrl });
    setPendingLabel(null);
    setFeedback({ ok: result.ok, msg: result.message });

    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {presets.map((p) => {
          const isPending = pendingLabel === p.label;
          const disabled = pendingLabel !== null;
          return (
            <button
              key={p.label}
              onClick={(e) => {
                e.stopPropagation();
                fire(p);
              }}
              disabled={disabled}
              style={{
                flex: 1,
                background: isPending ? "#111" : "#0d1f18",
                border: `1px solid ${isPending ? "#1e1e1e" : "#1c3a2c"}`,
                color: isPending ? "#666" : C.green,
                fontSize: 10,
                fontWeight: 700,
                padding: "7px 0",
                borderRadius: 4,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled && !isPending ? 0.4 : 1,
                ...MONO,
              }}
            >
              {isPending ? "…" : p.label}
            </button>
          );
        })}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing((v) => !v);
          }}
          title="Edit buy presets"
          style={{
            width: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: editing ? "#1a1a1a" : "#111",
            border: `1px solid ${editing ? "#333" : "#1e1e1e"}`,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          <Pencil size={11} color={editing ? "#aaa" : "#555"} />
        </button>
      </div>

      {editing && (
        <PresetEditor
          fixed={fixedAmounts}
          onSave={(next) => {
            setFixedAmounts(next);
            saveActivePresetAmounts(next);
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {/* PAPER label — this row only ever trades the paper account, make
          that visible instead of implying it's live. */}
      <div
        style={{
          marginTop: 6,
          fontSize: 8,
          color: "#444",
          ...MONO,
          letterSpacing: "0.08em",
          textAlign: "center" as const,
        }}
      >
        PAPER ACCOUNT · NO CONFIRMATION
      </div>

      {feedback && (
        <div
          style={{
            marginTop: 6,
            fontSize: 9,
            ...MONO,
            color: feedback.ok ? C.green : C.red,
            textAlign: "center" as const,
            lineHeight: 1.5,
          }}
        >
          {feedback.msg}
        </div>
      )}
    </div>
  );
}

/**
 * The full clean panel — one long dedicated space, matching Telemetry's
 * hover card: header (symbol + name + socials), chart with timeframe tabs,
 * quick-buy row. Mounted only while the token's avatar is hovered.
 */
export function TokenHoverPreview({
  contractAddress,
  symbol,
  name,
  imageUrl,
  onTwitter,
  onTelegram,
  mcap,
  liquidity,
  volume24h,
  priceChange24h,
  showPaperQuickBuy = true,
}: {
  contractAddress: string;
  symbol: string;
  name?: string;
  imageUrl?: string;
  onTwitter?: boolean;
  onTelegram?: boolean;
  mcap?: number;
  liquidity?: number;
  volume24h?: number;
  priceChange24h?: number;
  showPaperQuickBuy?: boolean;
}) {
  const [tf, setTf] = useState<Timeframe>("5m");

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 380,
        padding: 14,
        background: "linear-gradient(180deg, #0f0f0f, #0a0a0a)",
        border: "1px solid #232323",
        borderRadius: 12,
        boxShadow: "0 20px 48px -16px rgba(0,0,0,0.85)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{ color: "#f5f5f5", fontSize: 15, fontWeight: 700, ...MONO }}
          >
            {symbol}
          </span>
          {name && (
            <span
              style={{
                color: "#777",
                fontSize: 11,
                ...MONO,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 140,
              }}
            >
              {name}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {onTwitter && (
            <span
              style={{
                fontSize: 8,
                padding: "2px 6px",
                borderRadius: 3,
                background: "#111e2b",
                color: "#4aa3e0",
                ...MONO,
              }}
              title="Has an active X/Twitter presence"
            >
              𝕏
            </span>
          )}
          {onTelegram && (
            <span
              style={{
                fontSize: 8,
                padding: "2px 6px",
                borderRadius: 3,
                background: "#111e2b",
                color: "#4aa3e0",
                ...MONO,
              }}
              title="Has an active Telegram group"
            >
              TG
            </span>
          )}
          {!onTwitter && !onTelegram && (
            <span
              style={{
                fontSize: 8,
                padding: "2px 6px",
                borderRadius: 3,
                background: "#201414",
                color: "#8a4a4a",
                ...MONO,
              }}
              title="No social presence detected"
            >
              NO SOCIALS
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, margin: "8px 0 10px" }}>
        {[
          ["MCAP", mcap === undefined ? "?" : compactStat(mcap)],
          ["LIQUIDITY", liquidity === undefined ? "?" : compactStat(liquidity)],
          ["24H VOL", volume24h === undefined ? "?" : compactStat(volume24h)],
          ["24H", priceChange24h === undefined ? "?" : `${priceChange24h >= 0 ? "+" : ""}${priceChange24h.toFixed(1)}%`],
        ].map(([label, value]) => (
          <div key={String(label)} style={{ minWidth: 0, padding: "8px 6px", borderRadius: 8, background: "#131313", border: "1px solid #1c1c1c", textAlign: "center" }}>
            <div style={{ color: "#777", fontSize: 8.5, letterSpacing: ".06em", ...MONO }}>{label}</div>
            <strong style={{ display: "block", overflow: "hidden", marginTop: 5, color: label === "24H" && typeof priceChange24h === "number" ? (priceChange24h >= 0 ? C.green : C.red) : "#ddd", fontSize: 11.5, textOverflow: "ellipsis", whiteSpace: "nowrap", ...MONO }}>{value}</strong>
          </div>
        ))}
      </div>
      <ChartSurface
        contractAddress={contractAddress}
        tf={tf}
        onTfChange={setTf}
      />
      {showPaperQuickBuy && <QuickBuyRow mint={contractAddress} symbol={symbol} imageUrl={imageUrl} />}
    </div>
  );
}

function compactStat(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export { HOVER_DELAY_MS };
