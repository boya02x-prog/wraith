"use client";
// Swaps / Holders / Analysis / Traders Intel for EVM tokens (same layout as the Solana TokenDetailTabs).
import { useEffect, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { ExternalLink } from "lucide-react";
import { C } from "@/lib/theme";
import { TokenCallouts } from "@/components/TokenCallouts";
import { chainOf } from "@/lib/chains";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
const TABS = ["Swaps", "Holders", "Analysis", "Traders Intel"] as const;
type Tab = (typeof TABS)[number];

export interface EvmTrade { id: string; ts: number; side: "buy" | "sell"; usd: number; tokens?: number; mcap?: number | null; wallet: string; tx: string }
export interface EvmSnapLite {
  chain: string; symbol: string; liquidity: number; marketCap: number | null; fdv: number | null; createdAt: number | null;
  volume: { h1: number; h24: number }; txns: { h24: { buys: number; sells: number } };
  change: { h1: number | null; h24: number | null }; pairAddress: string; websites: string[]; socials: { type: string; url: string }[];
}

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}b` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}m` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(2)}`);
const ago = (ts: number) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

interface HoldersRes { supported: boolean; holders: { wallet: string; quantity: number; share: number }[]; count: number | null }

export default function EvmDetailTabs({ address, snap, trades, onHolderCount }: { address: string; snap: EvmSnapLite; trades: EvmTrade[]; onHolderCount?: (n: number | null) => void }) {
  const [tab, setTab] = useState<Tab>("Swaps");
  const [h, setH] = useState<HoldersRes | null>(null);
  const chain = chainOf(snap.chain);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/evm-holders?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(snap.chain)}`, { cache: "no-store" });
        const d: HoldersRes = await r.json();
        if (alive) { setH(d); onHolderCount?.(d.count ?? null); }
      } catch { /* keep */ }
    };
    void load();
    const t = visibleInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [address, snap.chain]); // eslint-disable-line react-hooks/exhaustive-deps

  const mc = snap.marketCap ?? snap.fdv ?? 0;
  const buys = snap.txns.h24.buys, sells = snap.txns.h24.sells;
  const buyShare = buys + sells > 0 ? (buys / (buys + sells)) * 100 : 50;
  const ageMin = snap.createdAt ? (Date.now() - snap.createdAt) / 60_000 : null;
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: snap.liquidity >= 10_000, label: "Liquidity", detail: `${usd(snap.liquidity)} in the pool${snap.liquidity < 10_000 ? ". Big buys will move the price." : "."}` },
    { ok: mc > 0 && snap.liquidity / mc >= 0.05, label: "Liquidity vs market cap", detail: mc > 0 ? `${((snap.liquidity / mc) * 100).toFixed(1)}% of market cap is liquid. Under 5% is thin.` : "No market cap yet." },
    { ok: buys + sells < 20 || buyShare >= 40, label: "Buy / sell balance", detail: `${buyShare.toFixed(0)}% of 24h trades were buys (${buys.toLocaleString()} buys, ${sells.toLocaleString()} sells).` },
    { ok: ageMin === null || ageMin >= 60, label: "Pool age", detail: ageMin === null ? "Unknown." : ageMin < 60 ? `Launched ${Math.max(1, Math.round(ageMin))} min ago. Very early.` : "Pool is more than an hour old." },
    { ok: snap.volume.h24 >= 5_000, label: "Volume", detail: `${usd(snap.volume.h24)} traded in 24h.` },
    { ok: snap.websites.length + snap.socials.length > 0, label: "Socials linked", detail: snap.websites.length + snap.socials.length > 0 ? "Website or socials are listed." : "No website or socials. Do your own research." },
  ];
  const head = (cols: string[]) => <thead><tr style={{ color: C.muted, textAlign: "left" }}>{cols.map((x) => <th key={x} style={{ padding: "10px 12px", fontWeight: 500 }}>{x}</th>)}</tr></thead>;
  const pad = { padding: "10px 12px" } as const;
  const empty = (a: string, b: string) => <div style={{ minHeight: 178, display: "grid", placeContent: "center", gap: 7, padding: 20, color: C.muted, textAlign: "center" }}><strong style={{ color: C.primary, fontSize: 13 }}>{a}</strong><span style={{ fontSize: 11 }}>{b}</span></div>;

  return (
    <section style={{ overflow: "hidden", border: `1px solid ${C.border}`, borderRadius: 10, background: "var(--surface)", ...MONO }}>
      <nav aria-label="Token activity" style={{ display: "flex", gap: 5, padding: "8px 10px", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
        {TABS.map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} aria-pressed={tab === item} style={{ padding: "7px 12px", border: `1px solid ${tab === item ? "rgba(var(--accent-rgb),.32)" : "transparent"}`, borderRadius: 8, background: tab === item ? "rgba(var(--accent-rgb),.10)" : "transparent", color: tab === item ? "var(--accent-text)" : C.muted, fontSize: 11, fontWeight: tab === item ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap" }}>
            {item}{item === "Holders" && h?.count ? ` (${h.count.toLocaleString()})` : ""}
          </button>
        ))}
      </nav>
      <div style={{ minHeight: 178 }}>
        {tab === "Swaps" ? (
          trades.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                {head(["Age", "Type", "Amount", "Tokens", "MCap", "Trader"])}
                <tbody>{trades.slice(0, 40).map((t) => (
                  <tr key={t.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...pad, color: C.dim }}>{ago(t.ts)}</td>
                    <td style={{ ...pad, color: t.side === "buy" ? C.green : C.red }}>{t.side === "buy" ? "Buy" : "Sell"}</td>
                    <td style={{ ...pad, color: t.side === "buy" ? C.green : C.red }}>{usd(t.usd)}</td>
                    <td style={{ ...pad, color: C.primary }}>{t.tokens ? Math.round(t.tokens).toLocaleString() : "—"}</td>
                    <td style={{ ...pad, color: C.primary }}>{t.mcap ? usd(t.mcap) : "—"}</td>
                    <td style={{ ...pad, color: C.muted }}>{chain ? <a href={`${chain.explorer}/tx/${t.tx}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{short(t.wallet)}</a> : short(t.wallet)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : empty("Waiting for swaps", "Trades appear here as soon as the first swaps are indexed.")
        ) : tab === "Holders" ? (
          h === null ? empty("Loading holders…", "") :
          !h.supported ? empty("Holder list unavailable on this chain", `${chain?.name ?? "This chain"} doesn't have a public holder index yet. Swaps and analysis still work.`) :
          h.holders.length ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 14px 0", color: C.muted, fontSize: 10 }}>
                <span>Total holders on {chain?.name}</span><strong style={{ color: C.primary }}>{h.count?.toLocaleString() ?? "Unavailable"}</strong>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  {head(["#", "Wallet", "Tokens", "Supply"])}
                  <tbody>{h.holders.map((x, i) => (
                    <tr key={x.wallet} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ ...pad, color: C.dim, width: 46 }}>{i + 1}</td>
                      <td style={{ ...pad, color: C.primary }}>{chain ? <a href={`${chain.explorer}/address/${x.wallet}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{short(x.wallet)}</a> : short(x.wallet)}</td>
                      <td style={{ ...pad, color: C.primary }}>{x.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td style={{ ...pad, color: C.muted }}>{x.share.toFixed(2)}%</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>
          ) : empty("No holder data yet", "The explorer hasn't indexed this token's holders.")
        ) : tab === "Analysis" ? (
          <div style={{ padding: "10px 14px", display: "grid", gap: 8 }}>
            {checks.map((c) => (
              <div key={c.label} style={{ display: "flex", gap: 10, padding: "10px 11px", border: `1px solid ${C.border}`, borderRadius: 8, background: "var(--surface-2)", fontSize: 11 }}>
                <b style={{ color: c.ok ? C.green : C.red }}>{c.ok ? "✓" : "✕"}</b>
                <span><strong style={{ color: C.primary }}>{c.label}.</strong> <span style={{ color: C.muted }}>{c.detail}</span></span>
              </div>
            ))}
            {chain && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["Explorer", `${chain.explorer}/token/${address}`], ["DexScreener", `https://dexscreener.com/${snap.chain}/${snap.pairAddress}`], ["GeckoTerminal", `https://www.geckoterminal.com/${chain.gecko}/pools/${snap.pairAddress}`]].map(([l, u]) => (
                  <a key={l} href={u} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 10, textDecoration: "none" }}>{l} <ExternalLink size={10} /></a>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <TokenCallouts mint={address.toLowerCase()} currentMcap={mc || null} />
          </div>
        )}
      </div>
    </section>
  );
}
