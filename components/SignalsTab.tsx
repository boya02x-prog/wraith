"use client";

// "Signals" tab on the token page: Wraith's call on THIS token + Wraith's overall, verifiable call record.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Share2 } from "lucide-react";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
type Win = { calls: number; hit15: number; hit2: number; hit5: number; hit10: number; rate2: number; rate15: number; medianPeak: number; best: number };
type Top = { address: string; chain: string; symbol: string; imageUrl: string | null; x: number; spottedMcap: number; peakMcap: number; spottedAt: number };
type Stats = { d1: Win; d7: Win; d30: Win; top: Top[] };
type Call = { spottedAt: number; spottedMcap: number; peakMcap: number; lastMcap: number; symbol: string; tier?: string; score?: number };

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const ago = (ms: number) => { const m = Math.max(1, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export default function SignalsTab({ mint, currentMcap }: { mint?: string; currentMcap?: number | null }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [call, setCall] = useState<Call | null | undefined>(undefined);
  const [win, setWin] = useState<"d1" | "d7" | "d30">("d7");

  useEffect(() => {
    let alive = true;
    fetch("/api/signal-stats").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setStats(d as Stats); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!mint) return;
    let alive = true;
    setCall(undefined);
    fetch(`/api/signal-calls?mint=${encodeURIComponent(mint)}`).then((r) => (r.ok ? r.json() : null))
      .then((d: { calls?: Call[] } | null) => { if (alive) setCall(d?.calls?.[0] ?? null); }).catch(() => { if (alive) setCall(null); });
    return () => { alive = false; };
  }, [mint]);

  const w = stats?.[win];
  const nowMc = currentMcap && currentMcap > 0 ? currentMcap : call?.lastMcap ?? 0;
  const mult = call && call.spottedMcap > 0 && nowMc > 0 ? nowMc / call.spottedMcap : null;
  const peakX = call && call.spottedMcap > 0 ? Math.max(call.peakMcap, call.lastMcap, nowMc) / call.spottedMcap : null;

  const share = () => {
    const link = typeof window !== "undefined" ? window.location.href : "";
    const text = call && peakX
      ? `Wraith spotted $${call.symbol} at ${usd(call.spottedMcap)} — peaked ${peakX.toFixed(2)}x. Wraith call record (7d): ${stats?.d7.calls ?? 0} calls, ${stats?.d7.rate2 ?? 0}% hit 2x.`
      : `Wraith call record (7d): ${stats?.d7.calls ?? 0} calls, ${stats?.d7.rate2 ?? 0}% hit 2x.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`, "_blank", "noopener,noreferrer");
  };

  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
      <div style={{ color: "var(--text-muted)", fontSize: 9, letterSpacing: ".06em" }}>{label}</div>
      <div style={{ color: "var(--text)", fontSize: 18, fontWeight: 800, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: 14, display: "grid", gap: 14, ...MONO }}>
      {/* this token */}
      <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${call ? "rgba(255,123,61,.45)" : "var(--border)"}`, background: call ? "rgba(255,123,61,.06)" : "var(--surface-2)" }}>
        {call === undefined ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Checking Wraith's record…</span>
          : call === null ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Wraith hasn't flagged this token. Calls are only logged when a token scores as a signal.</span>
          : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, justifyContent: "space-between" }}>
              <div>
                <div style={{ color: "var(--orange-hot)", fontSize: 10, letterSpacing: ".1em", fontWeight: 800 }}>WRAITH CALL · {ago(call.spottedAt)}</div>
                <div style={{ color: "var(--text)", fontSize: 13, marginTop: 6 }}>Spotted at <b>{usd(call.spottedMcap)}</b> → now <b>{nowMc ? usd(nowMc) : "—"}</b>{mult ? <b style={{ color: mult >= 1 ? "#37d58a" : "#e58d80" }}> · {mult.toFixed(2)}x</b> : null}</div>
                {peakX && <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 4 }}>Peak since call: {peakX.toFixed(2)}x ({usd(Math.max(call.peakMcap, call.lastMcap, nowMc))})</div>}
              </div>
              <button type="button" onClick={share} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 11, cursor: "pointer", ...MONO }}><Share2 size={13} /> Share</button>
            </div>
          )}
      </div>

      {/* overall record */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 10, letterSpacing: ".08em" }}>WRAITH CALL RECORD</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["d1", "d7", "d30"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setWin(k)} style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${win === k ? "rgba(255,123,61,.45)" : "transparent"}`, background: win === k ? "rgba(255,123,61,.1)" : "transparent", color: win === k ? "var(--orange-hot)" : "var(--text-muted)", fontSize: 10, cursor: "pointer", ...MONO }}>{k === "d1" ? "24H" : k === "d7" ? "7D" : "30D"}</button>
            ))}
          </div>
        </div>
        {!w ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Loading…</span> : w.calls === 0 ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>No calls in this window yet.</span> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
            {tile("CALLS", String(w.calls))}
            {tile("HIT 1.5x", `${w.rate15}%`, `${w.hit15} of ${w.calls}`)}
            {tile("HIT 2x", `${w.rate2}%`, `${w.hit2} of ${w.calls}`)}
            {tile("HIT 5x+", String(w.hit5), `10x+: ${w.hit10}`)}
            {tile("MEDIAN PEAK", `${w.medianPeak}x`)}
            {tile("BEST CALL", `${w.best}x`)}
          </div>
        )}
        <div style={{ color: "var(--text-dim)", fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>Measured from the market cap when Wraith flagged each token to its highest market cap since. Past calls don't predict future results. Not financial advice.</div>
      </div>

      {stats && stats.top.length > 0 && (
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: 10, letterSpacing: ".08em", marginBottom: 8 }}>BEST CALLS (30D)</div>
          <div style={{ display: "grid", gap: 6 }}>
            {stats.top.map((t) => (
              <Link key={t.address} href={`/app/token/${encodeURIComponent(t.address)}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 9, color: "var(--text)", textDecoration: "none", fontSize: 11 }}>
                <span><b>${t.symbol}</b> <span style={{ color: "var(--text-muted)" }}>{usd(t.spottedMcap)} → {usd(t.peakMcap)}</span></span>
                <b style={{ color: "#37d58a" }}>{t.x.toFixed(2)}x</b>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
