"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Trophy } from "lucide-react";
import TraderFollowButton from "@/components/TraderFollowButton";

type Trader = {
  userId: string;
  displayName: string;
  xHandle: string;
  avatarDataUrl: string;
  closedTradeCount: number;
  openPositionCount: number;
  profitSol: number;
};

export default function TokenSidebarLeaderboard() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/traders", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Leaderboard unavailable.");
      setTraders(Array.isArray(result.traders) ? result.traders.slice(0, 10) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Leaderboard unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section style={{ height: "100%", overflowY: "auto", color: "var(--text)" }}>
      <header style={{ padding: "15px 14px 13px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Trophy size={15} color="var(--orange-hot)" /><strong style={{ fontSize: 14 }}>Leaderboard</strong><button type="button" onClick={() => void refresh()} aria-label="Refresh leaderboard" style={{ width: 28, height: 28, display: "grid", placeItems: "center", marginLeft: "auto", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 8, background: "transparent", cursor: "pointer" }}><RefreshCw size={13} /></button></div>
        <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>Top public Wraith traders by realized P&amp;L. Follow a profile to see it in your feed.</p>
      </header>
      {loading ? <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 12 }}>Loading verified public results…</div> : error ? <div style={{ padding: 18, color: "var(--text-muted)", fontSize: 12 }}>{error}<button type="button" onClick={() => void refresh()} style={{ marginLeft: 8, color: "var(--orange-hot)", border: 0, background: "transparent", cursor: "pointer" }}>Retry</button></div> : traders.length ? traders.map((trader, index) => (
        <div key={trader.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 10px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ width: 18, color: "var(--text-dim)", textAlign: "center", fontSize: 10 }}>{String(index + 1).padStart(2, "0")}</span>
          <Link href={`/app/u/${encodeURIComponent(trader.userId)}`} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, color: "inherit", textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {trader.avatarDataUrl ? <img src={trader.avatarDataUrl} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--surface-raised)", color: "var(--orange-hot)", fontWeight: 800 }}>{trader.displayName.slice(0, 1).toUpperCase()}</span>}
            <span style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{trader.displayName}</strong><small style={{ color: "var(--text-muted)", fontSize: 9 }}>{trader.closedTradeCount} closes · {trader.openPositionCount} open</small></span>
          </Link>
          <span style={{ width: 63, color: trader.profitSol >= 0 ? "var(--win)" : "var(--loss)", textAlign: "right", fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{trader.profitSol >= 0 ? "+" : ""}{trader.profitSol.toFixed(2)} SOL</span>
          <TraderFollowButton traderId={trader.userId} compact />
        </div>
      )) : <div style={{ padding: "24px 16px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.65 }}><strong style={{ display: "block", marginBottom: 6, color: "var(--text)" }}>No public rankings yet</strong>Rankings use realized results from traders who chose to share their activity. They’ll appear here as public trade history becomes available.<Link href="/app/traders" style={{ display: "block", marginTop: 12, color: "var(--orange-hot)", fontWeight: 700, textDecoration: "none" }}>Browse the trader directory →</Link></div>}
    </section>
  );
}
