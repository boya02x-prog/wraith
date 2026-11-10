"use client";

// components/TokenBoard.tsx
// Discover board — pump.fun-style cards or Fomo-style dense table.
// Click a token to open its workspace (chart + trade dock).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, LayoutGrid, List, RefreshCw, Search } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { useMarket } from "@/hooks/useMarket";
import {
  changeColor,
  fmtAge,
  fmtCount,
  fmtPct,
  fmtUsd,
  MARKET_CATEGORIES,
  type MarketCategory,
  type MarketToken,
} from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { prefetchChart } from "@/lib/prefetchChart";
import { TokenIcon } from "@/components/TokenIcon";
import { UpdatedAgo } from "@/components/UpdatedAgo";
import { QuickBuyButton } from "@/components/QuickBuyButton";
import { getActivePreset } from "@/lib/quickBuyPresets";
import { HOVER_DELAY_MS, TokenHoverPreview } from "@/components/TokenHoverChart";

type HoverFns = { enter: (e: React.MouseEvent, t: MarketToken) => void; leave: () => void };

type View = "grid" | "list";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function Change({ v }: { v: number | null }) {
  return <b style={{ color: changeColor(v) }}>{fmtPct(v)}</b>;
}

// Every card gets the same bar slot so rows line up: bonding-curve progress for
// curve tokens, otherwise a buy/sell pressure split from recent transactions.
function CardBar({ token }: { token: MarketToken }) {
  if (token.onCurve && token.curveProgress != null) {
    const pct = Math.round(token.curveProgress * 100);
    return (
      <div className="wx-curve-mini" title="Estimated bonding-curve progress">
        <div className="wx-bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
        <span>{pct}%</span>
      </div>
    );
  }
  const { buys, sells } = token.txns;
  const total = buys + sells;
  const buyPct = total > 0 ? Math.round((buys / total) * 100) : null;
  return (
    <div className="wx-pressure" title="Buy vs sell transactions">
      <div className="wx-pressure-bar">
        {buyPct !== null && (<><i className="buy" style={{ width: `${buyPct}%` }} /><i className="sell" style={{ width: `${100 - buyPct}%` }} /></>)}
      </div>
      <span className={buyPct !== null && buyPct < 50 ? "sell" : "buy"}>{buyPct !== null ? `${buyPct}% buys` : "No txns"}</span>
    </div>
  );
}

// Tiny trend line built from the real 24h / 6h / 1h / 5m price changes (no extra fetch)
function Spark({ token }: { token: MarketToken }) {
  const c = token.change;
  const pts: number[] = [];
  for (const v of [c.h24, c.h6, c.h1, c.m5]) if (v != null && v > -99) pts.push(1 / (1 + v / 100));
  if (pts.length < 2) return null;
  pts.push(1);
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * 64).toFixed(1)} ${(20 - ((v - min) / span) * 18).toFixed(1)}`).join(" ");
  const first = c.h24 ?? c.h6 ?? c.h1 ?? 0;
  const col = first >= 0 ? "#22c55e" : "#ef4444";
  return (
    <svg className="wx-spark" viewBox="0 0 64 22" width="64" height="22" aria-hidden="true">
      <path d={d} fill="none" stroke={col} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Sanitize name: skip tokens whose symbol/name is clearly garbage data.
function safeName(name: string, symbol: string): string {
  if (!name || name === "?" || /^\[/.test(name)) return symbol;
  return name;
}

function CardBase({ token, onOpen, quickSol }: { token: MarketToken; onOpen: () => void; quickSol: number }) {
  return (
    <div
      className="wx-tcard"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onMouseEnter={() => prefetchChart(token.address, token.onCurve)} onTouchStart={() => prefetchChart(token.address, token.onCurve, true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="wx-tcard-top">
        <TokenIcon contractAddress={token.address} imageUrl={token.imageUrl} symbol={token.symbol} size={52} />
        <div className="wx-tcard-id">
          <div className="wx-tcard-sym">
            <strong>{token.symbol}</strong>
            {token.graduated && <span className="wx-badge">Graduated</span>}
            {token.onCurve && <span className="wx-badge accent">Curve</span>}
          </div>
          <span className="wx-tcard-name">{safeName(token.name, token.symbol)}</span>
        </div>
        <span className="wx-tcard-age">{fmtAge(token.createdAt)}</span>
      </div>

      <div className="wx-tcard-mc">
        <div>
          <span className="wx-kicker">Market cap</span>
          <strong>{fmtUsd(token.mcap, { decimals: 1 })}</strong>
        </div>
        <Spark token={token} />
        <div className="wx-tcard-chg" style={{ color: changeColor(token.change.h1) }}>
          {fmtPct(token.change.h1)}
          <small>1h</small>
        </div>
      </div>

      <CardBar token={token} />

      <div className="wx-tcard-meta">
        <span>Vol <b>{fmtUsd(token.volume.h24)}</b></span>
        <span>Liq <b>{fmtUsd(token.liquidity)}</b></span>
        <span className="wx-qb" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <QuickBuyButton contractAddress={token.address} symbol={token.symbol} amountSol={quickSol} size="compact" />
        </span>
      </div>
    </div>
  );
}

function RowBase({ token, onOpen, quickSol, hover }: { token: MarketToken; onOpen: () => void; quickSol: number; hover: HoverFns }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="wx-trow"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      onMouseEnter={() => prefetchChart(token.address, token.onCurve)} onTouchStart={() => prefetchChart(token.address, token.onCurve, true)}
    >
      <span className="wx-trow-id" onMouseEnter={(e) => hover.enter(e, token)} onMouseLeave={hover.leave}>
        <TokenIcon contractAddress={token.address} imageUrl={token.imageUrl} symbol={token.symbol} size={34} />
        <span>
          <strong>{token.symbol}</strong>
          <small>{safeName(token.name, token.symbol)}</small>
        </span>
      </span>
      <span className="c-age">{fmtAge(token.createdAt)}</span>
      <span className="wx-mc-cell"><b>{fmtUsd(token.mcap)}</b><Spark token={token} /></span>
      <span className="c-liq">{fmtUsd(token.liquidity)}</span>
      <span className="c-vol">{fmtUsd(token.volume.h24)}</span>
      <span className="c-5m"><Change v={token.change.m5} /></span>
      <span><Change v={token.change.h1} /></span>
      <span className="c-24h"><Change v={token.change.h24} /></span>
      <span className="c-tx">{fmtCount(token.txns.buys + token.txns.sells)}</span>
      <span className="wx-qb c-buy" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <QuickBuyButton contractAddress={token.address} symbol={token.symbol} amountSol={quickSol} size="compact" />
      </span>
    </div>
  );
}

// The board gets fresh token objects every few seconds. Re-render a card only when something it SHOWS changed
// (onOpen is a new closure each render, so it is deliberately not compared: same token fields = same behaviour).
const sameToken = (a: MarketToken, b: MarketToken) =>
  a === b || (
    a.address === b.address && a.priceUsd === b.priceUsd && a.mcap === b.mcap && a.liquidity === b.liquidity &&
    a.imageUrl === b.imageUrl && a.onCurve === b.onCurve && a.graduated === b.graduated && a.curveProgress === b.curveProgress &&
    a.volume.h24 === b.volume.h24 && a.change.m5 === b.change.m5 && a.change.h1 === b.change.h1 && a.change.h6 === b.change.h6 &&
    a.change.h24 === b.change.h24 && a.txns.buys === b.txns.buys && a.txns.sells === b.txns.sells
  );
const Card = memo(CardBase, (p, n) => p.quickSol === n.quickSol && sameToken(p.token, n.token));
const Row = memo(RowBase, (p, n) => p.quickSol === n.quickSol && p.hover === n.hover && sameToken(p.token, n.token));

const PAGE_SIZE = { grid: 24, list: 25 } as const;

function Pager({ page, pages, total, size, onPage }: { page: number; pages: number; total: number; size: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums: (number | "…")[] = [];
  for (let i = 0; i < pages; i++) {
    if (i === 0 || i === pages - 1 || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <nav className="wx-pager" aria-label="Pagination">
      <span className="wx-pager-info">{page * size + 1}–{Math.min(total, (page + 1) * size)} of {total}</span>
      <div className="wx-pager-btns">
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        {nums.map((n, i) => n === "…" ? <span key={`d${i}`} className="dots">…</span> : (
          <button key={n} type="button" className={n === page ? "on" : ""} onClick={() => onPage(n)}>{n + 1}</button>
        ))}
        <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </nav>
  );
}

export default function TokenBoard({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [category, setCategory] = useState<MarketCategory>("trending");
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");
  const [hideThin, setHideThin] = useState(true);
  const { tokens, loading, error, stale, updatedAt, refresh } = useMarket(category);
  const [quickSol, setQuickSol] = useState(0.1);
  const [page, setPage] = useState(0);
  const [hoverPreview, setHoverPreview] = useState<{ token: MarketToken; top: number; left: number } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverEnter = useCallback((e: React.MouseEvent, token: MarketToken) => {
    if (window.matchMedia("(hover: none)").matches) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (openTimer.current) clearTimeout(openTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX;
    openTimer.current = setTimeout(() => {
      // sit right next to the pointer (the row itself spans the whole table, so anchoring to it put the card far away)
      const W = 380;
      const left = mx + 22 + W < window.innerWidth ? mx + 22 : Math.max(8, mx - W - 22);
      const top = Math.max(8, Math.min(rect.top + rect.height / 2 - 150, window.innerHeight - 440));
      setHoverPreview({ token, top, left });
    }, HOVER_DELAY_MS);
  }, []);
  const hoverLeave = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHoverPreview(null), 180);
  }, []);
  const hover = useMemo<HoverFns>(() => ({ enter: hoverEnter, leave: hoverLeave }), [hoverEnter, hoverLeave]);

  useEffect(() => {
    setCategory(readPref("wraith_board_cat", MARKET_CATEGORIES.map((c) => c.key), "trending"));
    setView(readPref("wraith_board_view", ["grid", "list"] as const, typeof window !== "undefined" && window.innerWidth < 700 ? "list" : "grid"));
  }, []);
  useEffect(() => {
    const syncPreset = () => setQuickSol(getActivePreset().amounts[0] || 0.1);
    syncPreset();
    window.addEventListener("storage", syncPreset);
    return () => window.removeEventListener("storage", syncPreset);
  }, []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tokens.filter((t) => {
      // Always filter [invalid] symbols regardless of other settings.
      if (!t.symbol || t.symbol === "?" || /^\[/.test(t.symbol)) return false;
      // Dead-token filter: require real liquidity AND some trading activity.
      if (hideThin && !t.onCurve) {
        if (t.liquidity < 8000) return false;
        if (t.volume.h24 === 0 && t.txns.buys + t.txns.sells === 0) return false;
      }
      if (!q) return true;
      return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q;
    });
  }, [tokens, query, hideThin]);

  useEffect(() => { setPage(0); }, [category, query, hideThin, view]);
  const size = PAGE_SIZE[view];
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const curPage = Math.min(page, pages - 1);
  const pageRows = shown.slice(curPage * size, (curPage + 1) * size);

  return (
    <section className="wx-board">
      <div className="wx-board-bar">
        <div className="wx-seg lg" role="tablist" aria-label="Market category">
          {MARKET_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={category === c.key}
              className={category === c.key ? "on" : ""}
              onClick={() => {
                setCategory(c.key);
                try { localStorage.setItem("wraith_board_cat", c.key); } catch { /* ignore */ }
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="wx-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, ticker or address"
            aria-label="Filter tokens"
          />
        </label>

        <label className="wx-check" title="Hide tokens with under $5K liquidity (bonding-curve tokens always shown)">
          <input type="checkbox" checked={hideThin} onChange={(e) => setHideThin(e.target.checked)} />
          <span>Hide thin liquidity</span>
        </label>

        <div style={{ flex: 1 }} />

        <span className="wx-live">
          <i className={stale ? "stale" : ""} />
          {stale ? "Delayed" : "Live"}
          {updatedAt ? <small> · <UpdatedAgo at={updatedAt} />s</small> : null}
        </span>

        <div className="wx-seg" aria-label="View">
          <button type="button" className={view === "grid" ? "on" : ""} onClick={() => { setView("grid"); try { localStorage.setItem("wraith_board_view", "grid"); } catch { /* ignore */ } }} aria-label="Card view" title="Cards">
            <LayoutGrid size={14} />
          </button>
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => { setView("list"); try { localStorage.setItem("wraith_board_view", "list"); } catch { /* ignore */ } }} aria-label="Table view" title="Table">
            <List size={14} />
          </button>
        </div>
        <button type="button" className="wx-icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="wx-board-body">
        {loading && !tokens.length ? (
          <div className={view === "grid" ? "wx-grid" : "wx-table"}>
            {Array.from({ length: view === "grid" ? 12 : 14 }).map((_, i) => (
              <div key={i} className="wx-skel" style={{ height: view === "grid" ? 168 : 56, borderRadius: 14 }} />
            ))}
          </div>
        ) : error && !tokens.length ? (
          <div className="wx-empty">
            <strong>Market data unavailable</strong>
            <span>{error}</span>
            <button type="button" className="wx-btn primary" onClick={refresh}>
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        ) : !shown.length ? (
          <div className="wx-empty">
            <strong>{query ? "No matches" : "Nothing here yet"}</strong>
            <span>{query ? "Try a different search, or clear the filter." : "New tokens appear here as soon as the providers index them."}</span>
          </div>
        ) : view === "grid" ? (
          <div className="wx-grid">
            {pageRows.map((t) => (
              <Card key={t.address} token={t} quickSol={quickSol} onOpen={() => onSelectMeme(toMeme(t))} />
            ))}
          </div>
        ) : (
          <div className="wx-table" role="table">
            <div className="wx-trow head" role="row">
              <span>Token</span>
              <span className="c-age">Age</span>
              <span>MCap</span>
              <span className="c-liq">Liq</span>
              <span className="c-vol">Vol 24h</span>
              <span className="c-5m">5m</span>
              <span>1h</span>
              <span className="c-24h">24h</span>
              <span className="c-tx">Txns</span>
              <span className="c-buy">Buy</span>
            </div>
            {pageRows.map((t) => (
              <Row key={t.address} token={t} quickSol={quickSol} hover={hover} onOpen={() => onSelectMeme(toMeme(t))} />
            ))}
          </div>
        )}
        {shown.length > 0 && <Pager page={curPage} pages={pages} total={shown.length} size={size} onPage={(p) => { setPage(p); document.querySelector(".wx-board-body")?.scrollTo({ top: 0 }); }} />}
        {hoverPreview && typeof document !== "undefined" && createPortal(
          <div
            style={{ position: "fixed", top: hoverPreview.top, left: hoverPreview.left, zIndex: 1200 }}
            onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
            onMouseLeave={hoverLeave}
          >
            <TokenHoverPreview
              contractAddress={hoverPreview.token.address}
              symbol={hoverPreview.token.symbol}
              name={safeName(hoverPreview.token.name, hoverPreview.token.symbol)}
              imageUrl={hoverPreview.token.imageUrl}
              mcap={hoverPreview.token.mcap}
              liquidity={hoverPreview.token.liquidity}
              volume24h={hoverPreview.token.volume.h24}
              priceChange24h={hoverPreview.token.change.h24 ?? undefined}
              showPaperQuickBuy={false}
            />
          </div>,
          document.body,
        )}
      </div>
    </section>
  );
}
