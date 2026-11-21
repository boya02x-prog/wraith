"use client";

// The "Saved" tab of the token page's side panel: every token you starred, with its market cap and 24h move (the same numbers the saved bar shows).
import { useEffect, useMemo, useState } from "react";
import type { MemeTrend } from "@/app/app/page";
import BookmarkBtn from "@/components/BookmarkBtn";
import { TokenIcon } from "@/components/TokenIcon";
import { SOLANA_MINT_RE } from "@/lib/market";
import { pctShort, usdShort } from "@/lib/tokenFmt";

type Px = { mcap: number; change24h?: number | null };

export default function SavedSideList({ favorites, onPick }: { favorites: MemeTrend[]; onPick: (f: MemeTrend) => void }) {
  const [px, setPx] = useState<Record<string, Px>>({});
  const key = useMemo(() => favorites.map((f) => f.contractAddress ?? "").filter((m) => SOLANA_MINT_RE.test(m)).slice(0, 30).join(","), [favorites]);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const pull = () =>
      fetch(`/api/signal-prices?mints=${key}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ prices?: Record<string, Px> }>) : null))
        .then((j) => { if (alive && j?.prices) setPx(j.prices); })
        .catch(() => undefined);
    void pull();
    const t = window.setInterval(() => { if (!document.hidden) void pull(); }, 20_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [key]);

  return (
    <div className="wx-side-scroll">
      {favorites.map((f) => {
        const p = px[f.contractAddress ?? ""];
        const mc = p?.mcap || f.mcap;
        const ch = p?.change24h;
        return (
          <div key={f.contractAddress} role="button" tabIndex={0} className="wx-side-row" onClick={() => onPick(f)} onKeyDown={(e) => { if (e.key === "Enter") onPick(f); }}>
            <TokenIcon contractAddress={f.contractAddress} imageUrl={f.tokenImageUrl} symbol={f.keyword} size={36} />
            <span className="mid">
              <strong>{f.keyword}</strong>
              {mc ? <small style={{ color: "var(--text-muted)", fontSize: 12 }}>{usdShort(mc)}</small> : null}
            </span>
            {ch != null && Number.isFinite(ch) ? <b style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: ch >= 0 ? "var(--sk-up, #3ddc97)" : "var(--sk-down, #ff6b62)" }}>{pctShort(ch)}</b> : null}
            <BookmarkBtn meme={f} />
          </div>
        );
      })}
    </div>
  );
}
