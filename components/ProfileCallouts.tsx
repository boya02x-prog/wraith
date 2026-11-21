"use client";

import { threadOrder, threadHidden } from "@/lib/intelThreads";
import XBadge from "@/components/XBadge";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Heart, MessageCircle, Repeat2 } from "lucide-react";
import { Face, IntelToken, UpdateChip, ThreadGap, mcapLabel, timeAgo } from "@/components/CalloutParts";
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
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
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
    <div className="ix-list">
      {threadOrder(callouts).map((th) => {
        const { item: c, up, down, lead } = th;
        if (threadHidden(th, openThreads)) return th.idx === 1 ? <ThreadGap key={`gap-${th.gid}`} n={th.len - 2} onOpen={() => setOpenThreads((s) => new Set(s).add(th.gid as string))} /> : null;
        const m = c.mint ? meta[c.mint] : undefined;
        const nowMcap = m?.mcap || c.mcapAtPost;
        return (
          <article key={c.id} className={`ix-card${up ? " t-up" : ""}${down ? " t-down" : ""}`}>
            {c.repostedFrom && (
              <div className="fp-repost">
                <Repeat2 size={12} />
                <span>Reposted from {c.repostedFrom.displayName}</span>
              </div>
            )}
            <div className="ix-top">
              <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="ix-who">
                <Face src={c.avatarDataUrl} name={c.displayName} seed={c.userId} />
                <span className="ix-name">{c.displayName}</span>
              </Link>
              <XBadge handle={c.xHandle} />
              <span className="ix-age">{timeAgo(c.createdAt)}</span>
            </div>
            <p className="ix-text">{c.text}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.imageUrl && <img src={c.imageUrl} alt="" className="ix-media" loading="lazy" />}
            {c.mint && up && <UpdateChip at={c.mcapAtPost} first={lead.mcapAtPost} />}
            {c.mint && !up && <IntelToken mint={c.mint} meta={m} symbol={c.position?.symbol} calledMcap={c.mcapAtPost ?? c.position?.entryMcap} calledAt={c.createdAt} pnlPct={c.position ? c.position.currentPnlPct : undefined} entryMcap={c.position?.entryMcap} />}
            <div className="ix-foot">
              <span className="ix-act"><Heart size={17} /> {c.hearts}</span>
              <span className="ix-act"><Repeat2 size={17} /> {c.reposts}</span>
              <span className="ix-act"><MessageCircle size={17} /> {c.comments}</span>
              {nowMcap ? <span className="ix-act" style={{ marginLeft: "auto" }}>{mcapLabel(nowMcap)} MC</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
