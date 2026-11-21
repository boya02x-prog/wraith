"use client";

// "Top calls this week": the best calls Wraith made in the last seven days, by how far they went from where they were called to their peak, as a row of
// cards you can swipe. It sits at the top of the Market list, so the front of the app opens on something that moves instead of straight onto a table
// (Fomo opens on its "Weekly top trades" the same way). The same record and the same peak the Wins screen and the landing page use.
import { useEffect, useMemo, useState } from "react";
import { Flame } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { TokenIcon } from "@/components/TokenIcon";
import { timesShort, usdShort } from "@/lib/tokenFmt";
import type { SignalCall } from "@/lib/signalCalls";

export default function TopCallsStrip({ onSelectMeme, onSeeAll }: { onSelectMeme: (meme: MemeTrend) => void; onSeeAll: () => void }) {
  const [calls, setCalls] = useState<SignalCall[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/signal-calls")
        .then((r) => (r.ok ? (r.json() as Promise<{ calls?: SignalCall[] }>) : null))
        .then((j) => { if (alive && Array.isArray(j?.calls)) setCalls(j.calls); })
        .catch(() => undefined);
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  const top = useMemo(
    () => (calls ?? [])
      .filter((c) => !c.shadow && c.spottedMcap > 0 && c.peakMcap / c.spottedMcap >= 1.5 && (!c.chain || c.chain === "solana"))
      .sort((a, b) => b.peakMcap / b.spottedMcap - a.peakMcap / a.spottedMcap)
      .slice(0, 8),
    [calls],
  );
  if (!top.length) return null;
  return (
    <section className="wk" aria-label="Top calls this week">
      <header>
        <Flame size={16} aria-hidden="true" />
        <b>Top calls this week</b>
        <button type="button" onClick={onSeeAll}>See all</button>
      </header>
      <div className="wk-row">
        {top.map((c) => (
          <button
            key={c.address}
            type="button"
            className="wk-card"
            onClick={() => onSelectMeme({ keyword: c.symbol, score: 0, posts: 0, source: "calls", contractAddress: c.address, tokenImageUrl: c.imageUrl, mcap: c.lastMcap })}
            data-hover-mint={c.address}
            data-hover-img={c.imageUrl}
            data-hover-called={c.spottedMcap}
            data-hover-at={c.spottedAt}
          >
            <TokenIcon contractAddress={c.address} imageUrl={c.imageUrl} symbol={c.symbol} size={40} />
            <span className="wk-sym">${c.symbol.replace(/^\$/, "")}</span>
            <strong className="wk-x">{timesShort(c.peakMcap / c.spottedMcap)}</strong>
            <small>{usdShort(c.spottedMcap)} to {usdShort(c.peakMcap)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
