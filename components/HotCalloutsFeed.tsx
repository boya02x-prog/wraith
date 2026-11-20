"use client";

// Live feed of what traders are calling right now (public callouts, newest first).
// Keeps the last good list when the connection drops, can be paused, and never moves under your thumb: while you are reading further down, a call
// posted in the meantime waits behind a "new" button instead of pushing the page. The numbers under each call ("called at ... now ...") are re-read
// every 30 seconds, and the token block is its own flat card with a chart since the call. Styles: app/wraith-intel.css (the ix-* classes).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronRight, Flame, Heart, MessageCircle, Repeat2, TrendingUp, WifiOff } from "lucide-react";
import CallSpark from "@/components/CallSpark";
import { TokenIcon } from "@/components/TokenIcon";
import { useTokenMeta } from "@/lib/useTokenMeta";
import { Thread } from "@/components/FollowingIntelSidebar";
import XBadge from "@/components/XBadge";
import type { MemeTrend } from "@/app/app/page";
import { defaultAvatar } from "@/lib/defaultArt";
import { readLast, writeLast } from "@/lib/lastGood";
import { visibleInterval } from "@/lib/visibleInterval";

type Item = {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  xHandle?: string | null;
  avatarDataUrl: string;
  text: string;
  createdAt: number;
  mcapAtPost: number | null;
  hearts: number;
  hearted?: boolean;
  reposts: number;
  comments: number;
  mint?: string;
  imageUrl?: string | null;
  position: { amountSol: number; entryMcap: number; currentMcap: number; currentPnlPct: number; symbol: string } | null;
};

const usd = (n?: number | null) => {
  if (!n || !Number.isFinite(n)) return "";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const ago = (ts: number) => {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};
const fx = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));

/** how far down the page counts as "reading": above this a new call goes straight in, below it waits behind the button */
const READING_PX = 160;
/** the market caps under the calls are re-read this often while the page is open */
const REFRESH_MS = 30_000;

export default function HotCalloutsFeed({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [waiting, setWaiting] = useState<Item[] | null>(null); // a newer list held back while you read further down
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // (what the polling code below reads: kept in step by effects, not written while rendering)
  const pausedRef = useRef(false);
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"all" | "winning">("all");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [thread, setThread] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const meta = useTokenMeta(items.map((c) => c.mint ?? ""), REFRESH_MS);
  const nowMcap = (c: Item) => (c.mint && meta[c.mint]?.mcap) || c.position?.currentMcap || 0;
  // how far the token has moved since this call was posted
  const xSince = (c: Item): number | null => {
    const now = nowMcap(c);
    return c.mcapAtPost && c.mcapAtPost > 0 && now > 0 ? now / c.mcapAtPost : null;
  };
  const symOf = (c: Item) => meta[c.mint ?? ""]?.symbol || c.position?.symbol || "";
  const tagOf = (c: Item) => { const s = symOf(c).replace(/^\$/, ""); return s ? `$${s}` : "Token"; };
  const mintTag = (mint: string) => { const s = (meta[mint]?.symbol ?? "").replace(/^\$/, ""); return s ? `$${s}` : `${mint.slice(0, 4)}…`; };

  const shown = items.filter((c) => (filter === "winning" ? (xSince(c) ?? 0) >= 1.2 : true));
  const winningN = items.filter((c) => (xSince(c) ?? 0) >= 1.2).length;
  const trending = (() => {
    const m = new Map<string, { mint: string; n: number }>();
    for (const c of items) if (c.mint) m.set(c.mint, { mint: c.mint, n: (m.get(c.mint)?.n ?? 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  })();
  const bestAll = items
    .map((c) => ({ c, x: xSince(c) }))
    .filter((r): r is { c: Item; x: number } => r.x !== null && r.x >= 1.1)
    .sort((a, b) => b.x - a.x);
  const best = bestAll.slice(0, 5);

  const toggleHeart = async (c: Item) => {
    const on = !(liked[c.id] ?? c.hearted ?? false);
    setLiked((l) => ({ ...l, [c.id]: on }));
    try {
      const r = await fetch(`/api/callouts/${c.id}/heart`, { method: "POST" });
      if (!r.ok) setLiked((l) => ({ ...l, [c.id]: !on }));
    } catch { setLiked((l) => ({ ...l, [c.id]: !on })); }
  };

  const load = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const r = await fetch("/api/callouts?limit=40", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      const list: Item[] = Array.isArray(j.callouts) ? j.callouts : [];
      writeLast("hot_callouts", list);
      setStale(false);
      const onScreen = itemsRef.current;
      const known = new Set(onScreen.map((c) => c.id));
      const reading = (scroller.current?.scrollTop ?? 0) > READING_PX;
      if (onScreen.length && reading && list.some((c) => !known.has(c.id))) {
        // someone posted while you read further down: the calls on screen get their fresh counts, the new ones wait behind the button
        const by = new Map(list.map((c) => [c.id, c]));
        setItems((cur) => cur.map((c) => by.get(c.id) ?? c));
        setWaiting(list);
      } else {
        setItems(list);
        setWaiting(null);
      }
    } catch {
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = readLast<Item[]>("hot_callouts");
    if (saved?.length) { setItems(saved); setLoading(false); }
    void load();
    const t = visibleInterval(() => void load(), 15_000);
    const back = () => void load();
    window.addEventListener("online", back);
    return () => { window.clearInterval(t); window.removeEventListener("online", back); };
  }, [load]);

  const waitingN = waiting ? waiting.filter((c) => !items.some((i) => i.id === c.id)).length : 0;
  const showWaiting = () => {
    if (waiting) { setItems(waiting); setWaiting(null); }
    scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  // scrolling back to the top by hand also brings the waiting calls in
  const onScroll = () => {
    if (waiting && (scroller.current?.scrollTop ?? 0) < 60) { setItems(waiting); setWaiting(null); }
  };

  const openMint = (mint: string, fallback = "TOKEN", mcap?: number) =>
    onSelectMeme({ keyword: meta[mint]?.symbol || fallback, score: 0, posts: 0, source: "callouts", contractAddress: mint, tokenImageUrl: meta[mint]?.imageUrl, mcap: meta[mint]?.mcap ?? mcap });
  const openToken = (c: Item) => { if (c.mint) openMint(c.mint, c.position?.symbol || "TOKEN", c.position?.currentMcap); };

  // the strip of tokens on a phone (a computer shows the same two lists in the side column): the best calls so far, or the most called when none is up yet
  const rail = bestAll.length >= 2
    ? { label: "Best since call", icon: <TrendingUp size={14} aria-hidden="true" />, rows: bestAll.slice(0, 8).map(({ c, x }) => ({ key: c.id, mint: c.mint ?? "", note: `${fx(x)}x`, up: true, go: () => openToken(c) })) }
    : trending.length >= 2
      ? { label: "Most called", icon: <Flame size={14} aria-hidden="true" />, rows: trending.map((t) => ({ key: t.mint, mint: t.mint, note: `${t.n} calls`, up: false, go: () => openMint(t.mint) })) }
      : null;

  return (
    <div className="hc-scroll" ref={scroller} onScroll={onScroll}>
      <section className="ix-wrap" aria-label="Hot intel">
        <header className="ix-head">
          <div>
            <h2>Hot intel</h2>
            <p>Live calls from Wraith traders {stale && <span className="ix-off" title="Showing the last saved list"><WifiOff size={12} aria-hidden="true" /> offline</span>}</p>
          </div>
          <button type="button" className={`ix-live${paused ? " off" : ""}`} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            <i aria-hidden="true" /> {paused ? "Paused" : "Live"}
          </button>
        </header>

        <div className="ix-bar">
          <div className="ix-seg" role="tablist" aria-label="Filter intel" style={{ "--i": filter === "all" ? 0 : 1 } as React.CSSProperties}>
            {([["all", "All", items.length], ["winning", "Winning", winningN]] as const).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
                {label}{n > 0 && <i>{n}</i>}
              </button>
            ))}
          </div>
        </div>

        {!wide && rail && (
          <div className="ix-railwrap">
            <div className="ix-lbl">{rail.icon} {rail.label}</div>
            <div className="ix-rail">
              {rail.rows.map((r) => (
                <button key={r.key} type="button" className="ix-chip" onClick={r.go}>
                  <TokenIcon contractAddress={r.mint} imageUrl={meta[r.mint]?.imageUrl} symbol={meta[r.mint]?.symbol || "T"} size={28} />
                  <b>{mintTag(r.mint)}</b>
                  <em className={r.up ? "up" : ""}>{r.note}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        {waitingN > 0 && (
          <div className="ix-new">
            <button type="button" onClick={showWaiting}><ArrowUp size={15} aria-hidden="true" /> {waitingN} new {waitingN === 1 ? "call" : "calls"}</button>
          </div>
        )}

        <div className="ix-layout">
          <div className="ix-main">
            {loading ? (
              <div className="ix-list" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="ix-card ix-sk">
                    <div className="ix-sk-row"><i className="av" /><span><i className="l1" /><i className="l2" /></span></div>
                    <i className="t1" /><i className="t2" />
                    <i className="blk" />
                  </div>
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="ix-empty">
                <MessageCircle size={26} aria-hidden="true" />
                <b>{items.length === 0 ? "No intel yet" : "Nothing is up yet"}</b>
                <span>{items.length === 0 ? "Post one from any token page and it shows up here." : "No call is up 20% since it was posted. Check back soon, or switch to All."}</span>
              </div>
            ) : (
              <div className="ix-list" key={filter}>
                {shown.map((c) => {
                  const long = c.text.length > 180;
                  const expanded = open.has(c.id);
                  const x = xSince(c);
                  const now = nowMcap(c);
                  const isLiked = liked[c.id] ?? c.hearted ?? false;
                  const pnl = c.position?.currentPnlPct ?? 0;
                  return (
                    <article key={c.id} className={`ix-card${x !== null && x >= 2 ? " hot" : ""}`}>
                      <div className="ix-top">
                        <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="ix-who">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.avatarDataUrl || defaultAvatar(c.userId)} alt="" className="ix-av" />
                          <span className="ix-name">{c.displayName}</span>
                        </Link>
                        <XBadge handle={c.xHandle} />
                        <span className="ix-age">{ago(c.createdAt)}</span>
                      </div>
                      <p className={`ix-text${long && !expanded ? " clamp" : ""}`}>{c.text}</p>
                      {long && <button type="button" className="ix-more" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{expanded ? "Show less" : "Show more"}</button>}
                      {c.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.imageUrl} alt="" className="ix-media" loading="lazy" />}
                      {c.mint && (
                        <button type="button" className="ix-token" onClick={() => openToken(c)} aria-label={`Open ${tagOf(c)}`}>
                          <span className="ix-tk-top">
                            <TokenIcon contractAddress={c.mint} imageUrl={meta[c.mint]?.imageUrl} symbol={symOf(c) || "T"} size={44} />
                            <span className="ix-tk">
                              <b>{tagOf(c)}</b>
                              <small>Called {ago(c.createdAt) === "now" ? "just now" : `${ago(c.createdAt)} ago`}</small>
                            </span>
                            {x !== null && (
                              <span className={`ix-x ${x >= 1 ? "up" : "down"}`}>
                                <b>{fx(x)}x</b>
                                <small>since the call</small>
                              </span>
                            )}
                            <ChevronRight size={18} className="ix-go" aria-hidden="true" />
                          </span>
                          <CallSpark mint={c.mint} since={c.createdAt} />
                          <span className="ix-stats">
                            <span><small>Called at</small><b>{usd(c.mcapAtPost) || "-"}</b></span>
                            <span><small>Now</small><b>{usd(now) || "-"}</b></span>
                          </span>
                          {c.position && (
                            <span className="ix-pos">
                              <small>Their entry {usd(c.position.entryMcap)}</small>
                              <b className={pnl >= 0 ? "up" : "down"}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(0)}%</b>
                            </span>
                          )}
                        </button>
                      )}
                      <div className="ix-foot">
                        <button type="button" className={`ix-act${isLiked ? " on" : ""}`} onClick={() => void toggleHeart(c)} aria-pressed={isLiked} aria-label="Like"><Heart size={17} fill={isLiked ? "currentColor" : "none"} /> {c.hearts + (isLiked && !c.hearted ? 1 : !isLiked && c.hearted ? -1 : 0)}</button>
                        <span className="ix-act"><Repeat2 size={17} /> {c.reposts}</span>
                        <button type="button" className={`ix-act${thread === c.id ? " on-c" : ""}`} onClick={() => setThread(thread === c.id ? null : c.id)} aria-expanded={thread === c.id} aria-label="Comments"><MessageCircle size={17} /> {c.comments}</button>
                      </div>
                      {thread === c.id && c.mint && <Thread callout={c} meta={meta[c.mint]} onCount={() => undefined} />}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          {wide && <aside className="ix-side" aria-label="Intel highlights">
            <section>
              <h3><Flame size={14} aria-hidden="true" /> Most called</h3>
              {trending.length ? trending.map((t) => (
                <button key={t.mint} type="button" className="ix-mini" onClick={() => openMint(t.mint)}>
                  <TokenIcon contractAddress={t.mint} imageUrl={meta[t.mint]?.imageUrl} symbol={meta[t.mint]?.symbol || "T"} size={28} />
                  <b>{mintTag(t.mint)}</b><em>{t.n} {t.n === 1 ? "call" : "calls"}</em>
                </button>
              )) : <p className="ix-none">Nothing yet.</p>}
            </section>
            <section>
              <h3><TrendingUp size={14} aria-hidden="true" /> Best since call</h3>
              {best.length ? best.map(({ c, x }) => (
                <button key={c.id} type="button" className="ix-mini" onClick={() => openToken(c)}>
                  <TokenIcon contractAddress={c.mint ?? ""} imageUrl={c.mint ? meta[c.mint]?.imageUrl : undefined} symbol={symOf(c) || "T"} size={28} />
                  <b>{tagOf(c)}</b><em className="up">{fx(x)}x</em>
                </button>
              )) : <p className="ix-none">No call is up 10% yet.</p>}
            </section>
          </aside>}
        </div>
      </section>
    </div>
  );
}
