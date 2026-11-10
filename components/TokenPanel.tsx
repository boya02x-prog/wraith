"use client";

// components/TokenPanel.tsx
// Center column of the token page: identity + live stats + chart + activity.
// Rebuilt around two server endpoints (/api/token-price, /api/token-chart) so
// every number on screen comes from one consistent snapshot.

import { safetyBand } from "@/lib/scoreBand";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { createPortal } from "react-dom";
import { ArrowLeft, Bookmark, Check, Copy, ExternalLink, Globe, Link2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MemeTrend } from "@/app/app/page";
import TokenChart from "@/components/TokenChart";
import { snapCache } from "@/lib/prefetchChart";
import { fetchSolPrice } from "@/lib/solPriceClient";
import { swrRead, swrWrite } from "@/lib/swrCache";
import { TokenDetailTabs, type AnalysisEntry, type IntelLink, type TradeRow } from "@/components/TokenDetailTabs";
import { TokenIcon } from "@/components/TokenIcon";
import SpotCard from "@/components/SpotCard";
import { readTokenFavorites, toggleTokenFavorite, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";
import { changeColor, fmtAge, fmtCount, fmtPct, fmtPrice, fmtUsd, shortAddr } from "@/lib/market";
import { useLiveTrades } from "@/lib/useLiveTrades";
import { PublicKey } from "@solana/web3.js";
import WalletWatch from "@/components/WalletWatch";
import { SOLANA_WS_PUSH } from "@/lib/publicRpc";

interface Windowed<T> {
  m5: T;
  h1: T;
  h6: T;
  h24: T;
}
interface Snapshot {
  mint: string;
  priceUsd: number;
  name: string | null;
  symbol: string | null;
  description: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  priceChange: Windowed<number | null>;
  dexId: string | null;
  pairCreatedAt: number | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  imageUrl: string | null;
  pairAddress: string | null;
  supply: number | null;
  volume: Windowed<number>;
  txns: Windowed<{ buys: number; sells: number }>;
  onCurve: boolean;
  graduated: boolean;
  curveProgress: number | null;
  stale?: boolean;
}
interface ApiTrade {
  id: string;
  ts: number;
  side: "buy" | "sell";
  usd: number;
  tokens: number;
  priceUsd: number;
  wallet: string;
}
interface Analysis {
  links?: IntelLink[];
  predictionReason?: string;
  safetyScore?: number;
  safetyBreakdown?: { label: string; pass: boolean; detail: string }[];
  thread?: AnalysisEntry[];
}

function XGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

type SnapState = "loading" | "ready" | "missing" | "error";

export default function TokenPanel({ selectedMeme }: { selectedMeme: MemeTrend | null }) {
  const router = useRouter();
  const goBack = () => {
    if (typeof window === "undefined") return;
    // history.back() does nothing when this page was the first one opened (Telegram link, new tab, app launch): fall back to the app home
    const before = window.location.href;
    if (window.history.length > 1) router.back();
    window.setTimeout(() => { if (window.location.href === before) router.push("/app"); }, 400);
  };
  const mint = selectedMeme?.contractAddress ?? "";
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [birth, setBirth] = useState<{ mint: string; createdAt: number } | null>(null);
  const [snapState, setSnapState] = useState<SnapState>("loading");
  const [trades, setTrades] = useState<ApiTrade[]>([]);
  const [holders, setHolders] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"ca" | "link" | null>(null);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; n: number } | null>(null);
  const prevPrice = useRef<number | null>(null);
  const lastLive = useRef(0);
  const solUsdRef = useRef(0);
  const [spotted, setSpotted] = useState<{ spottedMcap: number; spottedAt: number } | null>(null);
  // The trade dock renders <div id="wx-about-slot">; stats + risk checks live there as part of "About".
  const [aboutSlot, setAboutSlot] = useState<HTMLElement | null | "none">(null);
  useEffect(() => {
    let tries = 0;
    const find = () => {
      const el = document.getElementById("wx-about-slot");
      if (el) { setAboutSlot(el); return true; }
      return false;
    };
    if (find()) return;
    const t = setInterval(() => {
      tries += 1;
      if (find()) clearInterval(t);
      else if (tries > 20) { setAboutSlot("none"); clearInterval(t); }
    }, 250);
    return () => clearInterval(t);
  }, []);

  // ── exact launch time (first on-chain transaction of the mint, cached server-side) ──
  useEffect(() => {
    if (!mint) return;
    let alive = true;
    fetch(`/api/token-age?mint=${encodeURIComponent(mint)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { createdAt?: number } | null) => { if (alive && d && typeof d.createdAt === "number") setBirth({ mint, createdAt: d.createdAt }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [mint]);

  // ── live snapshot (price, mcap, volume, txns, socials) ────────────────
  useEffect(() => {
    if (!mint) return;
    const warm = snapCache.get(mint);
    if (warm && Date.now() - warm.ts < 300_000) {
      setSnap(warm.data as Snapshot);
      setSnapState("ready");
    } else {
      setSnap(null);
      setSnapState("loading");
    }
    setFlash(null);
    prevPrice.current = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const res = await fetch(`/api/token-price?mint=${encodeURIComponent(mint)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!alive) return;
        if (res.ok) {
          const data: Snapshot = await res.json();
          if (!alive) return;
          snapCache.set(mint, { data, ts: Date.now() });
          // keep the websocket-driven price/mcap if a live trade landed recently (APIs lag a few seconds)
          setSnap((cur) =>
            cur && Date.now() - lastLive.current < 20_000
              ? { ...data, priceUsd: cur.priceUsd, marketCap: cur.marketCap ?? data.marketCap }
              : data,
          );
          setSnapState("ready");
        } else if (res.status === 404) {
          setSnapState((s) => (s === "ready" ? s : "missing"));
        } else {
          throw new Error(String(res.status));
        }
      } catch {
        if (alive) setSnapState((s) => (s === "ready" ? s : "error"));
      }
      if (alive) timer = setTimeout(run, document.hidden ? 15_000 : 2_500);
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mint]);

  // ── candle history for accurate % windows ─────────────────────────────
  const [hist, setHist] = useState<{ t: number; o: number; c: number }[]>([]);
  useEffect(() => {
    if (!mint) return;
    setHist([]);
    let alive = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/token-chart?address=${encodeURIComponent(mint)}&tf=5m`, { cache: "no-store" });
        if (!r.ok) return;
        const d: { candles?: { t: number; o: number; c: number }[] } = await r.json();
        if (alive && Array.isArray(d.candles) && d.candles.length) setHist(d.candles);
      } catch { /* optional */ }
    };
    void run();
    const t = visibleInterval(run, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [mint]);

  // ── exact on-chain pool price (PumpSwap): updates ~every second, no indexer lag ──
  const poolAddr = snap?.pairAddress ?? null;
  const poolDex = snap?.dexId ?? "";
  useEffect(() => {
    if (!mint || !poolAddr || !/pump/i.test(poolDex)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Push stream: Helius websocket on the pool's two vault accounts -> price changes the instant a trade lands.
    let ws: WebSocket | null = null;
    let baseAmt = 0;
    let quoteAmt = 0;
    // Push streaming only runs when a keyless (or domain-locked) wss URL is configured, see lib/publicRpc.ts. Otherwise the poll below
    // keeps the price live; it never needs a provider key in the browser.
    const wsUrl = SOLANA_WS_PUSH;
    const push = () => {
      if (!(baseAmt > 0 && quoteAmt > 0) || !(solUsdRef.current > 0)) return;
      const priceUsd = (quoteAmt / baseAmt) * solUsdRef.current;
      lastLive.current = Date.now();
      setSnap((cur) => (cur ? { ...cur, priceUsd, marketCap: cur.supply ? priceUsd * cur.supply : cur.marketCap } : cur));
    };
    const startStream = (v: { base: string; quote: string }, b0: number, q0: number) => {
      if (!wsUrl) return;
      baseAmt = b0; quoteAmt = q0;
      try { ws = new WebSocket(wsUrl); } catch { return; }
      const sock = ws;
      sock.onopen = () => {
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: 11, method: "accountSubscribe", params: [v.base, { encoding: "jsonParsed", commitment: "confirmed" }] }));
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: 12, method: "accountSubscribe", params: [v.quote, { encoding: "jsonParsed", commitment: "confirmed" }] }));
      };
      const subs = new Map<number, "base" | "quote">();
      sock.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          if (m.id === 11 && typeof m.result === "number") subs.set(m.result, "base");
          if (m.id === 12 && typeof m.result === "number") subs.set(m.result, "quote");
          if (m.method !== "accountNotification") return;
          const which = subs.get(m.params?.subscription);
          const ui = Number(m.params?.result?.value?.data?.parsed?.info?.tokenAmount?.uiAmount);
          if (!which || !(ui > 0)) return;
          if (which === "base") baseAmt = ui; else quoteAmt = ui;
          push();
        } catch { /* ignore */ }
      };
      sock.onclose = () => { ws = null; };
      sock.onerror = () => { try { sock.close(); } catch { /* */ } };
    };
    const run = async () => {
      try {
        const r = await fetch(`/api/live-price?mint=${encodeURIComponent(mint)}&pool=${encodeURIComponent(poolAddr)}`, { cache: "no-store" });
        if (r.status === 404) return; // unsupported pool layout: stop polling
        if (r.ok && alive) {
          const d: { priceUsd?: number; solUsd?: number; vaults?: { base: string; quote: string }; base?: number; quote?: number } = await r.json();
          if (d.vaults && !ws && d.base && d.quote) startStream(d.vaults, d.base, d.quote);
          if (d.base && d.quote) { baseAmt = d.base; quoteAmt = d.quote; }
          if (d.priceUsd && d.priceUsd > 0) {
            if (d.solUsd) solUsdRef.current = d.solUsd;
            lastLive.current = Date.now();
            setSnap((cur) => (cur ? { ...cur, priceUsd: d.priceUsd!, marketCap: cur.supply ? d.priceUsd! * cur.supply : cur.marketCap } : cur));
          }
        }
      } catch { /* retry */ }
      if (alive) timer = setTimeout(run, document.hidden ? 5000 : ws ? 4000 : 1200);
    };
    void run();
    return () => { alive = false; clearTimeout(timer); try { ws?.close(); } catch { /* */ } };
  }, [mint, poolAddr, poolDex]);

  // ── pump.fun bonding curve: stream the curve account itself, price moves with every trade ──
  const onCurveNow = snap?.onCurve ?? false;
  useEffect(() => {
    if (!mint || !onCurveNow) return;
    let curve: string;
    try {
      curve = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("bonding-curve"), new PublicKey(mint).toBytes()],
        new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
      )[0].toBase58();
    } catch { return; }
    let alive = true;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const u64 = (v: DataView, o: number) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296;
    const apply = (b64: string) => {
      try {
        const bin = atob(b64);
        if (bin.length < 49) return;
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dv = new DataView(bytes.buffer);
        const vTok = u64(dv, 8) / 1e6;
        const vSol = u64(dv, 16) / 1e9;
        const solUsd = solUsdRef.current;
        if (!(vTok > 0) || !(vSol > 0) || !(solUsd > 0)) return;
        const priceUsd = (vSol / vTok) * solUsd;
        lastLive.current = Date.now();
        setSnap((cur) => (cur ? { ...cur, priceUsd, marketCap: priceUsd * (cur.supply ?? 1_000_000_000) } : cur));
      } catch { /* ignore */ }
    };
    // No push socket configured (the default): poll the curve account through our own server, which caches it for a moment so many
    // viewers of the same token share one RPC read.
    if (!SOLANA_WS_PUSH || typeof WebSocket === "undefined") {
      let stopped = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        if (stopped) return;
        if (!document.hidden) {
          try {
            const r = await fetch(`/api/live-price?mint=${encodeURIComponent(mint)}&curve=1`, { cache: "no-store" });
            if (r.ok) {
              const d: { curve?: string } = await r.json();
              if (d.curve) apply(d.curve);
            } else if (r.status === 404) {
              return; // curve account is gone (token graduated): stop polling
            }
          } catch { /* retry */ }
        }
        if (!stopped) pollTimer = setTimeout(poll, document.hidden ? 5000 : 1500);
      };
      void poll();
      return () => { stopped = true; if (pollTimer) clearTimeout(pollTimer); };
    }
    const connect = () => {
      if (!alive) return;
      try { ws = new WebSocket(SOLANA_WS_PUSH); } catch { return; }
      const sock = ws;
      sock.onopen = () => {
        retry = 0;
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: 21, method: "accountSubscribe", params: [curve, { encoding: "base64", commitment: "confirmed" }] }));
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: 22, method: "getAccountInfo", params: [curve, { encoding: "base64" }] }));
      };
      sock.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data));
          if (m.id === 22) { const d = m.result?.value?.data?.[0]; if (d) apply(d); return; }
          if (m.method === "accountNotification") { const d = m.params?.result?.value?.data?.[0]; if (d) apply(d); }
        } catch { /* ignore */ }
      };
      sock.onclose = () => { if (alive) { retry += 1; timer = setTimeout(connect, Math.min(10_000, 1000 * retry)); } };
      sock.onerror = () => { try { sock.close(); } catch { /* */ } };
    };
    connect();
    return () => { alive = false; if (timer) clearTimeout(timer); try { ws?.close(); } catch { /* */ } };
  }, [mint, onCurveNow]);

  // remember every token you open so the search box can show it under RECENT
  const recentSavedFor = useRef("");
  useEffect(() => {
    if (!snap || !snap.symbol || recentSavedFor.current === mint) return;
    recentSavedFor.current = mint;
    try {
      const entry = {
        address: mint,
        name: snap.name ?? snap.symbol,
        symbol: snap.symbol,
        icon: snap.imageUrl ?? undefined,
        priceUsd: snap.priceUsd,
        marketCap: snap.marketCap ?? 0,
        liquidity: snap.liquidity ?? 0,
        volume24h: snap.volume24h ?? 0,
        priceChange24h: snap.priceChange.h24 ?? 0,
        chainId: "solana",
        pairAddress: snap.pairAddress ?? "",
      };
      const raw = localStorage.getItem("wraith_recent_tokens");
      const list: { address: string }[] = raw ? JSON.parse(raw) : [];
      const next = [entry, ...list.filter((t) => t && t.address !== mint)].slice(0, 8);
      localStorage.setItem("wraith_recent_tokens", JSON.stringify(next));
    } catch { /* ignore */ }
  }, [snap, mint]);

  // green dot = a live trade / pool update arrived in the last 8s
  const [isLive, setIsLive] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setIsLive(Date.now() - lastLive.current < 8000), 1000);
    return () => clearInterval(t);
  }, []);

  // ── SOL/USD for converting live trades ────────────────────────────────
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSolPrice()
        .then((d: { solUsd?: number } | null) => { if (alive && d?.solUsd) solUsdRef.current = d.solUsd; })
        .catch(() => undefined);
    void load();
    const t = visibleInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // ── real-time trades: every buy/sell moves price, mcap, chart and the swaps list ──
  useLiveTrades(mint, (t) => {
    const solUsd = solUsdRef.current;
    if (!(solUsd > 0)) return;
    const priceUsd = t.priceSol * solUsd;
    const usd = t.sol * solUsd;
    lastLive.current = Date.now();
    setTrades((prev) => (prev.some((x) => x.id === t.id) ? prev : [{ id: t.id, ts: t.ts, side: t.side, usd, tokens: t.tokens, priceUsd, wallet: t.wallet }, ...prev].slice(0, 80)));
    setSnap((s) => {
      if (!s) return s;
      const bump = <T extends { buys: number; sells: number }>(x: T): T => ({ ...x, buys: x.buys + (t.side === "buy" ? 1 : 0), sells: x.sells + (t.side === "sell" ? 1 : 0) });
      const addVol = (v: number) => v + usd;
      const marketCap = t.marketCapSol ? t.marketCapSol * solUsd : s.supply ? priceUsd * s.supply : s.marketCap;
      return {
        ...s,
        priceUsd,
        marketCap,
        txns: { m5: bump(s.txns.m5), h1: bump(s.txns.h1), h6: bump(s.txns.h6), h24: bump(s.txns.h24) },
        volume: { m5: addVol(s.volume.m5), h1: addVol(s.volume.h1), h6: addVol(s.volume.h6), h24: addVol(s.volume.h24) },
        volume24h: s.volume24h != null ? s.volume24h + usd : s.volume24h,
      };
    });
  });

  // ── was this token flagged by Wraith? (shared server record) ──────────
  useEffect(() => {
    if (!mint) return;
    setSpotted(null);
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch(`/api/signal-calls?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data: { calls?: { spottedMcap: number; spottedAt: number }[] } = await res.json();
        const c = data.calls?.[0];
        if (alive && c && c.spottedMcap > 0) setSpotted({ spottedMcap: c.spottedMcap, spottedAt: c.spottedAt });
      } catch { /* optional */ }
    };
    void run();
    return () => { alive = false; };
  }, [mint]);

  // ── live trades ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mint) return;
    setTrades([]);
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const res = await fetch(`/api/token-trades?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        if (res.ok && alive) {
          const data: { trades?: ApiTrade[] } = await res.json();
          if (alive && Array.isArray(data.trades)) setTrades(data.trades);
        }
      } catch {
        /* keep previous trades */
      }
      if (alive) timer = setTimeout(run, document.hidden ? 60_000 : 30_000);
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mint]);

  // ── holders (Birdeye-backed; optional) ────────────────────────────────
  useEffect(() => {
    if (!mint) return;
    setHolders(null);
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch(`/api/token-holder-count?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data: { holderCount?: number } = await res.json();
        if (alive && typeof data.holderCount === "number") setHolders(data.holderCount);
      } catch {
        /* optional */
      }
    };
    void run();
    const t = visibleInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint]);

  // ── Wraith intel / safety (optional, never blocks the page) ───────────
  const symbolForAnalysis = snap?.symbol ?? selectedMeme?.keyword ?? "";
  const analysisKey = snap ? mint : "";
  useEffect(() => {
    if (!analysisKey) return;
    setAnalysis(swrRead<Analysis>(`an:${mint}`, 20 * 60_000) ?? null);
    const ctrl = new AbortController();
    const params = new URLSearchParams({
      keyword: symbolForAnalysis,
      contract: mint,
      mcap: String(snap?.marketCap ?? 0),
      liquidity: String(snap?.liquidity ?? 0),
      priceChange1h: String(snap?.priceChange.h1 ?? 0),
    });
    fetch(`/api/analyze?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Analysis | null) => {
        if (d && !ctrl.signal.aborted) {
          setAnalysis(d);
          swrWrite(`an:${mint}`, d);
        }
      })
      .catch(() => undefined);
    return () => ctrl.abort();
    // snap fields are intentionally read once per token; re-running per tick would spam the AI route
  }, [analysisKey]);

  // ── favorites ─────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => setSaved(readTokenFavorites().some((f) => f.contractAddress === mint));
    sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TOKEN_FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [mint]);

  // ── price flash on tick ───────────────────────────────────────────────
  const price = snap?.priceUsd ?? null;
  useEffect(() => {
    if (price == null) return;
    const prev = prevPrice.current;
    prevPrice.current = price;
    if (prev != null && prev !== price) setFlash({ dir: price > prev ? "up" : "down", n: Date.now() });
  }, [price]);

  const copy = useCallback((what: "ca" | "link") => {
    const text = what === "ca" ? mint : window.location.href;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    });
  }, [mint]);

  const toggleSave = useCallback(() => {
    if (!mint) return;
    toggleTokenFavorite({
      keyword: snap?.symbol ?? selectedMeme?.keyword ?? mint.slice(0, 4),
      score: 0,
      posts: 0,
      source: "saved",
      contractAddress: mint,
      tokenImageUrl: snap?.imageUrl ?? selectedMeme?.tokenImageUrl,
      mcap: snap?.marketCap ?? selectedMeme?.mcap,
    });
  }, [mint, snap, selectedMeme]);

  const tradeRows: TradeRow[] = useMemo(
    () =>
      trades.map((t) => ({
        ageLabel: fmtAge(t.ts),
        type: t.side === "buy" ? "Buy" : "Sell",
        amountUsd: t.usd,
        tokens: Math.round(t.tokens),
        mcapAtTrade: snap?.supply ? t.priceUsd * snap.supply : 0,
        traderShort: shortAddr(t.wallet, 4, 4),
        wallet: t.wallet,
      })),
    [trades, snap?.supply],
  );

  if (!selectedMeme || !mint) {
    return <div className="wx-empty">Select a token to view its chart.</div>;
  }

  const symbol = snap?.symbol ?? selectedMeme.keyword ?? "TOKEN";
  const name = snap?.name && snap.name !== symbol ? snap.name : null;
  const mcap = snap?.marketCap ?? selectedMeme.mcap ?? null;
  // % windows computed from our own candles + live price (matches fomo: token-age based when younger than the window)
  const ch = useMemo(() => {
    const base = snap?.priceChange;
    const px = snap?.priceUsd ?? 0;
    if (!base || !(px > 0) || hist.length < 2) return base;
    const now = Date.now();
    const first = hist[0];
    const full = hist.length < 290;
    const pct = (ms: number, fallback: number | null): number | null => {
      const target = now - ms;
      let ref: number | null = null;
      if (first.t <= target) {
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i].t <= target) { ref = hist[i].c; break; }
        }
      } else if (full && ms >= 6 * 3600_000) {
        ref = first.o;
      }
      return ref && ref > 0 ? ((px - ref) / ref) * 100 : fallback;
    };
    return { m5: pct(5 * 60_000, base.m5), h1: pct(3600_000, base.h1), h6: pct(6 * 3600_000, base.h6), h24: pct(24 * 3600_000, base.h24) };
  }, [snap?.priceChange, snap?.priceUsd, hist]);
  const buys = snap?.txns.h24.buys ?? 0;
  const sells = snap?.txns.h24.sells ?? 0;
  const buyShare = buys + sells > 0 ? (buys / (buys + sells)) * 100 : 50;
  const pumpMint = mint.endsWith("pump");
  const loadingSnap = snapState === "loading" && !snap;

  const birthMs = birth && birth.mint === mint ? birth.createdAt : null;
  const ageText = birthMs ? fmtAge(birthMs) : snap?.pairCreatedAt ? fmtAge(snap.pairCreatedAt) : (selectedMeme?.ageLabel ?? null);
  const stats: { label: string; value: string; sub?: string }[] = [
    { label: "Liquidity", value: fmtUsd(snap?.liquidity) },
    { label: "Volume 24h", value: fmtUsd(snap?.volume.h24 ?? snap?.volume24h), sub: `1h ${fmtUsd(snap?.volume.h1)}` },
    { label: "Holders", value: holders != null ? fmtCount(holders) : "—" },
    { label: "Txns 24h", value: fmtCount(buys + sells), sub: `${fmtCount(buys)} buys · ${fmtCount(sells)} sells` },
    { label: "Age", value: ageText ?? "—" },
    { label: "Price", value: fmtPrice(snap?.priceUsd) },
  ];

  const aboutBlock = (
    <>
      <div className="wx-stats">
        {stats.map((s) => (
          <div key={s.label} className="wx-stat">
            <span>{s.label}</span>
            {loadingSnap ? <div className="wx-skel" style={{ width: "70%", height: 16 }} /> : <b>{s.value}</b>}
            {s.sub && !loadingSnap && <small>{s.sub}</small>}
          </div>
        ))}
      </div>

      {analysis?.safetyBreakdown && analysis.safetyBreakdown.length > 0 && (
        <section className="wx-safety">
          <div className="wx-safety-head">
            <strong>Risk checks</strong>
            {typeof analysis.safetyScore === "number" && <span style={{ color: safetyBand(analysis.safetyScore).color }}>{safetyBand(analysis.safetyScore).label} · {analysis.safetyScore}/100</span>}
          </div>
          <div className="wx-safety-grid">
            {[...analysis.safetyBreakdown].sort((a, b) => Number(a.pass) - Number(b.pass)).map((c) => (
              <div key={c.label} className={c.pass ? "ok" : "bad"} title={c.detail}>
                <b>{c.pass ? "✓" : "✕"}</b> {c.label}
              </div>
            ))}
          </div>
        </section>
      )}

    </>
  );

  return (
    <div className="wx-panel">
      {aboutSlot && aboutSlot !== "none" && createPortal(aboutBlock, aboutSlot)}
      {/* ── header ── */}
      <header className="wx-token-head">
        <button type="button" className="wx-back-btn" aria-label="Back" onClick={goBack}><ArrowLeft size={18} /></button>
        <div className="wx-token-id">
          <TokenIcon contractAddress={mint} imageUrl={snap?.imageUrl ?? selectedMeme.tokenImageUrl ?? undefined} symbol={symbol} size={48} />
          <div style={{ minWidth: 0 }}>
            <div className="wx-token-name">
              <h1>{symbol}</h1>
              {snap?.onCurve && <span className="wx-badge accent">Bonding curve</span>}
              {snap?.graduated && <span className="wx-badge">Graduated</span>}
              {snap?.dexId && !snap.onCurve && <span className="wx-badge muted">{snap.dexId}</span>}
              {snap?.stale && <span className="wx-badge muted wx-stale">delayed</span>}
            </div>
            <div className="wx-token-sub">
              {name && <span>{name}</span>}
              <button type="button" className="wx-ca" onClick={() => copy("ca")} title="Copy contract address">
                {shortAddr(mint, 5, 5)} {copied === "ca" ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
          </div>
        </div>

        <div className="wx-token-actions">
          {snap?.website && (
            <a href={snap.website} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="Website" title="Website">
              <Globe size={14} />
            </a>
          )}
          {snap?.twitter && (
            <a href={snap.twitter} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="X / Twitter" title="X / Twitter">
              <XGlyph size={13} />
            </a>
          )}
          {snap?.telegram && (
            <a href={snap.telegram} target="_blank" rel="noopener noreferrer" className="wx-icon-btn" aria-label="Telegram" title="Telegram">
              <Send size={14} />
            </a>
          )}
          <a
            href={pumpMint ? `https://pump.fun/coin/${mint}` : `https://dexscreener.com/solana/${snap?.pairAddress ?? mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="wx-icon-btn"
            aria-label={pumpMint ? "Open on pump.fun" : "Open on DexScreener"}
            title={pumpMint ? "pump.fun" : "DexScreener"}
          >
            <ExternalLink size={14} />
          </a>
          <button type="button" className="wx-icon-btn" onClick={() => copy("link")} aria-label="Copy page link" title="Copy link">
            {copied === "link" ? <Check size={14} /> : <Link2 size={14} />}
          </button>
          <button type="button" className={`wx-icon-btn${saved ? " active" : ""}`} onClick={toggleSave} aria-pressed={saved} aria-label={saved ? "Remove bookmark" : "Bookmark"} title={saved ? "Saved" : "Save token"}>
            <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
      </header>

      {/* ── price strip ── */}
      <div className="wx-pricebar">
        <div>
          <div className="wx-kicker">Market cap{ageText ? <span className="wx-age-chip" title="Time since this token launched">{ageText} old</span> : null}{isLive && <span title="Live price feed connected" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#22c55e", marginLeft: 8, verticalAlign: "middle", boxShadow: "0 0 6px #22c55e" }} />}</div>
          {loadingSnap ? (
            <div className="wx-skel" style={{ width: 150, height: 34 }} />
          ) : (
            <div key={flash?.n ?? 0} className={`wx-mcap${flash ? ` wx-flash-${flash.dir}` : ""}`}>
              {fmtUsd(mcap, { decimals: 2 })}
            </div>
          )}
        </div>
        <div className="wx-changes">
          {(
            [
              ["5m", ch?.m5],
              ["1h", ch?.h1],
              ["6h", ch?.h6],
              ["24h", ch?.h24],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="wx-change">
              <span>{label}</span>
              <b style={{ color: changeColor(v) }}>{loadingSnap ? "…" : fmtPct(v)}</b>
            </div>
          ))}
        </div>
      </div>

      {spotted && spotted.spottedMcap > 0 && (
        <div className="wb-spot" title="Market cap when Wraith first flagged this token">
          <span>Spotted {new Date(spotted.spottedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          <span>at <b>{fmtUsd(spotted.spottedMcap)}</b></span>
          <i>{mcap != null ? `now ${fmtUsd(mcap)} · ${(mcap / spotted.spottedMcap).toFixed(2)}x` : "now …"}</i>
        </div>
      )}

      {snapState === "missing" && !snap && (
        <div className="wx-note">
          No market found for this mint yet. It may be brand new or not indexed — the page keeps checking automatically.
        </div>
      )}
      {snapState === "error" && !snap && <div className="wx-note warn">Market data is slow to respond. Retrying…</div>}

      {/* ── chart ── */}
      {/* wallets Wraith has seen dump (or win) before, shown where you read the chart, not only in the buy panel */}
      <div style={{ padding: "0 12px" }}><WalletWatch mint={mint} /></div>
      <section className="wx-chart-card" aria-label="Price chart">
        <TokenChart mint={mint} onCurve={snap?.onCurve ?? false} livePrice={snap?.priceUsd ?? null} supply={snap?.supply ?? null} spottedMcap={spotted?.spottedMcap ?? null} spottedAt={spotted?.spottedAt ?? null}
          trades={trades}
          spotCard={spotted ? <SpotCard info={{ mint, spottedMcap: spotted.spottedMcap, spottedAt: spotted.spottedAt, nowMcap: mcap, liquidity: snap?.liquidity ?? null, vol24: snap?.volume24h ?? null, buys, sells, change: ch ?? null, ageText, safetyScore: analysis?.safetyScore, safetyBreakdown: analysis?.safetyBreakdown, reason: analysis?.predictionReason }} /> : undefined} />
      </section>

      {/* ── bonding curve ── */}
      {snap?.onCurve && snap.curveProgress != null && (
        <div className="wx-curve">
          <div className="wx-curve-head">
            <span>Bonding curve progress</span>
            <b>~{Math.round(snap.curveProgress * 100)}%</b>
          </div>
          <div className="wx-bar">
            <i style={{ width: `${Math.max(2, snap.curveProgress * 100)}%` }} />
          </div>
          <small>Estimate based on market cap. Graduates to a DEX pool when the curve completes.</small>
        </div>
      )}

      {aboutSlot === "none" && aboutBlock}

      {/* ── activity ── */}
      <div style={{ padding: "0 0 20px" }}>
        <TokenDetailTabs trades={tradeRows} mint={mint} intelLinks={analysis?.links} intelSummary={analysis?.predictionReason} thread={analysis?.thread} safetyScore={analysis?.safetyScore} safetyBreakdown={analysis?.safetyBreakdown} currentMcap={snap?.marketCap} />
      </div>
    </div>
  );
}
