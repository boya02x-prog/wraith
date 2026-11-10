"use client";

// Live feed of what traders are calling right now (public callouts, newest first).
// Keeps the last good list when the connection drops, can be paused, and never reflows while you read.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flame, Heart, MessageCircle, Pause, Play, Repeat2, TrendingUp, WifiOff } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { useTokenMeta } from "@/lib/useTokenMeta";
import { Thread } from "@/components/FollowingIntelSidebar";
import XBadge from "@/components/XBadge";
import type { MemeTrend } from "@/app/app/page";
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

export default function HotCalloutsFeed({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const pausedRef = useRef(false);
  pausedRef.current = paused;
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
  const meta = useTokenMeta(items.map((c) => c.mint ?? ""));
  // how far the token has moved since this call was posted
  const xSince = (c: Item): number | null => {
    const now = (c.mint && meta[c.mint]?.mcap) || c.position?.currentMcap || 0;
    return c.mcapAtPost && c.mcapAtPost > 0 && now > 0 ? now / c.mcapAtPost : null;
  };
  const shown = items.filter((c) => (filter === "winning" ? (xSince(c) ?? 0) >= 1.2 : true));
  const trending = (() => {
    const m = new Map<string, { mint: string; n: number }>();
    for (const c of items) if (c.mint) m.set(c.mint, { mint: c.mint, n: (m.get(c.mint)?.n ?? 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  })();
  const best = items
    .map((c) => ({ c, x: xSince(c) }))
    .filter((r): r is { c: Item; x: number } => r.x !== null && r.x >= 1.1)
    .sort((a, b) => b.x - a.x)
    .slice(0, 5);

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
      setItems(list);
      setStale(false);
      writeLast("hot_callouts", list);
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

  const openToken = (c: Item) => {
    if (!c.mint) return;
    onSelectMeme({ keyword: meta[c.mint]?.symbol || c.position?.symbol || "TOKEN", score: 0, posts: 0, source: "callouts", contractAddress: c.mint, tokenImageUrl: meta[c.mint]?.imageUrl, mcap: meta[c.mint]?.mcap ?? c.position?.currentMcap });
  };

  const sym = (c: Item) => meta[c.mint ?? ""]?.symbol || c.position?.symbol || "Token";
  const chip = (mint: string) => meta[mint];

  return (
    <div className="hc-scroll">
    <section className="hc-wrap" aria-label="Hot intel">
      <header className="hc-head">
        <strong>Hot intel</strong>
        <span className="hc-sub">Live calls from Wraith traders</span>
        {stale && <span className="hc-off" title="Showing the last saved list"><WifiOff size={12} /> offline</span>}
        <div className="hc-filters" role="tablist" aria-label="Filter intel">
          {([["all", "All"], ["winning", "Winning"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <button type="button" className="hc-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? "Paused" : "Live"}
        </button>
      </header>
      <div className="hc-layout">
        <div className="hc-main">
          {loading ? (
            <div className="hc-list">{[0, 1, 2, 3].map((i) => <div key={i} className="wx-skel" style={{ height: 96, borderRadius: 10 }} />)}</div>
          ) : shown.length === 0 ? (
            <div className="hc-empty">{items.length === 0 ? "No intel yet. Post one from any token page and it shows up here." : "Nothing matches this filter yet."}</div>
          ) : (
            <div className="hc-list">
              {shown.map((c) => {
                const long = c.text.length > 180;
                const expanded = open.has(c.id);
                const x = xSince(c);
                const m = c.mint ? chip(c.mint) : undefined;
                const isLiked = liked[c.id] ?? c.hearted ?? false;
                return (
                  <article key={c.id} className={`hc-card${x !== null && x >= 2 ? " hot" : ""}`}>
                    <div className="hc-top">
                      {c.avatarDataUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.avatarDataUrl} alt="" className="hc-av" /> : <span className="hc-av fb">{c.displayName.slice(0, 1).toUpperCase()}</span>}
                      <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="hc-name">{c.displayName}</Link>
                      <XBadge handle={c.xHandle} />
                      <span className="hc-age">{ago(c.createdAt)}</span>
                      {x !== null && x >= 1.1 ? <span className="hc-x"><TrendingUp size={12} /> {x >= 10 ? x.toFixed(0) : x.toFixed(1)}x since call</span> : c.mcapAtPost ? <span className="hc-mc">{usd(c.mcapAtPost)} MC</span> : null}
                    </div>
                    <p className={`hc-text${long && !expanded ? " clamp" : ""}`}>{c.text}</p>
                    {long && <button type="button" className="hc-more" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{expanded ? "Show less" : "Show more"}</button>}
                    {c.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.imageUrl} alt="" className="hc-media" loading="lazy" />}
                    {c.mint && (
                      <button type="button" className="hc-token" onClick={() => openToken(c)}>
                        <TokenIcon contractAddress={c.mint} imageUrl={m?.imageUrl} symbol={sym(c)} size={34} />
                        <span className="hc-tk"><b>{sym(c)}</b><small>{m?.mcap ? `${usd(m.mcap)} now` : `${c.mint.slice(0, 4)}…${c.mint.slice(-4)}`}</small></span>
                        {c.position && (
                          <span className="hc-pos">
                            <small>Entry {usd(c.position.entryMcap)}</small>
                            <b style={{ color: c.position.currentPnlPct >= 0 ? "var(--win)" : "var(--loss)" }}>{c.position.currentPnlPct >= 0 ? "+" : ""}{c.position.currentPnlPct.toFixed(1)}%</b>
                          </span>
                        )}
                      </button>
                    )}
                    <div className="hc-foot">
                      <button type="button" className={`hc-act${isLiked ? " on" : ""}`} onClick={() => void toggleHeart(c)} aria-pressed={isLiked} aria-label="Like"><Heart size={14} fill={isLiked ? "currentColor" : "none"} /> {c.hearts + (isLiked && !c.hearted ? 1 : !isLiked && c.hearted ? -1 : 0)}</button>
                      <span className="hc-act"><Repeat2 size={14} /> {c.reposts}</span>
                      <button type="button" className={`hc-act${thread === c.id ? " on-c" : ""}`} onClick={() => setThread(thread === c.id ? null : c.id)} aria-expanded={thread === c.id} aria-label="Comments"><MessageCircle size={14} /> {c.comments}</button>
                    </div>
                    {thread === c.id && c.mint && <Thread callout={c} meta={meta[c.mint]} onCount={() => undefined} />}
                  </article>
                );
              })}
            </div>
          )}
        </div>
        {wide && <aside className="hc-side" aria-label="Intel highlights">
          <section>
            <h3><Flame size={13} /> Most called</h3>
            {trending.length ? trending.map((t) => (
              <button key={t.mint} type="button" className="hc-mini" onClick={() => onSelectMeme({ keyword: meta[t.mint]?.symbol || "TOKEN", score: 0, posts: 0, source: "callouts", contractAddress: t.mint, tokenImageUrl: meta[t.mint]?.imageUrl, mcap: meta[t.mint]?.mcap })}>
                <TokenIcon contractAddress={t.mint} imageUrl={meta[t.mint]?.imageUrl} symbol={meta[t.mint]?.symbol || "T"} size={24} />
                <b>{meta[t.mint]?.symbol || `${t.mint.slice(0, 4)}…`}</b><em>{t.n} {t.n === 1 ? "call" : "calls"}</em>
              </button>
            )) : <p className="mut">Nothing yet.</p>}
          </section>
          <section>
            <h3><TrendingUp size={13} /> Best since call</h3>
            {best.length ? best.map(({ c, x }) => (
              <button key={c.id} type="button" className="hc-mini" onClick={() => openToken(c)}>
                <TokenIcon contractAddress={c.mint ?? ""} imageUrl={c.mint ? meta[c.mint]?.imageUrl : undefined} symbol={sym(c)} size={24} />
                <b>{sym(c)}</b><em className="up">{x >= 10 ? x.toFixed(0) : x.toFixed(1)}x</em>
              </button>
            )) : <p className="mut">No call is up 10% yet.</p>}
          </section>
        </aside>}
      </div>
    </section>
    </div>
  );
}
