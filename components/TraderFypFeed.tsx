"use client";

import Link from "next/link";
import { visibleInterval } from "@/lib/visibleInterval";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Radio } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";

type Callout = {
  traderId: string;
  traderName: string;
  avatarDataUrl: string;
  type: "open" | "closed";
  symbol?: string;
  mint: string;
  amountSol?: number;
  entryMcap?: number;
  currentMcap?: number;
  exitMcap?: number;
  currentPnlPct?: number;
  pnlPct?: number;
  imageUrl?: string;
  ts?: number;
};

function marketCap(value?: number) {
  if (!value || !Number.isFinite(value)) return "MCap n/a";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function elapsed(ts?: number) {
  if (!ts) return "time n/a";
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

export default function TraderFypFeed({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/traders/feed", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Followed trader activity is unavailable.");
      setCallouts(Array.isArray(data.callouts) ? data.callouts : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load trader activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = visibleInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section style={{ flex: "0 0 auto", maxHeight: "42%", minHeight: 150, display: "flex", flexDirection: "column", borderBottom: "1px solid var(--border)", background: "linear-gradient(145deg, rgba(240,90,36,.08), transparent 72%)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 13px 10px" }}>
        <Radio size={14} color="var(--orange-hot)" />
        <strong style={{ fontSize: 11, letterSpacing: ".12em" }}>FOLLOWING ACTIVITY</strong>
        <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{callouts.length} intel</span>
      </header>
      <div style={{ overflowY: "auto", minHeight: 0, padding: "0 9px 8px" }}>
        {loading ? <div style={{ padding: "14px 8px", color: "var(--text-muted)", fontSize: 11 }}>Loading followed traders…</div> : error ? <div style={{ padding: "14px 8px", color: "var(--text-muted)", fontSize: 11 }}>{error}</div> : callouts.length ? callouts.slice(0, 8).map((item, index) => {
          const mcapNow = item.type === "open" ? item.currentMcap : item.exitMcap;
          const pnl = item.type === "open" ? item.currentPnlPct : item.pnlPct;
          return <button key={`${item.traderId}-${item.mint}-${item.type}-${item.ts ?? index}`} type="button" onClick={() => onSelectMeme({ keyword: item.symbol || "TOKEN", score: pnl ?? 0, posts: 1, source: "following", contractAddress: item.mint, tokenImageUrl: item.imageUrl, mcap: mcapNow })} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 8px", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 6, background: "var(--surface)", color: "var(--text)", textAlign: "left", cursor: "pointer" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {item.avatarDataUrl ? <img src={item.avatarDataUrl} alt="" style={{ width: 26, height: 26, flex: "0 0 26px", borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ width: 26, height: 26, flex: "0 0 26px", display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--surface-raised)", color: "var(--orange-hot)", fontSize: 10, fontWeight: 800 }}>{item.traderName.slice(0, 1).toUpperCase()}</span>}
            <span style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{item.traderName} <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{item.type === "open" ? "opened" : "closed"} {item.symbol || "token"}</span></strong>
              <small style={{ display: "block", marginTop: 4, color: "var(--text-muted)", fontSize: 10 }}>Entry {marketCap(item.entryMcap)} · {item.type === "open" ? "Now" : "Exit"} {marketCap(mcapNow)}{typeof item.amountSol === "number" ? ` · ${item.amountSol.toFixed(3)} SOL` : ""} · {elapsed(item.ts)}</small>
            </span>
            {typeof pnl === "number" && <strong style={{ color: pnl >= 0 ? "var(--win)" : "var(--loss)", fontSize: 10, whiteSpace: "nowrap" }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%</strong>}
            <ArrowUpRight size={12} color="var(--text-dim)" />
          </button>;
        }) : <div style={{ padding: "8px 8px 14px", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>{error || "Follow traders to see their public entries, exits, and market caps here."}<Link href="/app/traders" style={{ display: "block", marginTop: 7, color: "var(--orange-hot)", fontWeight: 700, textDecoration: "none" }}>Find traders to follow →</Link></div>}
      </div>
    </section>
  );
}
