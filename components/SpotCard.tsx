"use client";

// Hover card shown on the Wraith marker: why it flagged the token, how the call is doing, and live risk read.

import { useEffect, useState } from "react";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
export type SpotInfo = {
  mint: string;
  spottedMcap: number;
  spottedAt: number;
  nowMcap: number | null;
  liquidity: number | null;
  vol24: number | null;
  buys: number;
  sells: number;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null } | null;
  ageText: string | null;
  safetyScore?: number;
  safetyBreakdown?: { label: string; pass: boolean; detail: string }[];
  reason?: string;
};
type CallRow = { score?: number; tier?: string; peakMcap?: number; lastMcap?: number };
type SigRow = { token: { address: string }; score: number; tier: string; tags: string[]; risks: string[] };

const cache = new Map<string, { ts: number; call: CallRow | null; sig: SigRow | null }>();
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const pct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);
const col = (n: number | null) => (n == null ? "var(--text-muted)" : n >= 0 ? "#37d58a" : "#e58d80");
const ago = (ms: number) => { const m = Math.max(1, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export default function SpotCard({ info }: { info: SpotInfo }) {
  const [data, setData] = useState<{ call: CallRow | null; sig: SigRow | null } | null>(() => {
    const h = cache.get(info.mint);
    return h && Date.now() - h.ts < 60_000 ? h : null;
  });
  useEffect(() => {
    if (data) return;
    let alive = true;
    Promise.all([
      fetch(`/api/signal-calls?mint=${encodeURIComponent(info.mint)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/signals").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([c, s]) => {
      const call = (c as { calls?: CallRow[] } | null)?.calls?.[0] ?? null;
      const sig = ((s as { signals?: SigRow[] } | null)?.signals ?? []).find((x) => x.token.address === info.mint) ?? null;
      cache.set(info.mint, { ts: Date.now(), call, sig });
      if (alive) setData({ call, sig });
    });
    return () => { alive = false; };
  }, [data, info.mint]);

  const now = info.nowMcap ?? data?.call?.lastMcap ?? 0;
  const mult = now > 0 && info.spottedMcap > 0 ? now / info.spottedMcap : null;
  const peak = Math.max(data?.call?.peakMcap ?? 0, now);
  const peakX = peak > 0 && info.spottedMcap > 0 ? peak / info.spottedMcap : null;
  const n = info.buys + info.sells;
  const buyShare = n > 0 ? (info.buys / n) * 100 : null;
  const liqPct = info.liquidity && now > 0 ? (info.liquidity / now) * 100 : null;
  const score = data?.sig?.score ?? data?.call?.score ?? null;
  const tier = data?.sig?.tier ?? data?.call?.tier ?? null;
  const failed = (info.safetyBreakdown ?? []).filter((b) => !b.pass);

  // plain verdict from live data; never a buy instruction
  let verdict = "Holding near the call price.";
  if (mult != null) {
    if (mult >= 2) verdict = `Up ${mult.toFixed(2)}x since the call. Late entries now carry far more risk than the original call did.`;
    else if (mult >= 1.15) verdict = "In profit since the call. Check whether buyers are still stepping in before chasing.";
    else if (mult >= 0.85) verdict = "Roughly flat since the call: the setup is intact but unconfirmed.";
    else if (mult >= 0.6) verdict = "Down since the call. The thesis has weakened: treat any entry as a new decision, not a continuation.";
    else verdict = "Down hard since the call. This call has failed so far. Wraith's signals are not guarantees.";
  }
  const rows: [string, string, string?][] = [
    ["Liquidity", info.liquidity ? usd(info.liquidity) : "—", liqPct != null ? `${liqPct.toFixed(1)}% of mcap${liqPct < 5 ? " · thin" : liqPct > 15 ? " · deep" : ""}` : undefined],
    ["24h volume", info.vol24 ? usd(info.vol24) : "—", info.vol24 && now > 0 ? `${(info.vol24 / now).toFixed(1)}x mcap` : undefined],
    ["Token age", info.ageText ?? "—"],
  ];

  return (
    <div role="tooltip" style={{ width: "min(316px, calc(100vw - 24px))", padding: 14, borderRadius: 14, background: "rgba(14,14,18,.97)", border: "1px solid rgba(255,123,61,.5)", boxShadow: "0 18px 50px rgba(0,0,0,.7), 0 0 24px rgba(255,123,61,.18)", color: "var(--text)", textAlign: "left", ...MONO }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "var(--orange-hot)", fontSize: 10, fontWeight: 800, letterSpacing: ".12em" }}>WRAITH SPOTTED THIS</div>
          <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>{ago(info.spottedAt)} @ {usd(info.spottedMcap)}</div>
        </div>
        {score != null && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: "var(--orange-hot)" }}>{Math.round(score)}</div>
            <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{tier ?? "SCORE"}</div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "12px 0 4px" }}>
        <span style={{ fontSize: 13 }}>{usd(info.spottedMcap)} → <b>{now ? usd(now) : "—"}</b></span>
        {mult != null && <b style={{ fontSize: 15, color: mult >= 1 ? "#37d58a" : "#e58d80" }}>{mult.toFixed(2)}x</b>}
      </div>
      {peakX != null && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Best since the call: {peakX.toFixed(2)}x ({usd(peak)})</div>}

      {data?.sig && (data.sig.tags.length > 0 || data.sig.risks.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: ".08em", marginBottom: 6 }}>WHY IT FLAGGED</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {data.sig.tags.slice(0, 6).map((t) => <span key={t} style={{ padding: "3px 7px", borderRadius: 6, background: "rgba(55,213,138,.1)", border: "1px solid rgba(55,213,138,.3)", color: "#55cf91", fontSize: 9 }}>{t}</span>)}
            {data.sig.risks.slice(0, 4).map((t) => <span key={t} style={{ padding: "3px 7px", borderRadius: 6, background: "rgba(229,141,128,.1)", border: "1px solid rgba(229,141,128,.3)", color: "#e58d80", fontSize: 9 }}>⚠ {t}</span>)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, display: "grid", gap: 5 }}>
        {rows.map(([k, v, sub]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span>{v}{sub && <span style={{ color: "var(--text-dim)" }}> · {sub}</span>}</span>
          </div>
        ))}
      </div>

      {buyShare != null && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>
            <span>BUYS {info.buys.toLocaleString()}</span><span>SELLS {info.sells.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", background: "#e5594a" }}>
            <div style={{ width: `${buyShare}%`, background: "#37d58a" }} />
          </div>
        </div>
      )}

      {info.change && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: 10 }}>
          {([["5m", info.change.m5], ["1h", info.change.h1], ["6h", info.change.h6], ["24h", info.change.h24]] as const).map(([k, v]) => (
            <div key={k} style={{ textAlign: "center", padding: "5px 0", borderRadius: 7, background: "var(--surface-2)" }}>
              <div style={{ fontSize: 8, color: "var(--text-muted)" }}>{k}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: col(v) }}>{pct(v)}</div>
            </div>
          ))}
        </div>
      )}

      {info.safetyScore != null && (
        <div style={{ marginTop: 10, fontSize: 10 }}>
          <span style={{ color: "var(--text-muted)" }}>Safety </span>
          <b style={{ color: info.safetyScore >= 70 ? "#37d58a" : info.safetyScore >= 40 ? "#ffba55" : "#e58d80" }}>{info.safetyScore}/100</b>
          {failed.length > 0 && <span style={{ color: "#e58d80" }}> · {failed.slice(0, 2).map((f) => f.label).join(", ")}</span>}
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 10, lineHeight: 1.55, color: "var(--text-muted)" }}>
        <b style={{ color: "var(--text)" }}>Read:</b> {verdict}{info.reason ? <span style={{ display: "block", marginTop: 5 }}>{info.reason}</span> : null}
        <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 9 }}>Wraith signals are heuristics, not guarantees or financial advice.</div>
      </div>
    </div>
  );
}
