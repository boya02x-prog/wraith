"use client";

// Shared pieces for the profile feed (Following + My callouts): avatar, time, market-cap label and the embedded token card.

import Link from "next/link";
import { useState } from "react";
import { TokenIcon } from "@/components/TokenIcon";
import type { TokenMeta } from "@/lib/useTokenMeta";

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

export function Face({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, flexBasis: size };
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="fp-face" style={style} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
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
