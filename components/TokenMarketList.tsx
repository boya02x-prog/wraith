"use client";

// components/TokenMarketList.tsx
// Compact market list for the token-page sidebar. Same data source as the
// Discover board (/api/market) so both always agree.

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { useMarket } from "@/hooks/useMarket";
import { changeColor, fmtAge, fmtPct, fmtUsd, type MarketCategory } from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { prefetchChart } from "@/lib/prefetchChart";
import { TokenIcon } from "@/components/TokenIcon";
import BookmarkBtn from "@/components/BookmarkBtn";

const TABS: { key: MarketCategory; label: string }[] = [
  { key: "trending", label: "Hot" },
  { key: "new", label: "New" },
  { key: "gainers", label: "Gainers" },
  { key: "volume", label: "Volume" },
];

export default function TokenMarketList({
  onSelectMeme,
  selectedMeme,
}: {
  onSelectMeme: (meme: MemeTrend) => void;
  selectedMeme: MemeTrend | null;
}) {
  const [category, setCategory] = useState<MarketCategory>("trending");
  const { tokens, loading, error, refresh } = useMarket(category);

  return (
    <section className="wx-side-list">
      <header>
        <div className="wx-seg sm" role="tablist" aria-label="Market category">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={category === t.key} className={category === t.key ? "on" : ""} onClick={() => setCategory(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="wx-icon-btn" onClick={refresh} aria-label="Refresh token list" title="Refresh">
          <RefreshCw size={13} />
        </button>
      </header>

      <div className="wx-side-scroll">
        {loading && !tokens.length ? (
          Array.from({ length: 9 }).map((_, i) => <div key={i} className="wx-skel" style={{ height: 56, margin: "6px 10px", borderRadius: 10 }} />)
        ) : error && !tokens.length ? (
          <div className="wx-empty small">
            <span>{error}</span>
            <button type="button" className="wx-btn" onClick={refresh}>Retry</button>
          </div>
        ) : !tokens.length ? (
          <div className="wx-empty small"><span>No tokens right now.</span></div>
        ) : (
          tokens.map((t) => {
            const active = selectedMeme?.contractAddress === t.address;
            return (
              <div key={t.address} role="button" tabIndex={0} className={`wx-side-row${active ? " active" : ""}`} onClick={() => onSelectMeme(toMeme(t))} onKeyDown={(e) => { if (e.key === "Enter") onSelectMeme(toMeme(t)); }} onMouseEnter={() => prefetchChart(t.address, t.onCurve)} onTouchStart={() => prefetchChart(t.address, t.onCurve, true)}>
                <TokenIcon contractAddress={t.address} imageUrl={t.imageUrl} symbol={t.symbol} size={36} />
                <span className="mid">
                  <strong>{t.symbol}</strong>
                  <small>{fmtAge(t.createdAt)} · Vol {fmtUsd(t.volume.h24)}</small>
                </span>
                <span className="end">
                  <strong>{fmtUsd(t.mcap)}</strong>
                  <small style={{ color: changeColor(t.change.h1) }}>{fmtPct(t.change.h1)}</small>
                </span>
                <BookmarkBtn meme={toMeme(t)} />
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
