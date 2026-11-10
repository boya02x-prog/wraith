"use client";

// Live signals for the token-page sidebar: same feed as the Scanner, one click to open, one click to save.

import { useEffect, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { Lock, Radar } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import type { Signal } from "@/app/api/signals/route";
import { useWraithTier } from "@/hooks/useWraithTier";
import { changeColor, fmtAge, fmtPct, fmtUsd } from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { prefetchChart } from "@/lib/prefetchChart";
import { TokenIcon } from "@/components/TokenIcon";
import BookmarkBtn from "@/components/BookmarkBtn";
import TierGlyph from "@/components/TierGlyph";

export default function SignalsSidebar({ onSelectMeme, selectedMeme }: { onSelectMeme: (m: MemeTrend) => void; selectedMeme: MemeTrend | null }) {
  const { canUse } = useWraithTier();
  const allowed = canUse("live_signals_view");
  const showScore = canUse("ai_score");
  const [signals, setSignals] = useState<Signal[] | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    const run = () => fetch("/api/signals", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: { signals?: Signal[] } | null) => { if (alive && d?.signals) setSignals(d.signals); }).catch(() => undefined);
    void run();
    const t = visibleInterval(run, 20_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="wx-empty small" style={{ gap: 10, padding: 20 }}>
        <TierGlyph tier="WRAITH" size={46} />
        <strong style={{ color: "var(--text)" }}>Live signals are WRAITH tier</strong>
        <span>Hold 1,000,000 OMEN to see every signal as Wraith flags it.</span>
        <a className="wx-btn" href="/#omen"><Lock size={12} /> See tiers</a>
      </div>
    );
  }
  if (!signals) return <div className="wx-side-scroll">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 56, margin: "6px 10px", borderRadius: 10 }} />)}</div>;
  if (!signals.length) return <div className="wx-empty small"><Radar size={18} /><span>No live signals right now.</span></div>;

  return (
    <div className="wx-side-scroll">
      {signals.map((s) => {
        const t = s.token;
        const meme = toMeme(t);
        const active = selectedMeme?.contractAddress === t.address;
        return (
          <div key={t.address} role="button" tabIndex={0} className={`wx-side-row${active ? " active" : ""}`} onClick={() => onSelectMeme(meme)} onKeyDown={(e) => { if (e.key === "Enter") onSelectMeme(meme); }} onMouseEnter={() => prefetchChart(t.address, t.onCurve)} onTouchStart={() => prefetchChart(t.address, t.onCurve, true)}>
            <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={36} />
            <span className="mid">
              <strong>{t.symbol} <i className={`sg-tier ${s.tier === "HOT" ? "hot" : ""}`}>{s.tier}</i></strong>
              <small>{fmtAge(t.createdAt)} · {s.tags[0] ?? "signal"}</small>
            </span>
            <span className="end">
              <strong>{fmtUsd(t.mcap)}</strong>
              <small style={{ color: changeColor(t.change.h1) }}>{showScore ? `${Math.round(s.score)} · ` : ""}{fmtPct(t.change.h1)}</small>
            </span>
            <BookmarkBtn meme={meme} />
          </div>
        );
      })}
    </div>
  );
}
