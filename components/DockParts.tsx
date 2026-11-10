"use client";
// Shared pieces of the trade dock. Solana and every EVM chain render these same components,
// so the dock looks and reads identically on every chain.
import type { ReactNode } from "react";
import { ExternalLink, Globe, Send } from "lucide-react";

export const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
export const NO_CASH_NOTE = "Deposit cash first. Any USDC/USDG on any network works.";
export const FINE_PRINT = "Buys spend your stablecoin cash (USDC/USDT/USDG) from any network. Sells return stablecoin to your cash balance. Other tokens stay holdings; keep a little gas token on the network you pay from. Approve each transaction in your wallet.";
const GREEN = "#22c55e";
const RED = "#ef4444";

export function DockFrame({ children }: { children: ReactNode }) {
  return (
    <aside style={{ height: "100%", minHeight: 0, overflowY: "auto", background: "var(--bg)", color: "var(--text)", borderLeft: "1px solid var(--border)", ...MONO }}>
      {children}
    </aside>
  );
}

export function PositionBlock({ symbol, valueText, amountText, onRefresh }: { symbol: string; valueText: string | null; amountText: string | null; onRefresh: () => void }) {
  return (
    <div style={{ padding: "15px 16px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Your position</strong>
        <button type="button" onClick={onRefresh} title="Refresh token balance" style={{ border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>Refresh</button>
      </div>
      {amountText ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "12px", borderRadius: 9, background: "var(--surface)", color: "var(--text)", fontSize: 12 }}>
          <strong style={{ color: "var(--text)", fontSize: 18 }}>{valueText ?? "Price updating…"}</strong>
          <span>{amountText} {symbol}</span>
        </div>
      ) : (
        <div style={{ padding: "18px 10px", borderRadius: 9, background: "var(--surface)", textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>No {symbol} in this wallet yet</div>
      )}
    </div>
  );
}

export interface AboutProps {
  symbol: string;
  description?: string | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  buys: number | null;
  sells: number | null;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
}

const linkStyle = { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", fontSize: 10, textDecoration: "none" } as const;

export function AboutBlock(p: AboutProps) {
  const total = (p.buys ?? 0) + (p.sells ?? 0);
  const buyPct = total > 0 ? ((p.buys ?? 0) / total) * 100 : 50;
  return (
    <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)" }}>
      <strong style={{ display: "block", marginBottom: 10, fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>About {p.symbol}</strong>
      {p.description && (
        <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.65 }}>
          {p.description.length > 280 ? p.description.slice(0, 280) + "…" : p.description}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 12 }}>
        {([["5m", p.change.m5], ["1h", p.change.h1], ["6h", p.change.h6], ["24h", p.change.h24]] as [string, number | null][]).map(([label, v]) => (
          <div key={label} style={{ padding: "7px 4px", borderRadius: 8, background: "var(--surface)", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: v === null ? "var(--text-dim)" : v >= 0 ? GREEN : RED }}>{v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}</div>
          </div>
        ))}
      </div>
      {p.buys !== null && p.sells !== null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 5 }}>
            <span style={{ color: GREEN }}>B {(p.buys ?? 0).toLocaleString()}</span>
            <span style={{ color: "var(--text-dim)", fontSize: 9 }}>24h txns</span>
            <span style={{ color: RED }}>S {(p.sells ?? 0).toLocaleString()}</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: RED, overflow: "hidden" }}>
            <div style={{ width: `${buyPct}%`, height: "100%", background: GREEN }} />
          </div>
        </div>
      )}
      {(p.website || p.twitter || p.telegram) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" style={linkStyle}><Globe size={10} /> Website</a>}
          {p.twitter && <a href={p.twitter} target="_blank" rel="noopener noreferrer" style={linkStyle}><ExternalLink size={10} /> Twitter</a>}
          {p.telegram && <a href={p.telegram} target="_blank" rel="noopener noreferrer" style={linkStyle}><Send size={10} /> Telegram</a>}
        </div>
      )}
    </div>
  );
}
