"use client";

// components/SignalScanner.tsx
// Fast scanner: ranks live tokens across every Wraith chain by momentum, volume pressure, buy/sell
// balance, liquidity health and freshness. No AI or social calls — it polls one
// cached endpoint, so it is quick and cheap. The old AI/celeb scan is still
// available behind "Deep scan".

import { riskLevel, signalBand } from "@/lib/scoreBand";
import { swrRead, swrWrite } from "@/lib/swrCache";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Flame, LayoutGrid, List, Lock, Radar, RefreshCw, Sparkles, Zap } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { changeColor, fmtAge, fmtPct, fmtUsd, type MarketToken } from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { TokenIcon } from "@/components/TokenIcon";
import { UpdatedAgo } from "@/components/UpdatedAgo";
import ChainLogo from "@/components/ChainLogo";
import { CHAINS } from "@/lib/chains";
import { useWraithTier } from "@/hooks/useWraithTier";
import TierGlyph from "@/components/TierGlyph";
import { TIERS } from "@/lib/tiers";
import PatternsPanel from "@/components/PatternsPanel";

const chainName = (k?: string) => (!k || k === "solana" ? "Solana" : CHAINS[k]?.name ?? k);

interface Signal {
  token: MarketToken;
  score: number;
  tier: "HOT" | "WATCH";
  tags: string[];
  risks: string[];
  patterns?: string[];
  odds?: number;
}

type Filter = "all" | "hot" | "fresh" | "volume" | "safe";
type RailTab = "top" | "traction" | "early";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hot", label: "Top picks" },
  { key: "fresh", label: "Fresh" },
  { key: "volume", label: "Volume" },
  { key: "safe", label: "Safer" },
];

function useSignals() {
  const warm = swrRead<Signal[]>("signals");
  const [signals, setSignals] = useState<Signal[]>(warm ?? []);
  const [loading, setLoading] = useState(!warm);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/signals", { cache: "no-store" });
      const data: { signals?: Signal[]; updatedAt?: number; error?: string } = await res.json();
      if (Array.isArray(data.signals) && data.signals.length) {
        setSignals(data.signals);
        swrWrite("signals", data.signals);
        setUpdatedAt(data.updatedAt ?? Date.now());
        setError("");
      } else if (!res.ok) {
        setError(data.error || "Signal sources are slow right now.");
      } else {
        setSignals([]);
        setUpdatedAt(data.updatedAt ?? Date.now());
      }
    } catch {
      setError("Could not reach the signal feed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        void load();
        tick();
      }, document.hidden ? 60_000 : 20_000);
    };
    tick();
    return () => clearTimeout(t);
  }, [load]);

  return { signals, loading, error, updatedAt, reload: load };
}

const LOCK_TIP = `AI score unlocks at SPECTER (${TIERS.SPECTER.minTokens.toLocaleString("en-US")} OMEN)`;

function ScoreRing({ score, tier, locked }: { score: number; tier: "HOT" | "WATCH"; locked?: boolean }) {
  if (locked) {
    return (
      <div className="sg-ring watch" title={LOCK_TIP} style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,.18)", color: "var(--text-dim)" }}>
        <Lock size={14} />
      </div>
    );
  }
  const r = 15;
  const c = 2 * Math.PI * r;
  const band = signalBand(score);
  return (
    <div className={`sg-ring ${tier === "HOT" ? "hot" : "watch"}`} style={{ color: band.color }} title={`${band.label} · ${score}/100. ${band.hint}`}>
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
        <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="3" />
        <circle cx="19" cy="19" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 19 19)" />
      </svg>
      <b>{score}</b>
    </div>
  );
}

function CardBase({ s, onOpen, showScore }: { s: Signal; onOpen: () => void; showScore: boolean }) {
  const t = s.token;
  return (
    <div className="sg-card" role="link" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div className="sg-card-top">
        <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={44} />
        <div className="sg-id">
          <strong>{t.symbol}</strong>
          <span><ChainLogo chain={t.chain ?? "solana"} size={13} /> {t.name && t.name !== t.symbol ? t.name : t.dex ?? chainName(t.chain)}</span>
        </div>
        <div className="sg-ring-wrap">
          <ScoreRing score={s.score} tier={s.tier} locked={!showScore} />
          {showScore && <small style={{ color: signalBand(s.score).color }}>{signalBand(s.score).label}</small>}
        </div>
      </div>
      <div className="sg-metrics">
        <div><small>MCap</small><b>{fmtUsd(t.mcap)}</b></div>
        <div><small>1h</small><b style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</b></div>
        <div><small>Vol 1h</small><b>{fmtUsd(t.volume.h1)}</b></div>
        <div><small>Liq</small><b>{fmtUsd(t.liquidity)}</b></div>
        <div><small>Age</small><b>{t.createdAt ? fmtAge(t.createdAt) : "—"}</b></div>
      </div>
      <div className="sg-tags">
        <span className="sg-tag sg-risklevel" title={riskLevel(s.risks.length).hint} style={{ color: riskLevel(s.risks.length).color, borderColor: riskLevel(s.risks.length).color }}>● {riskLevel(s.risks.length).label}</span>
        {s.tags.map((x) => <span key={x} className="sg-tag">{x}</span>)}
        {s.risks.map((x) => <span key={x} className="sg-tag risk">{x}</span>)}
      </div>
    </div>
  );
}

function ListRowBase({ s, onOpen, showScore }: { s: Signal; onOpen: () => void; showScore: boolean }) {
  const t = s.token;
  return (
    <div className="wx-trow sg-trow" role="link" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <span className="wx-trow-id">
        <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={32} />
        <span>
          <strong>{t.symbol}</strong>
          <small><ChainLogo chain={t.chain ?? "solana"} size={12} /> {s.tags[0] ?? (t.name && t.name !== t.symbol ? t.name : chainName(t.chain))}</small>
        </span>
      </span>
      {showScore ? <b className="sg-score" style={{ color: signalBand(s.score).color }} title={`${signalBand(s.score).label} · ${s.score}/100`}>{s.score}</b> : <b className="sg-score" title={LOCK_TIP} style={{ opacity: .6 }}><Lock size={13} /></b>}
      <span>{fmtUsd(t.mcap)}</span>
      <span style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</span>
      <span className="c-vol">{fmtUsd(t.volume.h1)}</span>
      <span className="c-liq">{fmtUsd(t.liquidity)}</span>
      <span className="c-age">{t.createdAt ? fmtAge(t.createdAt) : "—"}</span>
    </div>
  );
}

function RailRowBase({ s, onOpen }: { s: Signal; onOpen: () => void }) {
  const t = s.token;
  return (
    <button type="button" className="sg-rail-row" onClick={onOpen}>
      <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={34} />
      <span className="mid">
        <strong>{t.symbol}</strong>
        <small><ChainLogo chain={t.chain ?? "solana"} size={12} /> {s.tags[0] ?? "Momentum"} · {fmtUsd(t.mcap)}</small>
      </span>
      <span className="end">
        <b style={{ color: signalBand(s.score).color }} title={`${signalBand(s.score).label} · ${s.score}/100`}>{s.score}</b>
        <small style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</small>
      </span>
    </button>
  );
}

// Re-render a row only when something it shows changed (onOpen is a new closure every render and is not compared).
const sameSig = (a: Signal, b: Signal) =>
  a === b || (
    a.token.address === b.token.address && a.score === b.score && a.tier === b.tier &&
    a.token.symbol === b.token.symbol && a.token.name === b.token.name && a.token.imageUrl === b.token.imageUrl &&
    a.token.mcap === b.token.mcap && a.token.liquidity === b.token.liquidity && a.token.volume.h1 === b.token.volume.h1 &&
    a.token.change.h1 === b.token.change.h1 && a.token.createdAt === b.token.createdAt &&
    a.tags.join("|") === b.tags.join("|") && a.risks.join("|") === b.risks.join("|")
  );
const Card = memo(CardBase, (p, n) => p.showScore === n.showScore && sameSig(p.s, n.s));
const ListRow = memo(ListRowBase, (p, n) => p.showScore === n.showScore && sameSig(p.s, n.s));
const RailRow = memo(RailRowBase, (p, n) => sameSig(p.s, n.s));

/**
 * Live overlay: every ~4s refresh price / mcap / % for the best Solana rows. One call that every user shares
 * (the endpoint is cached at the edge for 3s), so 1,000 open scanners cost a handful of upstream requests.
 */
function useLiveSignals(base: Signal[]): Signal[] {
  const [live, setLive] = useState<Record<string, Partial<MarketToken>>>({});
  const mintsKey = useMemo(
    () => base.filter((s) => !s.token.chain || s.token.chain === "solana").slice(0, 30).map((s) => s.token.address).join(","),
    [base],
  );
  useEffect(() => {
    if (!mintsKey) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/market-live?mints=${mintsKey}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d: { prices?: Record<string, Partial<MarketToken>> } = await r.json();
        if (alive && d.prices && Object.keys(d.prices).length) setLive(d.prices);
      } catch { /* keep the last values */ }
    };
    const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [mintsKey]);
  return useMemo(
    () => base.map((s) => {
      const p = live[s.token.address];
      if (!p) return s;
      return { ...s, token: { ...s.token, priceUsd: p.priceUsd || s.token.priceUsd, mcap: p.mcap || s.token.mcap, liquidity: p.liquidity || s.token.liquidity, change: p.change ?? s.token.change } };
    }),
    [base, live],
  );
}

export default function SignalScanner({
  onSelectMeme,
}: {
  onSelectMeme: (meme: MemeTrend) => void;
}) {
  const { signals: baseSignals, loading, error, updatedAt, reload } = useSignals();
  const signals = useLiveSignals(baseSignals);
  const { canUse: can } = useWraithTier();
  const showScore = can("ai_score");
  const showRail = can("live_signals_view");
  const [filter, setFilter] = useState<Filter>("all");
  const [railTab, setRailTab] = useState<RailTab>("top");
  const [chainFilter, setChainFilter] = useState<string>("all");
  // Patterns stays open for the visit, so opening a wallet or token from it and pressing Back returns here, not to the list.
  // (This component only ever renders in the browser, so reading storage in the first render is safe.)
  const [deep, setDeepState] = useState(() => { try { return sessionStorage.getItem("wraith_scanner_deep") === "1"; } catch { return false; } });
  const setDeep = (v: boolean) => { setDeepState(v); try { sessionStorage.setItem("wraith_scanner_deep", v ? "1" : "0"); } catch { /* storage unavailable */ } };
  const [view, setViewState] = useState<"grid" | "list">("grid");
  useEffect(() => {
    try { if (localStorage.getItem("wraith_board_view") === "list") setViewState("list"); } catch { /* ignore */ }
  }, []);
  const setView = (v: "grid" | "list") => {
    setViewState(v);
    try { localStorage.setItem("wraith_board_view", v); } catch { /* ignore */ }
  };
  const byChain = useMemo(() => (chainFilter === "all" ? signals : signals.filter((s) => (s.token.chain ?? "solana") === chainFilter)), [signals, chainFilter]);
  const chainCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of signals) m.set(s.token.chain ?? "solana", (m.get(s.token.chain ?? "solana") ?? 0) + 1);
    return m;
  }, [signals]);

  const shown = useMemo(() => {
    const signals = byChain;
    switch (filter) {
      case "hot": return signals.filter((s) => s.tier === "HOT");
      case "fresh": return signals.filter((s) => s.tags.includes("Fresh") || s.tags.includes("New today"));
      case "volume": return signals.filter((s) => s.tags.includes("Volume surge"));
      case "safe": return signals.filter((s) => s.risks.length === 0 && s.token.liquidity >= 15_000);
      default: return signals;
    }
  }, [byChain, filter]);

  const railList = useMemo(() => {
    const signals = byChain;
    const list =
      railTab === "traction"
        ? signals.filter((s) => s.tags.includes("Volume surge") || s.tags.includes("Buy pressure"))
        : railTab === "early"
          ? signals.filter((s) => s.tags.includes("Fresh") || s.tags.includes("New today"))
          : signals;
    return list.slice(0, 14);
  }, [byChain, railTab]);

  const open = (s: Signal) => onSelectMeme(toMeme(s.token));
  const hotCount = signals.filter((s) => s.tier === "HOT").length;

  return (
    <>
      <aside className="wx-scanner-rail sg-rail">
        <header className="sg-rail-head">
          <div className="sg-rail-title"><span className="sg-dot" />Live signals</div>
          {showRail && <span className="sg-count">{signals.length}</span>}
        </header>
        {!showRail ? (
          <div style={{ margin: "14px 16px", padding: "22px 16px", borderRadius: 16, border: "1px dashed rgba(255,123,61,.4)", background: "linear-gradient(160deg, rgba(255,123,61,.10), rgba(255,123,61,.02))", textAlign: "center", display: "grid", gap: 10, justifyItems: "center" }}>
            <TierGlyph tier="WRAITH" size={54} />
            <strong style={{ fontSize: 14 }}>Live signals are a WRAITH feature</strong>
            <small style={{ color: "var(--text-dim)", lineHeight: 1.55, fontSize: 12 }}>The ranked live feed unlocks when you hold {TIERS.WRAITH.minTokens.toLocaleString("en-US")} OMEN. The Discover scanner stays open to everyone.</small>
            <a href="/#omen" style={{ color: "var(--accent-text)", fontSize: 12, fontWeight: 700 }}>See tiers →</a>
          </div>
        ) : (<>
        <div className="sg-rail-tabs" role="tablist">
          {([["top", "For you"], ["traction", "Traction"], ["early", "Early"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={railTab === k} className={railTab === k ? "on" : ""} onClick={() => setRailTab(k)}>{label}</button>
          ))}
        </div>
        <p className="sg-rail-note">Ranked by volume pressure, momentum, buy/sell balance, liquidity and age. Research leads, not guaranteed outcomes.</p>
        <div className="sg-rail-list">
          {loading && !signals.length
            ? Array.from({ length: 7 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 52, margin: "6px 12px", borderRadius: 12 }} />)
            : railList.length
              ? railList.map((s) => <RailRow key={s.token.address} s={s} onOpen={() => open(s)} />)
              : <div className="wx-empty small"><span>{error || "Nothing matches this view right now."}</span></div>}
        </div>
        </>)}
      </aside>

      <div className="wx-scanner-main sg-main">
        <header className="sg-head">
          <div>
            <div className="sg-title"><Radar size={15} /> Discover <span className="sg-live"><i />{error && !signals.length ? "Offline" : "Live"}</span></div>
            <p>{signals.length ? <>{`${signals.length} scored · ${hotCount} top picks`}{updatedAt ? <> · updated <UpdatedAgo at={updatedAt} />s ago</> : null}</> : loading ? "Scoring live markets…" : "No tokens passed the filters yet."}</p>
          </div>
          <div className="sg-head-actions">
            <div className="wx-seg" aria-label="View">
              <button type="button" className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="Card view" title="Cards"><LayoutGrid size={14} /></button>
              <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="Table view" title="Table"><List size={14} /></button>
            </div>
            <button type="button" className={`sg-btn${deep ? " on" : ""}`} onClick={() => setDeep(!deep)} aria-pressed={deep} title="Patterns: what the scanner has learned, which setups work, and the wallets behind them">
              <Sparkles size={13} /> Patterns
            </button>
            <button type="button" className="sg-btn primary" onClick={() => void reload()}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </header>

        {deep ? (
          <div className={`sg-deep ${view}`}><PatternsPanel signals={signals} onOpen={open} /></div>
        ) : (
          <>
            <div className="sg-filters sg-chains" role="tablist" aria-label="Chain">
              <button type="button" role="tab" aria-selected={chainFilter === "all"} className={chainFilter === "all" ? "on" : ""} onClick={() => setChainFilter("all")}>All chains</button>
              {["solana", ...Object.keys(CHAINS)].filter((k) => chainCounts.has(k)).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={chainFilter === k} className={chainFilter === k ? "on" : ""} onClick={() => setChainFilter(k)}>
                  <ChainLogo chain={k} size={14} />{chainName(k)} <small style={{ opacity: 0.6 }}>{chainCounts.get(k)}</small>
                </button>
              ))}
            </div>
            <div className="sg-filters" role="tablist" aria-label="Signal filters">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                  {f.key === "hot" && <Flame size={12} />}{f.key === "fresh" && <Zap size={12} />}{f.label}
                </button>
              ))}
            </div>
            <div className="sg-body">
              {loading && !signals.length ? (
                <div className="sg-grid">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 176, borderRadius: 16 }} />)}</div>
              ) : shown.length ? (
                view === "grid" ? (
                  <div className="sg-grid">{shown.map((s) => <Card key={s.token.address} s={s} onOpen={() => open(s)} showScore={showScore} />)}</div>
                ) : (
                  <div className="wx-table sg-table" role="table">
                    <div className="wx-trow sg-trow head" role="row">
                      <span>Token</span><span>Score</span><span>MCap</span><span>1h</span><span className="c-vol">Vol 1h</span><span className="c-liq">Liq</span><span className="c-age">Age</span>
                    </div>
                    {shown.map((s) => <ListRow key={s.token.address} s={s} onOpen={() => open(s)} showScore={showScore} />)}
                  </div>
                )
              ) : (
                <div className="wx-empty">
                  <strong>{error ? "Signal feed unavailable" : "No matches for this filter"}</strong>
                  <span>{error || "Try another filter. The feed refreshes every 20 seconds."}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
