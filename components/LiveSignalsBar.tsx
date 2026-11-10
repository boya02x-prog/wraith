"use client";

import { useState, useEffect, useRef } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { createPortal } from "react-dom";
import { MemeTrend } from "@/app/app/page";
import { useWraithTier } from "@/hooks/useWraithTier";
import { TokenIcon } from "@/components/TokenIcon";
import { QuickBuyButton } from "@/components/QuickBuyButton";
import {
  TokenHoverPreview,
  HOVER_DELAY_MS,
} from "@/components/TokenHoverChart";

const SCAN_CLUSTER_GAP_MS = 10 * 60 * 1000;
const LOOKBACK_MS = 40 * 60 * 1000;
const HISTORY_KEY = "wraith_token_history_v2";
const MIN_MCAP = 2_000;
const MAX_MCAP = 100_000;

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

const HOT_COLOR = "#ff7b3d";
const CELEB_COLOR = "#ffd700";

const PLAT_COLOR: Record<string, string> = {
  pumpfun: "#a855f7",
  dexscreener: "#00b4d8",
  celebrity: "#ffd700",
  twitter: "#aab8c8",
  reddit: "#ff5733",
  telegram: "#26a5e4",
  birdeye: "#00c47a",
  youtube: "#ff4444",
  "google-trends": "#4285f4",
  "google-news": "#4285f4",
  kym: "#44cc44",
};
const PLAT_LABEL: Record<string, string> = {
  pumpfun: "PUMP",
  dexscreener: "DEX",
  celebrity: "CELEB",
  twitter: "X",
  reddit: "REDDIT",
  telegram: "TG",
  birdeye: "BIRD",
  youtube: "YT",
  "google-trends": "TREND",
  "google-news": "NEWS",
  kym: "KYM",
};

interface Sig {
  keyword: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  contractAddress?: string;
  celebMention?: string;
  initialMcap: number;
  currentMcap: number;
  peakMcap: number;
  seenAt: number;
  platforms: string[];
  twoXTier?: string;
  aiTier?: string;
  aiScore?: number;
  crossPlatforms?: number;
  liveEligible?: boolean;
}

function fmtMcap(n: number) {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function passes(e: Record<string, unknown>): boolean {
  if (!e.contractAddress) return false;
  const mcap = typeof e.initialMcap === "number" ? e.initialMcap : 0;
  if (mcap > 0 && mcap < MIN_MCAP) return false;
  if (mcap > MAX_MCAP) return false;
  const platforms = Array.isArray(e.platforms) ? (e.platforms as string[]) : [];
  const tier = typeof e.twoXTier === "string" ? e.twoXTier : null;
  const aiTier = typeof e.aiTier === "string" ? e.aiTier : null;
  const celeb =
    typeof e.celebMention === "string" && e.celebMention
      ? e.celebMention
      : null;
  const hasOnchain = platforms.some((p) =>
    ["pumpfun", "dexscreener", "birdeye"].includes(p),
  );
  if (!hasOnchain && !celeb) return false;
  if (aiTier === "SKIP") return false;
  // Strict gate computed server-side in /api/scan (rugcheck, liquidity,
  // age window, momentum, source confirmation). Authoritative when present.
  if (typeof e.liveEligible === "boolean") return e.liveEligible;
  if (!celeb) {
    if (!tier || ["SKIP", "LOW", "MEDIUM"].includes(tier)) return false;
  } else {
    if (tier === "SKIP") return false;
    if (!hasOnchain && (tier === "LOW" || tier === "MEDIUM")) return false;
  }
  return true;
}

function readLatestBatch(): { batchTs: number; sigs: Sig[] } {
  if (typeof window === "undefined") return { batchTs: 0, sigs: [] };
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return { batchTs: 0, sigs: [] };
  }

  const now = Date.now();
  const cutoff = now - LOOKBACK_MS;
  const candidates: Array<{ seenAt: number; sig: Sig }> = [];

  for (const [kw, v] of Object.entries(raw)) {
    const e = v as Record<string, unknown>;
    const seenAt = typeof e.seenAt === "number" ? e.seenAt : 0;
    if (seenAt < cutoff || !passes(e)) continue;
    const platforms = Array.isArray(e.platforms)
      ? (e.platforms as string[])
      : [];
    candidates.push({
      seenAt,
      sig: {
        keyword: typeof e.keyword === "string" ? e.keyword : kw,
        tokenSymbol:
          typeof e.tokenSymbol === "string" ? e.tokenSymbol : undefined,
        tokenImageUrl:
          typeof e.tokenImageUrl === "string" ? e.tokenImageUrl : undefined,
        contractAddress: e.contractAddress as string,
        celebMention:
          typeof e.celebMention === "string" && e.celebMention
            ? e.celebMention
            : undefined,
        initialMcap: typeof e.initialMcap === "number" ? e.initialMcap : 0,
        currentMcap: typeof e.currentMcap === "number" ? e.currentMcap : (typeof e.initialMcap === "number" ? e.initialMcap : 0),
        peakMcap: typeof e.peakMcap === "number" ? e.peakMcap : 0,
        seenAt,
        platforms,
        twoXTier: typeof e.twoXTier === "string" ? e.twoXTier : undefined,
        aiTier: typeof e.aiTier === "string" ? e.aiTier : undefined,
        aiScore: typeof e.aiScore === "number" ? e.aiScore : undefined,
        crossPlatforms:
          typeof e.crossPlatforms === "number"
            ? e.crossPlatforms
            : platforms.length,
      },
    });
  }

  if (!candidates.length) return { batchTs: 0, sigs: [] };
  candidates.sort((a, b) => b.seenAt - a.seenAt);

  const newestTs = candidates[0].seenAt;
  let batch = candidates.filter(
    (c) => c.seenAt >= newestTs - SCAN_CLUSTER_GAP_MS,
  );
  if (!batch.length) batch = candidates.slice(0, 20);

  const sigs = batch.map((c) => c.sig);
  sigs.sort((a, b) => {
    const rank = (s: Sig) =>
      s.aiTier === "HOT" ? 3 : s.twoXTier === "ULTRA" ? 2 : 1;
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    const sweet = (m: number) => (m >= 3_000 && m <= 50_000 ? 1 : 0);
    return sweet(b.initialMcap) - sweet(a.initialMcap);
  });

  return { batchTs: newestTs, sigs };
}

export default function LiveSignalsBar({
  onSelectMeme,
  layout = "bar",
}: {
  onSelectMeme: (m: MemeTrend) => void;
  layout?: "bar" | "rail";
}) {
  const { canUse: can, tier } = useWraithTier();
  const canSeeSignals = can("live_signals_view");
  const canSeeAiScore = can("ai_score");

  const [sigs, setSigs] = useState<Sig[]>([]);
  const [signalFilter, setSignalFilter] = useState<"FYP" | "TRACTION" | "EARLY">("FYP");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHover = (e: React.MouseEvent, key: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      // Anchor from the card's right edge, popup opens rightward into the
      // main panel. Previous version anchored via `right: innerWidth -
      // rect.left`, which — since this rail sits at the left screen edge —
      // produced a right offset nearly equal to the full viewport width,
      // pushing the fixed-position popup almost entirely off-canvas.
      setHoverPos({ top: rect.top, left: rect.right + 8 });
      setHoveredKey(key);
    }, HOVER_DELAY_MS);
  };
  const endHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    // Give the pointer time to cross the small gap into the portalled preview.
    hoverTimer.current = setTimeout(() => setHoveredKey(null), 160);
  };
  const isTouch =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  const tapPreview = (e: React.MouseEvent, key: string) => {
    e.stopPropagation(); // don't also fire click->onSelectMeme
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (hoveredKey === key) {
      setHoveredKey(null);
      return;
    }
    setHoverPos({
      top: Math.min(rect.top, window.innerHeight - 420),
      left: 12, // full-width-ish on mobile, just inset from the edge
    });
    setHoveredKey(key);
  };
  const [now, setNow] = useState(Date.now());
  const prevTs = useRef(0);

  useEffect(() => {
    function read() {
      const res = readLatestBatch();
      const isNew = res.batchTs > prevTs.current;
      const isEmpty = sigs.length === 0 && res.sigs.length > 0;
      // AI scoring completes asynchronously after the initial history write.
      // Compare the complete card payload so the bar picks up that update even
      // when the scan batch timestamp itself has not changed.
      const changed = JSON.stringify(res.sigs) !== JSON.stringify(sigs);
      if (isNew || isEmpty || changed) {
        prevTs.current = res.batchTs;
        setSigs(res.sigs);
      }
    }
    read();
    const t = visibleInterval(read, 12_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = visibleInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const visibleSigs = sigs.filter((sig) => {
    if (signalFilter === "EARLY") return now - sig.seenAt <= 15 * 60_000;
    if (signalFilter === "TRACTION") return (sig.crossPlatforms ?? 0) >= 2 || (sig.currentMcap > sig.initialMcap && sig.initialMcap > 0);
    return true;
  }).sort((a, b) => {
    const traction = (s: Sig) => {
      const growth = s.initialMcap > 0 ? Math.max(-100, Math.min(200, (s.currentMcap / s.initialMcap - 1) * 100)) : 0;
      return (s.aiScore ?? 0) * 0.5 + Math.max(0, s.crossPlatforms ?? 0) * 12 + Math.max(-20, growth) * 0.4 + (s.aiTier === "HOT" ? 12 : 0);
    };
    return traction(b) - traction(a);
  });

  const click = (s: Sig) =>
    onSelectMeme({
      keyword: s.tokenSymbol || s.keyword,
      score: 0,
      posts: 1,
      source: s.platforms.join(",") || "history",
      hasTicker: !!s.contractAddress,
      crossPlatforms: s.crossPlatforms || 1,
      isNewCoin: false,
      // Historical MCAP is intentionally not used as the current value.
      // TokenPanel fetches a fresh validated quote immediately on selection.
      mcap: undefined,
      platforms: s.platforms,
      tokenImageUrl: s.tokenImageUrl,
      contractAddress: s.contractAddress,
      celebMention: s.celebMention,
    } as MemeTrend);

  // ─── LOCKED STATE ─────────────────────────────────────────────────────────
  if (!canSeeSignals) {
    return (
      <div
        style={{
          background: "linear-gradient(145deg, var(--surface-2), var(--surface))",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "14px 12px",
          flexShrink: 0,
          width: "100%",
          height: layout === "rail" ? "100%" : "76px",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          textAlign: "center",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#1e1e1e",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        <span
          style={{
            color: "#252525",
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: "0.22em",
            ...MONO,
          }}
        >
          LIVE SIGNALS
        </span>
        <span
          style={{
            fontSize: 8,
            color: "#2a2a2a",
            background: "#0d0d0d",
            border: "1px solid #1a1a1a",
            padding: "2px 8px",
            borderRadius: 2,
            ...MONO,
            letterSpacing: "0.08em",
          }}
        >
          LOCKED — REQUIRES{" "}
          <span style={{ color: "#a855f7", fontWeight: 700 }}>SPECTER</span>
        </span>
        <span style={{ fontSize: 8, color: "#1e1e1e", ...MONO }}>
          500K OMEN
        </span>
      </div>
    );
  }

  // ─── UNLOCKED STATE ───────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        flexShrink: 0,
        width: "100%",
        height: layout === "rail" ? "100%" : sigs.length > 0 ? "190px" : "82px",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes sigpulse { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes sig-in { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes sig-highlight { 0% { box-shadow:inset 0 0 0 999px rgba(var(--accent-rgb),.12); } 100% { box-shadow:inset 0 0 0 999px transparent; } }
        @keyframes ghost-drift { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-5px); } }
        .sig-row { cursor:pointer; transition:background .16s ease, outline-color .16s ease, transform .16s ease; animation:sig-in .24s ease both, sig-highlight 1s ease-out both; }
        .sig-row:hover { background:var(--surface-3) !important; outline-color:var(--border-strong); transform:translateY(-1px); }
        .sig-table-wrap { overflow-y:auto; overflow-x:hidden; flex:1; min-height:0; padding:4px 8px 48px; }
        .sig-table-wrap::-webkit-scrollbar { width:4px; }
        .sig-table-wrap::-webkit-scrollbar-thumb { background:var(--surface-3); border-radius:4px; }
        .sig-table { width:100%; border-collapse:separate; border-spacing:0 8px; }
        .sig-th { display:none; }
        .sig-row { background:var(--surface-2); outline:1px solid var(--border); border-radius:12px; }
        .sig-row td:first-child { border-radius:12px 0 0 12px; }
        .sig-row td:last-child { border-radius:0 12px 12px 0; }
        .sig-filter { min-height:28px; padding:0 8px; color:var(--text-muted); background:transparent; border:1px solid transparent; border-radius:8px; font:600 11px var(--font-sans); cursor:pointer; }
        .sig-filter[aria-pressed="true"] { color:var(--accent-text); background:rgba(var(--accent-rgb),.1); border-color:var(--border-strong); }
        .sig-empty { display:flex; flex:1; min-height:0; flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:22px 14px; color:var(--text-muted); text-align:center; }
        .sig-empty-compact { flex-direction:row; gap:8px; padding:4px 12px; }
        .sig-empty-compact img { width:22px; height:22px; animation:none; }
        .sig-empty img { width:34px; height:34px; object-fit:contain; opacity:.66; animation:ghost-drift 3s ease-in-out infinite; }
      `}</style>

      {/* Header — pinned, doesn't scroll with the list */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          padding: "14px 12px 12px",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            display: "inline-block",
            background: sigs.length ? "var(--orange)" : "var(--text-dim)",
            animation: sigs.length
              ? "sigpulse 1.6s ease-in-out infinite"
              : "none",
          }}
        />
        <span
          style={{
            color: sigs.length ? "var(--orange-hot)" : "var(--text-muted)",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.18em",
            ...MONO,
          }}
        >
          LIVE SIGNALS
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            ...MONO,
            color: sigs.length ? "var(--orange-hot)" : "var(--text-dim)",
            background: sigs.length ? "rgba(var(--accent-rgb),.1)" : "transparent",
            border: `1px solid ${sigs.length ? "var(--border-strong)" : "var(--border)"}`,
            padding: "1px 7px",
            borderRadius: 10,
            marginLeft: "auto",
          }}
        >
          {sigs.length}
        </span>
        <div
          role="group"
          aria-label="Filter live signals"
          style={{ display: "flex", gap: 2, width: "100%", paddingLeft: 14 }}
        >
          {(["FYP", "TRACTION", "EARLY"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className="sig-filter"
              aria-pressed={signalFilter === filter}
              onClick={() => setSignalFilter(filter)}
            >
              {filter === "FYP" ? "For you" : filter === "TRACTION" ? "Traction" : "Early"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: "7px 14px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10, lineHeight: 1.45 }}>
        Ranked by source confirmation, AI review, and observed market-cap change. Signals are research leads, not guaranteed outcomes.
      </div>

      {sigs.length === 0 && (
        <div className={`sig-empty ${layout === "rail" ? "sig-empty-rail" : "sig-empty-compact"}`}>
          <img src="/wraith.png" alt="" />
          <strong style={{ color: "var(--text)", fontSize: 14 }}>
            No signals yet
          </strong>
          <span style={{ fontSize: 12 }}>Freshly verified signals appear here as market and social data arrives.</span>
        </div>
      )}

      {sigs.length > 0 && visibleSigs.length === 0 && (
        <div className="sig-empty">
          <span style={{ color: "var(--text)", fontSize: 13 }}>
            No {signalFilter.toLowerCase()} signals in this batch.
          </span>
          <button
            type="button"
            className="sig-filter"
            aria-pressed="false"
            onClick={() => setSignalFilter("FYP")}
          >
            Show all signals
          </button>
        </div>
      )}

      {visibleSigs.length > 0 && (
        <div className="sig-table-wrap">
          <table className="sig-table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "auto" }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="sig-th">TOKEN</th>
                <th className="sig-th">SIGNAL</th>
                <th className="sig-th">MCAP</th>
                <th
                  className="sig-th"
                  style={{ textAlign: "right", width: 70, minWidth: 70 }}
                >
                  BUY
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSigs.map((sig) => {
                const sym = (sig.tokenSymbol || sig.keyword)
                  .toUpperCase()
                  .slice(0, 12);
                const isHot = sig.aiTier === "HOT";
                const isCeleb = !!sig.celebMention;
                const currentMcap = sig.currentMcap || sig.initialMcap;
                const movePct = sig.initialMcap > 0 ? ((currentMcap / sig.initialMcap) - 1) * 100 : null;
                const tc = isHot ? HOT_COLOR : isCeleb ? CELEB_COLOR : "#ff7845";
                const tierLabel = (sig.crossPlatforms ?? 0) >= 3 ? "CROSS-SIGNAL" : isHot ? "AI REVIEWED" : isCeleb ? "CREATOR MENTION" : "ON-CHAIN";
                const ageMin = Math.floor((now - sig.seenAt) / 60_000);
                const keyPlats = sig.platforms
                  .filter((p) =>
                    [
                      "pumpfun",
                      "dexscreener",
                      "twitter",
                      "telegram",
                      "birdeye",
                      "celebrity",
                    ].includes(p),
                  )
                  .slice(0, 2);

                return (
                  <tr
                    key={sig.keyword}
                    className="sig-row"
                    onClick={(e) =>
                      isTouch ? tapPreview(e, sig.keyword) : click(sig)
                    }
                    onMouseEnter={(e) =>
                      !isTouch &&
                      startHover(e as unknown as React.MouseEvent, sig.keyword)
                    }
                    onMouseLeave={() => !isTouch && endHover()}
                    title={tierLabel}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    {/* TOKEN */}
                    <td style={{ padding: "10px 10px", minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          minWidth: 0,
                        }}
                      >
                        <span style={{ flexShrink: 0, pointerEvents: "none" }}>
                          <TokenIcon
                            contractAddress={sig.contractAddress}
                            imageUrl={sig.tokenImageUrl}
                            symbol={sym}
                            size={22}
                          />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              color: "#e8e8e8",
                              fontSize: 11,
                              fontWeight: 800,
                              ...MONO,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 90,
                            }}
                          >
                            {sym}
                          </div>
                          {isCeleb && (
                            <div
                              style={{
                                color: CELEB_COLOR,
                                fontSize: 7,
                                ...MONO,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 90,
                              }}
                              title={sig.celebMention}
                            >
                              {sig.celebMention}
                            </div>
                          )}
                          {!isCeleb && sig.keyword.toUpperCase() !== sym && (
                            <div
                              style={{
                                color: "var(--text-muted)",
                                fontSize: 11,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 90,
                              }}
                            >
                              {sig.keyword}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* SIGNAL — tier + AI score + cross-platform count */}
                    <td style={{ padding: "10px 8px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          flexWrap: "wrap" as const,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 7,
                            fontWeight: 700,
                            color: tc,
                            background: `${tc}14`,
                            border: `1px solid ${tc}3a`,
                            padding: "1px 5px",
                            borderRadius: 3,
                            ...MONO,
                            letterSpacing: ".04em",
                          }}
                        >
                          {tierLabel}
                        </span>
                        {canSeeAiScore && typeof sig.aiScore === "number" && (
                          <span
                            style={{
                              display: "grid",
                              width: 28,
                              height: 28,
                              placeItems: "center",
                              borderRadius: "50%",
                              border: `2px solid ${sig.aiTier === "HOT" || sig.twoXTier === "ULTRA" ? HOT_COLOR : sig.aiTier === "WATCH" ? "#ffaa00" : "#00c47a"}`,
                              fontSize: 12,
                              fontWeight: 700,
                              ...MONO,
                              color:
                                sig.aiTier === "HOT"
                                  ? HOT_COLOR
                                  : sig.aiTier === "WATCH"
                                    ? "#ffaa00"
                                    : "#00c47a",
                            }}
                          >
                            {sig.aiScore}
                          </span>
                        )}
                        {(sig.crossPlatforms || 0) > 1 && (
                          <span
                            style={{
                              fontSize: 7,
                              color: "#666",
                              ...MONO,
                            }}
                            title="cross-platform confirmations"
                          >
                            ×{sig.crossPlatforms}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 3, marginTop: 5, flexWrap: "wrap" }} title={`Confirmed by: ${sig.platforms.join(", ")}`}>
                        {keyPlats.map((platform) => <span key={platform} style={{ color: PLAT_COLOR[platform] || "var(--text-muted)", fontSize: 8, ...MONO }}>{PLAT_LABEL[platform] || platform.toUpperCase()}</span>)}
                        {sig.crossPlatforms && sig.crossPlatforms > keyPlats.length && <span style={{ color: "var(--text-dim)", fontSize: 8, ...MONO }}>+{sig.crossPlatforms - keyPlats.length}</span>}
                      </div>
                    </td>

                    {/* MCAP + age stacked to reclaim a whole column's width */}
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ color: "var(--text-dim)", fontSize: 8, letterSpacing: ".08em", ...MONO }}>SEEN MC</div>
                      <div
                        style={{
                          color: "var(--orange-hot)",
                          fontSize: 18,
                          fontWeight: 700,
                          ...MONO,
                          whiteSpace: "nowrap" as const,
                        }}
                      >
                        {fmtMcap(sig.initialMcap)}
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          marginTop: 4,
                          padding: "2px 6px",
                          color: "var(--text-muted)",
                          background: "rgba(255,255,255,.035)",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          fontSize: 11,
                          ...MONO,
                        }}
                      >
                        {fmtMcap(currentMcap)} now
                      </div>
                      {movePct !== null && <div style={{ marginTop: 5, color: movePct >= 0 ? "var(--win)" : "var(--loss)", fontSize: 10, ...MONO }}>{movePct >= 0 ? "+" : ""}{movePct.toFixed(1)}% since seen · {ageMin < 1 ? "now" : `${ageMin}m`}</div>}
                    </td>

                    {/* BUY — fixed-width cell so QuickBuyButton's hover
                        expansion (icon -> icon+amount label) happens inside
                        reserved space instead of shifting the row. Wrapper
                        span is the position:relative anchor QuickBuyButton's
                        position:absolute right:0/top:0 resolves against. */}
                    <td
                      style={{
                        padding: "10px 10px",
                        textAlign: "right",
                        width: 70,
                        minWidth: 70,
                      }}
                    >
                      {sig.contractAddress && (
                        <span
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: "relative",
                            display: "inline-block",
                            height: 26,
                            width: 26,
                          }}
                        >
                          <QuickBuyButton
                            contractAddress={sig.contractAddress}
                            symbol={sym}
                            amountSol={0.1}
                            size="compact"
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hoveredKey &&
        hoverPos &&
        (() => {
          const sig = sigs.find((s) => s.keyword === hoveredKey);
          if (!sig || !sig.contractAddress) return null;
          const sym = (sig.tokenSymbol || sig.keyword)
            .toUpperCase()
            .slice(0, 12);
          if (typeof document === "undefined") return null;
          return createPortal(
            <div
              style={{
                position: "fixed",
                top: Math.min(hoverPos.top, window.innerHeight - 420),
                left: Math.min(hoverPos.left, window.innerWidth - 356), // 340 card + margin
                zIndex: 1000,
              }}
              onMouseEnter={() => {
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
              }}
              onMouseLeave={endHover}
            >
              <TokenHoverPreview
                contractAddress={sig.contractAddress}
                symbol={sym}
                imageUrl={sig.tokenImageUrl}
                onTwitter={sig.platforms.includes("twitter")}
                onTelegram={sig.platforms.includes("telegram")}
              />
            </div>,
            document.body,
          );
        })()}
    </div>
  );
}
