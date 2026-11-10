"use client";

// components/WinsBoard.tsx
// How Wraith's calls performed: every token the signal feed (or the old scanner)
// flagged, with its market cap when spotted, now, and at its peak.

import { swrRead, swrWrite } from "@/lib/swrCache";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy, Trash2 } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { fmtUsd } from "@/lib/market";
import { toMeme } from "@/lib/tokenMeme";
import { TokenIcon } from "@/components/TokenIcon";
import ChainLogo from "@/components/ChainLogo";
import { CHAINS } from "@/lib/chains";
import { applyPrices, clearCalls, readCalls, type LoggedCall } from "@/lib/signalLog";

type Filter = "all" | "wins" | "2x" | "down";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All calls" },
  { key: "wins", label: "In profit" },
  { key: "2x", label: "2x+" },
  { key: "down", label: "Down" },
];

const mult = (c: LoggedCall) => (c.spottedMcap > 0 ? c.lastMcap / c.spottedMcap : 1);
const peakMult = (c: LoggedCall) => (c.spottedMcap > 0 ? Math.max(c.peakMcap, c.lastMcap) / c.spottedMcap : 1);

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function WinsBoard({ onSelectMeme }: { onSelectMeme: (meme: MemeTrend) => void }) {
  const [calls, setCalls] = useState<LoggedCall[]>(() => swrRead<LoggedCall[]>("wins:calls") ?? []);
  const [filter, setFilter] = useState<Filter>("all");
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    // 1) Shared server record: identical for every user, refreshed server-side.
    let server: LoggedCall[] = [];
    try {
      const res = await fetch("/api/signal-calls", { cache: "no-store" });
      if (res.ok) {
        const data: { calls?: Omit<LoggedCall, "source">[] } = await res.json();
        server = (data.calls ?? []).map((c) => ({ ...c, source: "signal" as const }));
      }
    } catch {
      /* fall back to what we have */
    }
    // 2) Anything the old scanner tracked in this browser that the server does not know about.
    const serverSet = new Set(server.map((c) => c.address));
    const local = readCalls().filter((c) => !serverSet.has(c.address));
    const merged = [...server, ...local].sort((a, b) => b.spottedAt - a.spottedAt);
    setCalls(merged);
    if (server.length) swrWrite("wins:calls", merged.slice(0, 120));
    const mints = local.slice(0, 30).map((c) => c.address);
    if (!mints.length) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/signal-prices?mints=${mints.join(",")}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: { prices?: Record<string, { mcap: number }> } = await res.json();
      if (data.prices) {
        applyPrices(data.prices);
        const refreshed = readCalls().filter((c) => !serverSet.has(c.address)).map((c) => {
          const p = data.prices?.[c.address];
          return p && p.mcap > 0 ? { ...c, lastMcap: p.mcap, peakMcap: Math.max(c.peakMcap, p.mcap) } : c;
        });
        setCalls([...server, ...refreshed].sort((a, b) => b.spottedAt - a.spottedAt));
      }
    } catch {
      /* keep stored values */
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, 8_000);
    return () => clearInterval(t);
  }, [refresh]);

  const stats = useMemo(() => {
    const n = calls.length;
    const up = calls.filter((c) => mult(c) >= 1.05).length;
    const twoX = calls.filter((c) => peakMult(c) >= 2).length;
    const best = calls.reduce<LoggedCall | null>((b, c) => (!b || peakMult(c) > peakMult(b) ? c : b), null);
    const avg = n ? calls.reduce((s, c) => s + mult(c), 0) / n : 0;
    return { n, up, twoX, best, avg, winRate: n ? Math.round((up / n) * 100) : 0 };
  }, [calls]);

  const shown = useMemo(() => {
    const list = calls.filter((c) => {
      if (filter === "wins") return mult(c) >= 1.05;
      if (filter === "2x") return peakMult(c) >= 2;
      if (filter === "down") return mult(c) < 0.95;
      return true;
    });
    return [...list].sort((a, b) => peakMult(b) - peakMult(a));
  }, [calls, filter]);

  const open = (c: LoggedCall) =>
    onSelectMeme({
      keyword: c.symbol,
      score: 0,
      posts: 0,
      source: c.chain && c.chain !== "solana" ? c.chain : "wins",
      contractAddress: c.address,
      tokenImageUrl: c.imageUrl,
      mcap: c.lastMcap || undefined,
    });

  return (
    <section className="wb">
      <header className="wb-head">
        <div>
          <h2><Trophy size={16} /> Win tracker</h2>
          <p>Every token Wraith flagged, tracked from the moment it was spotted. Prices refresh every few seconds.{checking ? " Updating…" : ""}</p>
        </div>
        <div className="wb-head-actions">
          <div className="wx-seg" role="tablist" aria-label="Filter calls">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          {calls.some((c) => c.source === "scanner") && (
            <button type="button" className="wx-icon-btn" title="Remove old scanner calls saved in this browser" aria-label="Clear old scanner calls" onClick={() => { if (window.confirm("Remove the old scanner calls saved in this browser?")) { clearCalls(); try { localStorage.removeItem("wraith_token_history_v2"); } catch { /* ignore */ } void refresh(); } }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <div className="wb-stats">
        <div><small>Tracked</small><b>{stats.n}</b></div>
        <div><small>In profit</small><b className="up">{stats.up}<i> · {stats.winRate}%</i></b></div>
        <div><small>Hit 2x+</small><b className="up">{stats.twoX}</b></div>
        <div><small>Best call</small><b className="up">{stats.best ? `${peakMult(stats.best).toFixed(2)}x` : "—"}<i> {stats.best?.symbol ?? ""}</i></b></div>
        <div><small>Avg multiple</small><b className={stats.avg >= 1 ? "up" : "down"}>{stats.n ? `${stats.avg.toFixed(2)}x` : "—"}</b></div>
      </div>

      {shown.length === 0 ? (
        <div className="wx-empty">
          <strong>{calls.length ? "No calls match this filter" : "No calls tracked yet"}</strong>
          <span>{calls.length ? "Try another filter." : "Open the Scanner. Strong signals are saved here automatically and tracked from that moment."}</span>
        </div>
      ) : (
        <div className="wb-grid">
          {shown.map((c) => {
            const m = mult(c);
            const pk = peakMult(c);
            const up = m >= 1;
            const barPct = Math.min(100, Math.max(4, (m / Math.max(pk, 1)) * 100));
            return (
              <div key={c.address} className={`wb-card${up ? " up" : " down"}`} role="link" tabIndex={0} onClick={() => open(c)} onKeyDown={(e) => { if (e.key === "Enter") open(c); }}>
                <div className="wb-card-top">
                  <TokenIcon contractAddress={c.address} imageUrl={c.imageUrl} symbol={c.symbol} size={42} />
                  <div className="wb-id">
                    <strong>{c.symbol}</strong>
                    <span><ChainLogo chain={c.chain ?? "solana"} size={13} /> {c.chain && c.chain !== "solana" ? CHAINS[c.chain]?.name ?? c.chain : "Solana"} · {ago(c.spottedAt)}</span>
                  </div>
                  <div className={`wb-mult ${up ? "up" : "down"}`}>{m.toFixed(2)}x</div>
                </div>
                <div className="wb-track" aria-hidden="true"><i style={{ width: `${barPct}%` }} /></div>
                <div className="wb-row">
                  <div><small>Spotted</small><b>{fmtUsd(c.spottedMcap)}</b></div>
                  <div><small>Now</small><b>{fmtUsd(c.lastMcap)}</b></div>
                  <div><small>Peak</small><b>{fmtUsd(Math.max(c.peakMcap, c.lastMcap))} <i>{pk.toFixed(2)}x</i></b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
