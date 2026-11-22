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
import { swrPeek, swrWrite } from "@/lib/swrCache";

type Range = "week" | "last" | "month" | "all";
const RANGES: { k: Range; label: string }[] = [{ k: "week", label: "This week" }, { k: "last", label: "Last week" }, { k: "month", label: "30 days" }, { k: "all", label: "All time" }];

export default function TopCallsStrip({ onSelectMeme, onSeeAll }: { onSelectMeme: (meme: MemeTrend) => void; onSeeAll: () => void }) {
  const [range, setRange] = useState<Range>("week");
  const [calls, setCalls] = useState<SignalCall[] | null>(() => swrPeek<SignalCall[]>("top-calls:week") ?? null);
  useEffect(() => {
    let alive = true;
    setCalls(swrPeek<SignalCall[]>(`top-calls:${range}`) ?? null);
    const load = () =>
      fetch(`/api/signal-calls?range=${range}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ calls?: SignalCall[] }>) : null))
        .then((j) => { if (alive && Array.isArray(j?.calls)) { swrWrite(`top-calls:${range}`, j.calls); setCalls(j.calls); } })
        .catch(() => undefined);
    void load();
    // only the live week changes; older weeks are a finished record
    const t = range === "week" ? window.setInterval(() => { if (!document.hidden) void load(); }, 60_000) : 0;
    return () => { alive = false; if (t) window.clearInterval(t); };
  }, [range]);
  const top = useMemo(
    () => (calls ?? [])
      .filter((c) => !c.shadow && c.spottedMcap > 0 && c.peakMcap / c.spottedMcap >= 1.5 && (!c.chain || c.chain === "solana"))
      .sort((a, b) => b.peakMcap / b.spottedMcap - a.peakMcap / a.spottedMcap)
      .slice(0, range === "week" ? 8 : 12),
    [calls, range],
  );
  if (!top.length && range === "week") return null;
  return (
    <section className="wk" aria-label="Top calls">
      <header>
        <Flame size={16} aria-hidden="true" />
        <b>Top calls</b>
        <button type="button" onClick={onSeeAll}>See all</button>
      </header>
      <div className="wk-ranges" role="tablist" aria-label="Period">
        {RANGES.map((r) => <button key={r.k} type="button" role="tab" aria-selected={range === r.k} className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.label}</button>)}
      </div>
      {!top.length && <p className="wk-none">{calls === null ? "Loading…" : "No calls up 1.5x in this period."}</p>}
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
