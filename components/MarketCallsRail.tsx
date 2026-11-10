"use client";

// components/MarketCallsRail.tsx
// Left panel on the Market view: callouts from traders you follow, plus the
// strongest live signals underneath.

import { swrRead, swrWrite } from "@/lib/swrCache";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Flame, UsersRound } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { fmtUsd } from "@/lib/market";
import { TokenIcon } from "@/components/TokenIcon";
import ChainLogo from "@/components/ChainLogo";
import { useTokenMeta } from "@/lib/useTokenMeta";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { useWraithTier } from "@/hooks/useWraithTier";
import TierGlyph from "@/components/TierGlyph";
import { TIERS } from "@/lib/tiers";

interface Callout {
  id: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarDataUrl?: string;
  text: string;
  createdAt: number;
  mcapAtPost: number | null;
  mint?: string;
  hearts: number;
  comments: number;
  reposts: number;
}
interface SigLite {
  token: { address: string; chain?: string; symbol: string; imageUrl?: string; mcap: number; change: { h1: number | null } };
  score: number;
}

function ago(ts?: number) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function mc(v?: number | null) {
  if (!v || !Number.isFinite(v)) return null;
  return fmtUsd(v);
}

export default function MarketCallsRail({ onSelectMeme, onOpenScanner }: { onSelectMeme: (meme: MemeTrend) => void; onOpenScanner: () => void }) {
  const warmCallouts = swrRead<Callout[]>("rail:callouts");
  const [callouts, setCallouts] = useState<Callout[]>(warmCallouts ?? []);
  const [state, setState] = useState<"loading" | "ready" | "error">(warmCallouts ? "ready" : "loading");
  const [signedOut, setSignedOut] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [signals, setSignals] = useState<SigLite[]>(() => swrRead<SigLite[]>("rail:signals") ?? []);
  const { canUse: can } = useWraithTier();
  const canSignals = can("live_signals_view");
  const canScore = can("ai_score");
  const meta = useTokenMeta(callouts.map((c) => c.mint ?? ""));

  const loadCallouts = useCallback(async () => {
    try {
      const res = await fetch("/api/callouts?following=1&limit=10", { cache: "no-store" });
      if (!res.ok) { setState((s) => (s === "ready" ? s : "error")); return; }
      const data: { callouts?: Callout[] } = await res.json();
      let list = Array.isArray(data.callouts) ? data.callouts : [];
      let fb = false;
      if (!list.length) {
        // Nobody you follow has posted yet: show the latest community intel instead of an empty box.
        const all = await fetch("/api/callouts?limit=8", { cache: "no-store" });
        if (all.ok) { const d: { callouts?: Callout[] } = await all.json(); list = Array.isArray(d.callouts) ? d.callouts : []; fb = list.length > 0; }
      }
      setFallback(fb);
      setCallouts(list);
      swrWrite("rail:callouts", list);
      setState("ready");
    } catch {
      setState((s) => (s === "ready" ? s : "error"));
    }
  }, []);
  useEffect(() => { void loadCallouts(); }, [loadCallouts]);
  useLiveRefresh(() => void loadCallouts(), 8000);

  useEffect(() => {
    // The callouts API quietly returns everyone's posts when signed out, so ask the session directly.
    fetch("/api/user/profile", { cache: "no-store" }).then((r) => { if (r.status === 401) setSignedOut(true); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!canSignals) { setSignals([]); return; }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/signals", { cache: "no-store" });
        if (!res.ok) return;
        const data: { signals?: SigLite[] } = await res.json();
        if (alive && Array.isArray(data.signals)) { const top = data.signals.slice(0, 6); setSignals(top); swrWrite("rail:signals", top); }
      } catch { /* optional */ }
    };
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [canSignals]);

  const open = (mint: string, symbol: string, imageUrl?: string, mcap?: number, chain?: string) =>
    onSelectMeme({ keyword: symbol, score: 0, posts: 0, source: chain && chain !== "solana" ? chain : "calls", contractAddress: mint, tokenImageUrl: imageUrl, mcap });

  return (
    <aside className="mc-rail" aria-label="Followed traders and signals">
      <section className="mc-sec">
        <header><UsersRound size={14} /><strong>Called by traders you follow</strong></header>
        {state === "loading" ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 78, margin: "6px 14px", borderRadius: 12 }} />)
        ) : signedOut ? (
          <p className="mc-empty">Sign in to see intel from traders you follow.</p>
        ) : state === "error" ? (
          <p className="mc-empty">Could not load intel right now.</p>
        ) : callouts.length === 0 ? (
          <p className="mc-empty">Nothing yet. Follow traders and their intel shows up here. <Link href="/app/traders">Find traders →</Link></p>
        ) : (
          <>
          {fallback && <p className="mc-empty" style={{ paddingBottom: 4 }}>Nobody you follow has posted yet. Latest from the community:</p>}
          {callouts.map((c) => {
            const m = c.mint ? meta[c.mint] : undefined;
            return (
              <button
                key={c.id}
                type="button"
                className="mc-call"
                disabled={!c.mint}
                onClick={() => c.mint && open(c.mint, m?.symbol ?? c.mint.slice(0, 4).toUpperCase(), m?.imageUrl, m?.mcap ?? c.mcapAtPost ?? undefined)}
              >
                <span className="mc-call-top">
                  {c.avatarDataUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.avatarDataUrl} alt="" referrerPolicy="no-referrer" /> : <i>{c.displayName.slice(0, 1).toUpperCase()}</i>}
                  <b>{c.displayName}</b>
                  <small>{ago(c.createdAt)}</small>
                  {mc(c.mcapAtPost) && <em>{mc(c.mcapAtPost)}</em>}
                </span>
                <span className="mc-call-text">{c.text}</span>
                {c.mint && (
                  <span className="mc-call-token">
                    <TokenIcon contractAddress={c.mint} imageUrl={m?.imageUrl} symbol={m?.symbol ?? "?"} size={16} />
                    {m ? `$${m.symbol}` : `${c.mint.slice(0, 4)}…`}
                    {m && <small>{mc(m.mcap)} now</small>}
                  </span>
                )}
              </button>
            );
          })}
          </>
        )}
      </section>

      <section className="mc-sec">
        <header><Flame size={14} /><strong>Top signals now</strong></header>
        {!canSignals ? (
          <div style={{ margin: "6px 14px 10px", padding: "16px 14px", borderRadius: 14, border: "1px dashed rgba(255,123,61,.4)", background: "linear-gradient(160deg, rgba(255,123,61,.10), rgba(255,123,61,.02))", textAlign: "center", display: "grid", gap: 8, justifyItems: "center" }}>
            <TierGlyph tier="WRAITH" size={40} />
            <strong style={{ fontSize: 13 }}>Live signals are a WRAITH feature</strong>
            <small style={{ color: "var(--text-dim, #8d8d99)", lineHeight: 1.5 }}>Hold {TIERS.WRAITH.minTokens.toLocaleString("en-US")} OMEN to unlock the scored live feed. The scanner stays open to everyone.</small>
            <a href="/#omen" style={{ color: "var(--accent-text, #ffad7b)", fontSize: 12, fontWeight: 700 }}>See tiers →</a>
          </div>
        ) : signals.length === 0 ? (
          <p className="mc-empty">Scoring live markets…</p>
        ) : (
          signals.map((s) => (
            <button key={s.token.address} type="button" className="mc-row" onClick={() => open(s.token.address, s.token.symbol, s.token.imageUrl, s.token.mcap, s.token.chain)}>
              <TokenIcon contractAddress={s.token.address} imageUrl={s.token.imageUrl} symbol={s.token.symbol} size={34} />
              <span className="mid">
                <strong>{s.token.symbol}</strong>
                <small><ChainLogo chain={s.token.chain ?? "solana"} size={12} /> {fmtUsd(s.token.mcap)}</small>
              </span>
              <span className="end">
                <b className={(s.token.change.h1 ?? 0) >= 0 ? "up" : "down"}>{(s.token.change.h1 ?? 0) >= 0 ? "+" : ""}{(s.token.change.h1 ?? 0).toFixed(0)}%</b>
                {canScore && <small>score {s.score}</small>}
              </span>
            </button>
          ))
        )}
        <button type="button" className="mc-more" onClick={onOpenScanner}>Open scanner →</button>
      </section>
    </aside>
  );
}
