"use client";

// components/EvmTokenView.tsx
// View-only token page for non-Solana (EVM) tokens: live stats, chart, recent swaps.
// Trading on these chains is handled separately (cross-chain buy from the unified cash balance).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, Check, Copy, ExternalLink, Flame, Globe, Link2, Search, Send, Star } from "lucide-react";
import { usePresence } from "@/lib/usePresence";
import SheetBoundary from "@/components/SheetBoundary";
import TokenChart from "@/components/TokenChart";
import DexLogo from "@/components/DexLogo";
import ChainLogo from "@/components/ChainLogo";
import EvmBuyPanel from "@/components/EvmBuyPanel";
import EvmDetailTabs from "@/components/EvmDetailTabs";
import { AboutBlock, DockFrame } from "@/components/DockParts";
import { TokenIcon } from "@/components/TokenIcon";
import { readTokenFavorites, toggleTokenFavorite, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";
import { chainOf, type ChainInfo } from "@/lib/chains";
import { changeColor, fmtAge, fmtCount, fmtPct, fmtPrice, fmtUsd, shortAddr } from "@/lib/market";

interface Snap {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number;
  marketCap: number | null;
  fdv: number | null;
  supply: number | null;
  liquidity: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: { h1: { buys: number; sells: number }; h24: { buys: number; sells: number } };
  pairAddress: string;
  dex: string | null;
  quoteSymbol: string | null;
  createdAt: number | null;
  websites: string[];
  socials: { type: string; url: string }[];
}
interface Trade { id: string; ts: number; side: "buy" | "sell"; usd: number; tokens?: number; mcap?: number | null; wallet: string; tx: string }

function ChainBadge({ chain }: { chain: ChainInfo }) {
  // the network as its logo only (the name is the tooltip), plain and in the theme
  return <span className="wx-net-logo" title={chain.name}><ChainLogo chain={chain.key} size={20} /></span>;
}

export default function EvmTokenView({ address, sidebar, mobile = false }: { address: string; sidebar?: ReactNode; mobile?: boolean }) {
  const router = useRouter();
  // history.back() does nothing when this page was the first one opened (a shared link, a new tab): fall back to the app home
  const goBack = () => {
    const before = window.location.href;
    if (window.history.length > 1) router.back();
    window.setTimeout(() => { if (window.location.href === before) router.push("/app"); }, 400);
  };
  const [chainParam, setChainParam] = useState<string | null | undefined>(undefined);
  // phone layout (the same as a Solana token): the bottom bar (Market / Search / Buy / Sell) and the Buy / Sell sheet
  const [mTab, setMTab] = useState<"chart" | "market">("chart");
  const [sheet, setSheet] = useState<null | "buy" | "sell">(null);
  const lastSheet = useRef<"buy" | "sell">("buy"); // kept while the sheet slides away
  if (sheet) lastSheet.current = sheet;
  const shownSheet = sheet ?? lastSheet.current;
  const sheetPres = usePresence(!!sheet, 210);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [copied, setCopied] = useState<"ca" | "link" | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(readTokenFavorites().some((f) => f.contractAddress === address));
    sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(TOKEN_FAVORITES_EVENT, sync); window.removeEventListener("storage", sync); };
  }, [address]);
  const [holderCount, setHolderCount] = useState<number | null>(null);
  const [spotted, setSpotted] = useState<{ spottedMcap: number; spottedAt: number } | null>(null);

  // was this token flagged by the Wraith scanner? (shared server record, same as Solana)
  useEffect(() => {
    setSpotted(null);
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch(`/api/signal-calls?mint=${encodeURIComponent(address)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data: { calls?: { spottedMcap: number; spottedAt: number }[] } = await res.json();
        const c = data.calls?.[0];
        if (alive && c && c.spottedMcap > 0) setSpotted({ spottedMcap: c.spottedMcap, spottedAt: c.spottedAt });
      } catch { /* optional */ }
    };
    void run();
    return () => { alive = false; };
  }, [address]);

  useEffect(() => {
    try {
      setChainParam(new URLSearchParams(window.location.search).get("chain"));
    } catch {
      setChainParam(null);
    }
  }, []);

  const chainQ = snap?.chain ?? chainParam ?? "";

  useEffect(() => {
    if (chainParam === undefined) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`/api/evm-token?address=${encodeURIComponent(address)}${chainParam ? `&chain=${encodeURIComponent(chainParam)}` : ""}`, { cache: "no-store" });
        if (!alive) return;
        if (res.status === 404) setState((s) => (s === "ready" ? s : "missing"));
        else if (!res.ok) setState((s) => (s === "ready" ? s : "error"));
        else {
          setSnap((await res.json()) as Snap);
          setState("ready");
        }
      } catch {
        if (alive) setState((s) => (s === "ready" ? s : "error"));
      }
      if (alive) timer = setTimeout(load, document.hidden ? 30_000 : 4_000);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [address, chainParam]);

  useEffect(() => {
    if (!snap) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`/api/evm-trades?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(snap.chain)}`, { cache: "no-store" });
        if (res.ok && alive) {
          const d: { trades?: Trade[] } = await res.json();
          if (Array.isArray(d.trades)) setTrades(d.trades);
        }
      } catch {
        /* keep last list */
      }
      if (alive) timer = setTimeout(load, document.hidden ? 60_000 : 12_000);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [address, snap?.chain]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = useCallback((what: "ca" | "link") => {
    try {
      void navigator.clipboard.writeText(what === "ca" ? address : window.location.href);
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard blocked */
    }
  }, [address]);

  const chain = chainOf(snap?.chain ?? chainParam);

  if (state === "loading" || chainParam === undefined) {
    return (
      <div className="wx-workspace">
        <div className="wx-center"><div className="wx-panel"><div className="wx-skel" style={{ height: 64, borderRadius: 14 }} /><div className="wx-skel" style={{ height: 380, borderRadius: 16 }} /></div></div>
      </div>
    );
  }
  if (!snap || !chain) {
    return (
      <div className="wx-empty" style={{ flex: 1 }}>
        <strong>{state === "missing" ? "No market found for this token" : "Couldn’t load this token"}</strong>
        <span>{state === "missing" ? "It may be brand new, on an unsupported chain, or not indexed yet." : "The data provider didn’t respond. Try again in a moment."}</span>
      </div>
    );
  }

  const mc = snap.marketCap ?? snap.fdv;
  const tx24 = snap.txns.h24.buys + snap.txns.h24.sells;
  const social = (t: string) => snap.socials.find((s) => s.type === t)?.url;
  const site = snap.websites[0];
  const tw = social("twitter");
  const tg = social("telegram");
  const dexUrl = `https://dexscreener.com/${snap.chain}/${snap.pairAddress}`;

  const stats = (
    <div className="wx-about-slot">
      <div className="wx-stats">
        <div className="wx-stat"><span>Liquidity</span><b>{fmtUsd(snap.liquidity)}</b></div>
        <div className="wx-stat"><span>Volume 24h</span><b>{fmtUsd(snap.volume.h24)}</b><small>1h {fmtUsd(snap.volume.h1)}</small></div>
        <div className="wx-stat"><span>Holders</span><b>{holderCount != null ? fmtCount(holderCount) : "—"}</b></div>
        <div className="wx-stat"><span>Txns 24h</span><b>{fmtCount(tx24)}</b><small>{fmtCount(snap.txns.h24.buys)} buys · {fmtCount(snap.txns.h24.sells)} sells</small></div>
        <div className="wx-stat"><span>Age</span><b>{fmtAge(snap.createdAt)}</b></div>
        <div className="wx-stat"><span>Price</span><b>{fmtPrice(snap.priceUsd)}</b></div>
      </div>
    </div>
  );

  const panel = (
        <div className="wx-panel">
          <header className="wx-token-head">
            <button type="button" className="wx-back-btn" aria-label="Back" onClick={goBack}><ArrowLeft size={18} /></button>
            <div className="wx-token-id">
              <TokenIcon contractAddress={address} imageUrl={snap.imageUrl ?? undefined} symbol={snap.symbol} size={48} />
              <div style={{ minWidth: 0 }}>
                <div className="wx-token-name">
                  <h1>{snap.symbol}</h1>
                  <ChainBadge chain={chain} />
                  <DexLogo dex={snap.dex} />
                </div>
                <div className="wx-token-sub">
                  <span>{snap.name}</span>
                  <button type="button" className="wx-ca" onClick={() => copy("ca")} title="Copy contract address">
                    {shortAddr(address, 5, 5)} {copied === "ca" ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="wx-token-actions">
              {site && <a href={site} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="Website" title="Website"><Globe size={14} /></a>}
              {tw && <a href={tw} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="X / Twitter" title="X / Twitter"><span style={{ fontWeight: 800, fontSize: 12 }}>𝕏</span></a>}
              {tg && <a href={tg} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="Telegram" title="Telegram"><Send size={14} /></a>}
              <a href={`${chain.explorer}/token/${address}`} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="Block explorer" title="Block explorer"><ExternalLink size={14} /></a>
              <button
                type="button"
                className={`wx-icon-btn wx-save${saved ? " active" : ""}`}
                aria-pressed={saved}
                aria-label={saved ? "Remove from saved" : "Save token"}
                title={saved ? "Saved" : "Save token"}
                onClick={() => toggleTokenFavorite({ keyword: snap.symbol, score: 0, posts: 0, source: chain.key, contractAddress: address, tokenImageUrl: snap.imageUrl ?? undefined, mcap: snap.marketCap ?? undefined })}
              >
                <Star size={14} fill={saved ? "currentColor" : "none"} />
              </button>
              <button type="button" className="wx-icon-btn" onClick={() => copy("link")} aria-label="Copy page link" title="Copy link">{copied === "link" ? <Check size={14} /> : <Link2 size={14} />}</button>
            </div>
          </header>

          <div className="wx-pricebar">
            <div>
              <div className="wx-kicker">{snap.marketCap ? "Market cap" : "FDV"}<span title="Live" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#22c55e", marginLeft: 8, verticalAlign: "middle", boxShadow: "0 0 6px #22c55e" }} /></div>
              <div className="wx-mcap">{fmtUsd(mc, { decimals: 2 })}</div>
            </div>
            <div className="wx-changes">
              {([["5m", snap.change.m5], ["1h", snap.change.h1], ["6h", snap.change.h6], ["24h", snap.change.h24]] as const).map(([label, v]) => (
                <div key={label} className="wx-change"><span>{label}</span><b style={{ color: changeColor(v) }}>{fmtPct(v)}</b></div>
              ))}
            </div>
          </div>

          {spotted && mc != null && spotted.spottedMcap > 0 && (
            <div className="wb-spot" title="Market cap when Wraith first flagged this token">
              Spotted at <b>{fmtUsd(spotted.spottedMcap)}</b>
              <i>now {fmtUsd(mc)} · {(mc / spotted.spottedMcap).toFixed(2)}x</i>
            </div>
          )}

          <section className="wx-chart-card" aria-label="Price chart">
            <TokenChart mint={address} chain={snap.chain} livePrice={snap.priceUsd} supply={snap.supply} spottedMcap={spotted?.spottedMcap ?? null} spottedAt={spotted?.spottedAt ?? null} />
          </section>

          <EvmDetailTabs address={address} snap={snap} trades={trades} onHolderCount={setHolderCount} />
          {mobile && stats}
        </div>
  );

  if (mobile) {
    return (
      <>
        <div className="wx-mobile-body">
          <div style={{ display: mTab === "market" ? "none" : "block", height: "100%" }}>{panel}</div>
          <div style={{ display: mTab === "market" ? "flex" : "none", height: "100%", flexDirection: "column" }}>{sidebar}</div>
        </div>
        <div className="wx-mbar" role="toolbar" aria-label="Trade">
          <button type="button" className="wx-mbar-nav" onClick={() => setMTab(mTab === "market" ? "chart" : "market")}>
            {mTab === "market" ? <Activity size={18} /> : <Flame size={18} />}
            <span>{mTab === "market" ? "Chart" : "Market"}</span>
          </button>
          <button type="button" className="wx-mbar-nav wx-mbar-search" aria-label="Search tokens and traders" onClick={() => window.dispatchEvent(new CustomEvent("wraith:open-search"))}>
            <Search size={18} />
            <span>Search</span>
          </button>
          <button type="button" className="wx-mbar-buy" onClick={() => setSheet("buy")}>Buy</button>
          <button type="button" className="wx-mbar-sell" onClick={() => setSheet("sell")}>Sell</button>
        </div>
        {sheetPres.mounted && (
          <div className={`wx-sheet-back${sheetPres.out ? " out" : ""}`} onClick={() => setSheet(null)}>
            <div className={`wx-sheet${sheetPres.out ? " out" : ""}`} role="dialog" aria-label={shownSheet === "buy" ? "Buy" : "Sell"} onClick={(e) => e.stopPropagation()}>
              <div className="wx-sheet-grab" aria-hidden="true" />
              <button type="button" className="wx-sheet-x" onClick={() => setSheet(null)} aria-label="Close">×</button>
              <SheetBoundary label={shownSheet === "buy" ? "Buy" : "Sell"}>
                <DockFrame>
                  <EvmBuyPanel key={shownSheet} initialMode={shownSheet} chainKey={chain.key} tokenAddress={address} symbol={snap.symbol} priceUsd={snap.priceUsd} mcap={snap.marketCap ?? snap.fdv} imageUrl={snap.imageUrl} />
                </DockFrame>
              </SheetBoundary>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="wx-workspace">
      {sidebar && <aside className="wx-sidebar">{sidebar}</aside>}
      <div className="wx-center">
        {panel}
      </div>

      <aside className="wx-dock">
        <DockFrame>
          <EvmBuyPanel chainKey={chain.key} tokenAddress={address} symbol={snap.symbol} priceUsd={snap.priceUsd} mcap={snap.marketCap ?? snap.fdv} imageUrl={snap.imageUrl} />
          <AboutBlock
            symbol={snap.symbol}
            change={snap.change}
            buys={snap.txns.h24.buys}
            sells={snap.txns.h24.sells}
            website={site}
            twitter={tw}
            telegram={tg}
          />
          {stats}
        </DockFrame>
      </aside>
    </div>
  );
}
