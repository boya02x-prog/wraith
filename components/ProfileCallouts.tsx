"use client";

import XBadge from "@/components/XBadge";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Heart, MessageCircle, Repeat2 } from "lucide-react";
import { Face, TokenCard, isFresh, mcapLabel, timeAgo } from "@/components/CalloutParts";
import { useTokenMeta } from "@/lib/useTokenMeta";

interface CalloutItem {
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
  reposts: number;
  comments: number;
  mint?: string;
  imageUrl?: string | null;
  repostedFrom?: { displayName: string; username: string | null; text: string } | null;
  position: {
    symbol: string;
    entryMcap: number;
    currentPnlPct: number;
  } | null;
}

export default function ProfileCallouts({ userId }: { userId: string }) {
  const [callouts, setCallouts] = useState<CalloutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const meta = useTokenMeta(callouts.map((c) => c.mint ?? ""));

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/callouts?userId=${encodeURIComponent(userId)}&limit=20`);
      const d = await r.json();
      if (r.ok) setCallouts(d.callouts ?? []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    setCallouts([]);
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="fp-empty">
        <div className="callouts-loading-dot" /><div className="callouts-loading-dot" /><div className="callouts-loading-dot" />
      </div>
    );
  }

  if (callouts.length === 0) {
    return (
      <div className="fp-empty">
        <strong>No intel yet</strong>
        <span>Open a token and share your take to see it here.</span>
      </div>
    );
  }

  return (
    <div className="fi-feed">
      {callouts.map((c) => {
        const m = c.mint ? meta[c.mint] : undefined;
        const nowMcap = m?.mcap || c.mcapAtPost;
        return (
          <article key={c.id} className="fi-card fp-post">
            {c.repostedFrom && (
              <div className="fp-repost">
                <Repeat2 size={12} />
                <span>Reposted from {c.repostedFrom.displayName}</span>
              </div>
            )}
            <div className="fp-row">
              <Face src={c.avatarDataUrl} name={c.displayName} />
              <div className="fp-body">
                <div className="fp-head">
                  <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="fp-name">{c.displayName}</Link>
                  <XBadge handle={c.xHandle} />
                  <span className="fp-age">{timeAgo(c.createdAt)}</span>
                  {isFresh(c.createdAt) && <i className="fp-live" aria-label="New" />}
                </div>
                <p className="fp-text">{c.text}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.imageUrl && <img src={c.imageUrl} alt="" className="fp-img" />}
                <TokenCard
                  mint={c.mint}
                  meta={m}
                  symbol={c.position?.symbol}
                  calledMcap={c.position?.entryMcap ?? c.mcapAtPost}
                  pnlPct={c.position ? c.position.currentPnlPct : undefined}
                />
                <div className="fp-actions">
                  <span className="fp-stat"><Heart size={15} />{c.hearts > 0 && c.hearts}</span>
                  <span className="fp-stat"><MessageCircle size={15} />{c.comments > 0 && c.comments}</span>
                  <span className="fp-stat"><Repeat2 size={16} />{c.reposts > 0 && c.reposts}</span>
                  {nowMcap ? <span className="fp-mc"><b>{mcapLabel(nowMcap)}</b> MC</span> : null}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
