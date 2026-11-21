"use client";

// Shared pieces for the profile feed (Following + My callouts): avatar, time, market-cap label and the embedded token card.

import Link from "next/link";
import { useState } from "react";
import { TokenIcon } from "@/components/TokenIcon";
import type { TokenMeta } from "@/lib/useTokenMeta";
import { defaultAvatar } from "@/lib/defaultArt";
import { ChevronRight } from "lucide-react";
import CallSpark from "@/components/CallSpark";

export function timeAgo(ts: number) {
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / (86400 * 7))}w`;
}

export function isFresh(ts: number) {
  return Date.now() - ts < 10 * 60 * 1000;
}

export function mcapLabel(v?: number | null) {
  if (!v || !Number.isFinite(v)) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K`;
  return `$${v.toFixed(0)}`;
}

function pctLabel(v: number) {
  const a = Math.abs(v);
  const body = a >= 10000 ? `${(a / 1000).toFixed(0)}K` : a >= 1000 ? `${(a / 1000).toFixed(1)}K` : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return `${v >= 0 ? "+" : "-"}${body}%`;
}

/** `seed` is the account id: with no photo (or a broken one) the same default picture the profile and the lists show is drawn, not a letter. */
export function Face({ src, name, size = 40, seed }: { src?: string; name: string; size?: number; seed?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, flexBasis: size };
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="fp-face" style={style} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  if (seed) return <img src={defaultAvatar(seed)} alt="" className="fp-face" style={style} />;
  return <span className="fp-face fallback" style={style}>{name.slice(0, 1).toUpperCase()}</span>;
}

/** Call ticket under a post: logo + $SYMBOL + called -> now on the left, the move since the call (or your P&L) on the right. */
export function TokenCard({
  mint,
  meta,
  symbol,
  calledMcap,
  pnlPct,
}: {
  mint?: string;
  meta?: TokenMeta;
  symbol?: string;
  calledMcap?: number | null;
  pnlPct?: number | null;
}) {
  if (!mint && !symbol) return null;
  const sym = meta?.symbol ?? symbol ?? (mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : "?");
  const nowMcap = meta?.mcap && meta.mcap > 0 ? meta.mcap : null;
  const own = pnlPct !== undefined && pnlPct !== null;
  const since = own ? pnlPct : calledMcap && nowMcap ? (nowMcap / calledMcap - 1) * 100 : null;
  const tone = since === null ? "" : since >= 0 ? " up" : " down";

  const body = (
    <>
      <TokenIcon contractAddress={mint} imageUrl={meta?.imageUrl} symbol={sym} size={28} />
      <div className="fp-call-main">
        <b className="fp-call-sym">${sym}</b>
        <span className="fp-call-path">
          {own ? "entry " : ""}
          {mcapLabel(calledMcap) ?? "-"}
          {!own && nowMcap ? ` › ${mcapLabel(nowMcap)}` : ""}
        </span>
      </div>
      <div className="fp-call-gain">
        <b className={`fp-call-pct${tone}`}>{since === null ? "-" : pctLabel(since)}</b>
        <small>{own ? "P&L" : "since call"}</small>
      </div>
    </>
  );

  return mint ? (
    <Link href={`/app/token/${mint}`} className={`fp-call${tone}`}>{body}</Link>
  ) : (
    <div className={`fp-call${tone}`}>{body}</div>
  );
}

/** The token block of a call, the same one the Hot intel feed shows (logo, how far it went since the call, a chart from the call to now, called-at and now), so every list of calls looks alike. */
export function IntelToken({ mint, meta, symbol, calledMcap, calledAt, pnlPct, entryMcap }: { mint: string; meta?: TokenMeta; symbol?: string; calledMcap?: number | null; calledAt: number; pnlPct?: number | null; entryMcap?: number | null }) {
  const sym = meta?.symbol ?? symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const now = meta?.mcap && meta.mcap > 0 ? meta.mcap : null;
  const x = calledMcap && now ? now / calledMcap : null;
  const fx = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
  const ago = timeAgo(calledAt);
  return (
    <Link href={`/app/token/${mint}`} className="ix-token" data-hover-mint={mint} data-hover-img={meta?.imageUrl ?? undefined} data-hover-called={calledMcap ?? undefined} data-hover-at={calledAt}>
      <span className="ix-tk-top">
        <TokenIcon contractAddress={mint} imageUrl={meta?.imageUrl} symbol={sym} size={44} />
        <span className="ix-tk">
          <b>${sym.replace(/^\$/, "")}</b>
          <small>Called {ago === "now" ? "just now" : `${ago} ago`}</small>
        </span>
        {x !== null && (
          <span className={`ix-x ${x >= 1 ? "up" : "down"}`}>
            <b>{fx(x)}x</b>
            <small>since the call</small>
          </span>
        )}
        <ChevronRight size={18} className="ix-go" aria-hidden="true" />
      </span>
      <CallSpark mint={mint} since={calledAt} />
      <span className="ix-stats">
        <span><small>Called at</small><b>{mcapLabel(calledMcap) ?? "-"}</b></span>
        <span><small>Now</small><b>{mcapLabel(now ?? calledMcap) ?? "-"}</b></span>
      </span>
      {pnlPct !== undefined && pnlPct !== null && (
        <span className="ix-pos">
          <small>Their entry {mcapLabel(entryMcap) ?? "-"}</small>
          <b className={pnlPct >= 0 ? "up" : "down"}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%</b>
        </span>
      )}
    </Link>
  );
}

/** under a later post in a thread (the token block is shown once, on the first post): where the token was when this update was posted, and how far it had moved from the first call */
export function UpdateChip({ at, first }: { at?: number | null; first?: number | null }) {
  if (!at) return null;
  const x = first && first > 0 ? at / first : null;
  return (
    <span className="ix-upd">
      <small>Update at</small>
      <b>{mcapLabel(at)}</b>
      {x !== null && <em className={x >= 1 ? "up" : "down"}>{x >= 1 ? "+" : ""}{Math.round((x - 1) * 100)}% since first call</em>}
    </span>
  );
}

/** the dotted gap in a long thread */
export function ThreadGap({ n, onOpen }: { n: number; onOpen: () => void }) {
  return <button type="button" className="ix-gap" onClick={onOpen}>Show {n} more {n === 1 ? "update" : "updates"}</button>;
}
