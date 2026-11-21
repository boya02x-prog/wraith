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
import { useTick } from "@/lib/useTick";
import { prefetchChart } from "@/lib/prefetchChart";
import { TokenIcon } from "@/components/TokenIcon";
import { UpdatedAgo } from "@/components/UpdatedAgo";
import { QuickBuyButton } from "@/components/QuickBuyButton";
import { getActivePreset } from "@/lib/quickBuyPresets";
import { HOVER_DELAY_MS, TokenHoverPreview } from "@/components/TokenHoverChart";
import BookmarkBtn from "@/components/BookmarkBtn";

// ── sorting the table by a column, and holding the order while the mouse is on the list ──
// The first click on a column puts the biggest first (the youngest first for Age), a second click reverses, a third goes back to the tab's own order.
type SortKey = "age" | "mcap" | "liq" | "vol" | "m5" | "h1" | "h24" | "tx";
type Sort = { k: SortKey; dir: 1 | -1 } | null;
const SORTERS: Record<SortKey, { value: (t: MarketToken) => number | null; first: 1 | -1 }> = {
  age: { value: (t) => (t.createdAt ? -t.createdAt : null), first: 1 }, // smaller = newer, so ascending is youngest first
  mcap: { value: (t) => t.mcap, first: -1 },
  liq: { value: (t) => t.liquidity, first: -1 },
  vol: { value: (t) => t.volume.h24, first: -1 },
  m5: { value: (t) => t.change.m5, first: -1 },
  h1: { value: (t) => t.change.h1, first: -1 },
  h24: { value: (t) => t.change.h24, first: -1 },
  tx: { value: (t) => t.txns.buys + t.txns.sells, first: -1 },
};
function sortTokens(list: MarketToken[], sort: Sort): MarketToken[] {
  if (!sort) return list;
  const { value } = SORTERS[sort.k];
  return [...list].sort((a, b) => {
    const x = value(a), y = value(b);
    const nx = x == null || !Number.isFinite(x), ny = y == null || !Number.isFinite(y);
    if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1; // a token with no figure for this column goes last
    return ((x as number) - (y as number)) * sort.dir;
  });
}
/** Keeps rows where they were when the pointer came onto the list: the numbers still update, a token that is new goes to the end. */
function holdOrder(list: MarketToken[], order: string[] | null): MarketToken[] {
  if (!order) return list;
  const at = new Map(order.map((a, i) => [a, i]));
  return [...list].sort((a, b) => (at.get(a.address) ?? 1e9) - (at.get(b.address) ?? 1e9));
}
const pointerIsMouse = () => { try { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch { return false; } };

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
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 58, 4 + (1 - (v - min) / span) * 13] as const);
  // a smooth curve through the points (Catmull-Rom turned into bezier segments), not a stack of straight kinks
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] ?? xy[i + 1];
    const c1y = Math.min(Math.max(p1[1] + (p2[1] - p0[1]) / 6, 2), 20), c2y = Math.min(Math.max(p2[1] - (p3[1] - p1[1]) / 6, 2), 20);
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${c1y.toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const [tx, ty] = xy[xy.length - 1];
  const first = c.h24 ?? c.h6 ?? c.h1 ?? 0;
  const col = first >= 0 ? "#22c55e" : "#ef4444";
  const gid = `sp${Math.round(tx * 7 + ty * 13)}${first >= 0 ? "u" : "d"}`;
  // the line, a soft fill under it, a quiet light that travels along it now and then, and a head that breathes
  return (
    <svg className="wx-spark" viewBox="0 0 64 22" width="64" height="22" aria-hidden="true" style={{ overflow: "visible", color: col }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity="0.26" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${tx.toFixed(1)} 22 L0 22 Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" pathLength="100" className="wx-spark-glint" />
      <circle cx={tx} cy={ty} r="2.2" fill={col} className="wx-spark-ring" />
      <circle cx={tx} cy={ty} r="2.1" fill={col} />
      <circle cx={tx} cy={ty} r="0.9" fill="#fff" />
    </svg>
  );
}

// Sanitize name: skip tokens whose symbol/name is clearly garbage data.
function safeName(name: string, symbol: string): string {
  if (!name || name === "?" || /^\[/.test(name)) return symbol;
  return name;
}

function CardBase({ token, onOpen, quickSol }: { token: MarketToken; onOpen: () => void; quickSol: number }) {
  const tick = useTick(token.mcap);
  return (
    <div
      className={`wx-tcard${tick ? ` ${tick.cls}` : ""}`}
      data-dir={(token.change.h1 ?? 0) > 0 ? "up" : (token.change.h1 ?? 0) < 0 ? "down" : "flat"}
      style={tick ? { animationDelay: `${tick.delay}ms` } : undefined}
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
        {/* the star saves it (it then sits in the saved bar on a computer); the wrapper keeps a click or a key on it from opening the card */}
        <span className="wx-bm" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><BookmarkBtn meme={toMeme(token)} size={16} /></span>
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
  const tick = useTick(token.mcap);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`wx-trow${tick ? ` ${tick.cls}` : ""}`}
      style={tick ? { animationDelay: `${tick.delay}ms` } : undefined}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      onMouseEnter={() => prefetchChart(token.address, token.onCurve)} onTouchStart={() => prefetchChart(token.address, token.onCurve, true)}
    >
      <span className="wx-trow-id" onMouseEnter={(e) => hover.enter(e, token)} onMouseLeave={hover.leave}>
        <span className="wx-bm" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><BookmarkBtn meme={toMeme(token)} size={16} /></span>
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

export default function TokenBoard({ onSelectMeme, top }: { onSelectMeme: (meme: MemeTrend) => void; /** something drawn above the list, inside the part that scrolls (the pet card on a phone) */ top?: React.ReactNode }) {
  const [category, setCategory] = useState<MarketCategory>("trending");
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");
  const [hideThin, setHideThin] = useState(true);
  const { tokens, loading, error, stale, updatedAt, refresh } = useMarket(category);
  const [quickSol, setQuickSol] = useState(0.1);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<Sort>(null);
  // the order the rows were in when the mouse came onto the list (null = not holding): rows must not move under the pointer, or a click
  // meant for one token (the quick-buy button above all) lands on another one that was just re-ranked into its place
  const [held, setHeld] = useState<string[] | null>(null);
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

  const sorted = useMemo(() => sortTokens(shown, sort), [shown, sort]);
  const ordered = useMemo(() => holdOrder(sorted, held), [sorted, held]);
  const holdRows = () => { if (pointerIsMouse()) setHeld(ordered.map((t) => t.address)); };
  const releaseRows = () => setHeld(null);
  const pickSort = (k: SortKey) => {
    const first = SORTERS[k].first;
    const next: Sort = sort?.k !== k ? { k, dir: first } : sort.dir === first ? { k, dir: (first === 1 ? -1 : 1) as 1 | -1 } : null;
    setSort(next);
    setPage(0);
    if (held) setHeld(sortTokens(shown, next).map((t) => t.address)); // the pointer is on the table: hold the NEW order, not the old one
  };
  const head = (k: SortKey, label: string, cls?: string) => (
    <span
      role="columnheader"
      tabIndex={0}
      className={`sortable${cls ? ` ${cls}` : ""}${sort?.k === k ? " on" : ""}`}
      aria-sort={sort?.k === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
      title={`Sort by ${label}`}
      onClick={() => pickSort(k)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickSort(k); } }}
    >
      {label}{sort?.k === k && <i aria-hidden="true">{sort.dir === 1 ? "↑" : "↓"}</i>}
    </span>
  );

  useEffect(() => { setPage(0); }, [category, query, hideThin, view]);
  const size = PAGE_SIZE[view];
  const pages = Math.max(1, Math.ceil(ordered.length / size));
  const curPage = Math.min(page, pages - 1);
  const pageRows = ordered.slice(curPage * size, (curPage + 1) * size);

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
                setSort(null); // a column sort belongs to the tab it was made on
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

        <span className="wx-live" title={held ? "The rows stay where they are while the pointer is on the list, so a click never lands on a different token. The numbers keep updating." : undefined}>
          <i className={held ? "held" : stale ? "stale" : ""} />
          {held ? "Order locked" : stale ? "Delayed" : "Live"}
          {updatedAt && !held ? <small> · <UpdatedAgo at={updatedAt} />s</small> : null}
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

      <div className="wx-board-body" onMouseEnter={holdRows} onMouseLeave={releaseRows}>
        {top}
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
              {head("age", "Age", "c-age")}
              {head("mcap", "MCap")}
              {head("liq", "Liq", "c-liq")}
              {head("vol", "Vol 24h", "c-vol")}
              {head("m5", "5m", "c-5m")}
              {head("h1", "1h")}
              {head("h24", "24h", "c-24h")}
              {head("tx", "Txns", "c-tx")}
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
