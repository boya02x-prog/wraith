"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Heart, MessageCircle, Repeat2, Rss, Send, Smile, X } from "lucide-react";
import StickerSheet from "@/components/StickerSheet";
import { Face as PostFace, TokenCard, isFresh, mcapLabel, timeAgo as ago } from "@/components/CalloutParts";
import { useTokenMeta, type TokenMeta } from "@/lib/useTokenMeta";
import { swrPeek, swrWrite } from "@/lib/swrCache";
import { CALLOUT_POSTED_EVENT, useLiveRefresh } from "@/lib/useLiveRefresh";
import { readTokenFavorites, toggleTokenFavorite, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";

interface CalloutItem {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarDataUrl: string;
  text: string;
  createdAt: number;
  mcapAtPost: number | null;
  hearts: number;
  hearted?: boolean;
  reposts: number;
  reposted?: boolean;
  comments: number;
  imageUrl?: string | null;
  repostedFrom?: { displayName: string; username: string | null } | null;
  mint?: string;
}
interface Comment {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarDataUrl: string;
  text: string;
  imageUrl?: string | null;
  replyToId?: string | null;
  replyToName?: string | null;
  createdAt: number;
}
interface Gate {
  signedIn: boolean;
  ok: boolean;
  heldUsd: number;
  minUsd: number;
  reason?: string;
}

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function Face({ src, name, small }: { src?: string; name: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = small ? "fi-avatar sm" : "fi-avatar";
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cls} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className={`${cls} fallback`}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function Thread({ callout, meta, onCount }: { callout: CalloutItem; meta?: TokenMeta; onCount: (n: number) => void }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [gate, setGate] = useState<Gate | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sticker, setSticker] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const symbol = meta?.symbol ?? "this token";

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/callouts/${callout.id}/comments`, { cache: "no-store" });
      const d: { comments?: Comment[] } = await r.json();
      if (r.ok) {
        setComments(d.comments ?? []);
        onCount((d.comments ?? []).length);
      } else setComments([]);
    } catch {
      setComments([]);
    }
  }, [callout.id, onCount]);

  useEffect(() => { void load(); }, [load]);

  // The balance check is slower, so it loads separately and never blocks the comments.
  useEffect(() => {
    let alive = true;
    void fetch(`/api/callouts/${callout.id}/gate`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { gate?: Gate }) => { if (alive && d.gate) setGate(d.gate); })
      .catch(() => {});
    return () => { alive = false; };
  }, [callout.id]);

  const send = async () => {
    if ((!text.trim() && !sticker) || busy || !callout.mint) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/callouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: callout.mint, text: text.trim(), parentId: callout.id, mcapAtPost: meta?.mcap ?? null, imageUrl: sticker, replyTo: replyTo?.id }),
      });
      const d: { error?: string } = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "Could not post comment."); return; }
      setText("");
      setSticker(null);
      setReplyTo(null);
      await load();
      window.dispatchEvent(new Event(CALLOUT_POSTED_EVENT));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fi-thread">
      {comments === null ? (
        <div className="fi-thread-note">Loading…</div>
      ) : comments.length === 0 ? (
        <div className="fi-thread-note">No comments yet.</div>
      ) : (
        comments.map((c) => (
          <div key={c.id} className="fi-comment">
            <Face src={c.avatarDataUrl} name={c.displayName} small />
            <div>
              <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="fi-name">{c.displayName}</Link>
              <span className="fi-age"> · {timeAgo(c.createdAt)}</span>
              {c.replyToName ? <span className="fi-replying">↪ replying to {c.replyToName}</span> : null}
              {c.text ? <p>{c.text}</p> : null}
              {c.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.imageUrl} alt="" className="fi-sticker" loading="lazy" />}
              {gate?.ok ? <button type="button" className="fi-reply" onClick={() => { setReplyTo({ id: c.id, name: c.displayName }); inputRef.current?.focus(); }}>Reply</button> : null}
            </div>
          </div>
        ))
      )}

      {gate && !gate.signedIn ? (
        <div className="fi-gate">Sign in to comment.</div>
      ) : gate && !gate.ok ? (
        <div className="fi-gate">
          <b>Hold ${gate.minUsd} of {symbol} to comment.</b>
          <span>{gate.reason ?? `You hold $${gate.heldUsd.toFixed(2)} right now.`}</span>
          {callout.mint && <Link href={`/app/token/${callout.mint}`}>Open {symbol} →</Link>}
        </div>
      ) : gate ? (
        <div className="fi-compose-wrap">
          {sticker && (
            <div className="fi-pending">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sticker} alt="Selected sticker" />
              <button type="button" onClick={() => setSticker(null)} aria-label="Remove sticker"><X size={12} /></button>
            </div>
          )}
          {replyTo && (
            <div className="fi-replychip">
              <span>Replying to <b>{replyTo.name}</b></span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={12} /></button>
            </div>
          )}
          <div className="fi-compose">
            <input ref={inputRef} value={text} maxLength={280} placeholder={replyTo ? `Reply to ${replyTo.name}…` : "Add a comment…"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
            <button type="button" className="fi-react" onClick={() => setSheet((v) => !v)} aria-label="Stickers and GIFs" aria-expanded={sheet}><Smile size={16} /></button>
            <button type="button" onClick={() => void send()} disabled={busy || (!text.trim() && !sticker)} aria-label="Send comment"><Send size={14} /></button>
          </div>
          {sheet && <StickerSheet onClose={() => setSheet(false)} onPick={(d) => { setSticker(d); setSheet(false); }} />}
        </div>
      ) : null}
      {err && <div className="fi-err">{err}</div>}
    </div>
  );
}

export default function FollowingIntelSidebar({ embedded = false }: { embedded?: boolean } = {}) {
  const warm = swrPeek<CalloutItem[]>("fi:following");
  const [callouts, setCallouts] = useState<CalloutItem[]>(warm ?? []);
  const [loading, setLoading] = useState(!warm);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const meta = useTokenMeta(callouts.map((c) => c.mint ?? ""));

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/callouts?following=1&limit=20", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) { setCallouts(d.callouts ?? []); swrWrite("fi:following", d.callouts ?? []); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(() => void load(), 8000);

  useEffect(() => {
    const sync = () => setSaved(new Set(readTokenFavorites().map((f) => f.contractAddress ?? "")));
    sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TOKEN_FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const patch = (id: string, fn: (c: CalloutItem) => CalloutItem) =>
    setCallouts((list) => list.map((c) => (c.id === id ? fn(c) : c)));

  const heart = async (c: CalloutItem) => {
    patch(c.id, (x) => ({ ...x, hearted: !x.hearted, hearts: x.hearts + (x.hearted ? -1 : 1) }));
    try {
      const r = await fetch(`/api/callouts/${c.id}/heart`, { method: "POST" });
      if (!r.ok) patch(c.id, () => c);
    } catch { patch(c.id, () => c); }
  };

  const repost = async (c: CalloutItem) => {
    patch(c.id, (x) => ({ ...x, reposted: !x.reposted, reposts: x.reposts + (x.reposted ? -1 : 1) }));
    try {
      const r = await fetch(`/api/callouts/${c.id}/repost`, { method: "POST" });
      if (!r.ok) patch(c.id, () => c);
    } catch { patch(c.id, () => c); }
  };

  const save = (c: CalloutItem) => {
    if (!c.mint) return;
    const m = meta[c.mint];
    toggleTokenFavorite({
      keyword: m?.symbol ?? c.mint.slice(0, 4).toUpperCase(),
      score: 0,
      posts: 0,
      source: "saved",
      contractAddress: c.mint,
      tokenImageUrl: m?.imageUrl,
      mcap: m?.mcap ?? c.mcapAtPost ?? undefined,
    });
  };

  return (
    <div className="fi-sidebar">
      {!embedded && (
        <div className="fi-header">
          <div className="fi-head-copy">
            <span className="profile-eyebrow">SOCIAL</span>
            <span className="fi-title">Following Intel</span>
          </div>
          <Rss size={14} color="var(--orange-hot)" />
        </div>
      )}

      {loading ? (
        <div className="fi-empty">
          <div className="callouts-loading-dot" />
          <div className="callouts-loading-dot" />
          <div className="callouts-loading-dot" />
        </div>
      ) : callouts.length === 0 ? (
        <div className="fi-empty">
          <strong>No intels yet</strong>
          <span>Follow traders to see their intel here.</span>
        </div>
      ) : (
        <div className="fi-feed">
          {callouts.map((c) => {
            const m = c.mint ? meta[c.mint] : undefined;
            const isSaved = !!c.mint && saved.has(c.mint);
            return (
              <article key={c.id} className="fi-card fp-post">
                {c.repostedFrom && (
                  <div className="fp-repost">
                    <Repeat2 size={12} />
                    <span>Reposted from {c.repostedFrom.displayName}</span>
                  </div>
                )}
                <div className="fp-row">
                  <PostFace src={c.avatarDataUrl} name={c.displayName} />
                  <div className="fp-body">
                    <div className="fp-head">
                      <Link href={`/app/u/${encodeURIComponent(c.username ?? c.userId)}`} className="fp-name">{c.displayName}</Link>
                      <span className="fp-age">{ago(c.createdAt)}</span>
                      {isFresh(c.createdAt) && <i className="fp-live" aria-label="New" />}
                    </div>
                    <p className="fp-text">{c.text}</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.imageUrl && <img src={c.imageUrl} alt="" className="fp-img" />}
                    {c.mint && <TokenCard mint={c.mint} meta={m} calledMcap={c.mcapAtPost} />}
                <div className="fi-actions fp-actions">
                  <button type="button" className={c.hearted ? "on heart" : ""} onClick={() => void heart(c)} aria-label="Like" aria-pressed={!!c.hearted}>
                    <Heart size={14} fill={c.hearted ? "currentColor" : "none"} /> {c.hearts > 0 && <span>{c.hearts}</span>}
                  </button>
                  <button type="button" className={openThread === c.id ? "on" : ""} onClick={() => setOpenThread(openThread === c.id ? null : c.id)} aria-label="Comments" aria-expanded={openThread === c.id}>
                    <MessageCircle size={14} /> {c.comments > 0 && <span>{c.comments}</span>}
                  </button>
                  <button type="button" className={c.reposted ? "on repost" : ""} onClick={() => void repost(c)} aria-label="Repost" aria-pressed={!!c.reposted}>
                    <Repeat2 size={15} /> {c.reposts > 0 && <span>{c.reposts}</span>}
                  </button>
                  <button type="button" className={isSaved ? "on save" : ""} onClick={() => save(c)} aria-label={isSaved ? "Remove saved token" : "Save token"} title={isSaved ? "Saved. Click to remove" : "Save this token"} aria-pressed={isSaved}>
                    <Bookmark size={14} fill={isSaved ? "currentColor" : "none"} />
                  </button>
                  {(m?.mcap || c.mcapAtPost) ? <span className="fp-mc"><b>{mcapLabel(m?.mcap || c.mcapAtPost)}</b> MC</span> : null}
                </div>

                {openThread === c.id && (
                  <Thread callout={c} meta={m} onCount={(n) => patch(c.id, (x) => ({ ...x, comments: n }))} />
                )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
