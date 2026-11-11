"use client";

import StatusBar from "@/components/StatusBar";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePresence } from "@/lib/usePresence";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import BookmarkBtn from "@/components/BookmarkBtn";
import { Activity, Bookmark, Flame, Radar, Wallet } from "lucide-react";
import { ToastProvider } from "@/components/Toast";
import type { MemeTrend } from "@/app/app/page";
import { readTokenNav, cacheTokenNav } from "@/lib/tokenNav";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";
import { SOLANA_MINT_RE } from "@/lib/market";
import { chainOf, EVM_ADDR_RE } from "@/lib/chains";
import { TokenIcon } from "@/components/TokenIcon";
import SheetBoundary from "@/components/SheetBoundary";

import Header from "@/components/HeaderSlot";
const TokenPanel = dynamic(() => import("@/components/TokenPanel"), { ssr: false });
const TokenMarketList = dynamic(() => import("@/components/TokenMarketList"), { ssr: false });
const EvmTokenView = dynamic(() => import("@/components/EvmTokenView"), { ssr: false });
const SignalsSidebar = dynamic(() => import("@/components/SignalsSidebar"), { ssr: false });
// The trade panel is a big chunk (wallet, swap and bridge code). It used to load only when Buy/Sell was tapped and showed NOTHING
// while it loaded (or if the download failed), which looked like an empty sheet. It is now fetched as soon as the page opens
// and shows a skeleton while it finishes.
const loadTradeDock = () => import("@/components/TokenTradeDock");
const TokenTradeDock = dynamic(loadTradeDock, {
  ssr: false,
  loading: () => (
    <div style={{ padding: 16, display: "grid", gap: 12 }} aria-busy="true" aria-label="Loading trade panel">
      <div className="wx-skel" style={{ height: 44, borderRadius: 10 }} />
      <div className="wx-skel" style={{ height: 38, borderRadius: 10 }} />
      <div className="wx-skel" style={{ height: 54, borderRadius: 10 }} />
      <div className="wx-skel" style={{ height: 48, borderRadius: 10 }} />
    </div>
  ),
});

type SideTab = "tokens" | "signals" | "saved";
type MobileTab = "chart" | "trade" | "market";

const SIDE_TABS: { key: SideTab; label: string; icon: React.ReactNode }[] = [
  { key: "tokens", label: "Market", icon: <Flame size={13} /> },
  { key: "signals", label: "Signals", icon: <Radar size={13} /> },
  { key: "saved", label: "Saved", icon: <Bookmark size={13} /> },
];

export default function TokenPage() {
  const params = useParams();
  const router = useRouter();
  const routeAddress = decodeURIComponent((params?.address as string) ?? "");
  // Local copy of the address: switching tokens updates this + the URL (history.pushState) instead of a router navigation.
  // A router.push to /token/<other> remounts the entire page (header, sidebar, chart, dock): that was the "hard reload" feel.
  const [address, setAddress] = useState(routeAddress);
  const [meme, setMeme] = useState<MemeTrend | null>(null);
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>("tokens");
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");
  const [sheet, setSheet] = useState<null | "buy" | "sell">(null);
  // keep the last sheet on screen while it slides away
  const lastSheet = useRef<"buy" | "sell">("buy");
  if (sheet) lastSheet.current = sheet;
  const shownSheet = sheet ?? lastSheet.current;
  const sheetPres = usePresence(!!sheet, 210);
  // warm the trade panel chunk so the sheet opens instantly
  useEffect(() => { const t = window.setTimeout(() => { void loadTradeDock().catch(() => undefined); }, 400); return () => window.clearTimeout(t); }, []);
  const [favorites, setFavorites] = useState<MemeTrend[]>([]);
  const isEvm = EVM_ADDR_RE.test(address);
  const validMint = SOLANA_MINT_RE.test(address) || isEvm;

  useEffect(() => {
    const load = () => setFavorites(readTokenFavorites());
    load();
    window.addEventListener(TOKEN_FAVORITES_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(TOKEN_FAVORITES_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { setAddress((cur) => (cur === routeAddress ? cur : routeAddress)); }, [routeAddress]);
  useEffect(() => {
    const onPop = () => {
      const m = window.location.pathname.match(/\/app\/token\/([^/?#]+)/);
      if (m) setAddress(decodeURIComponent(m[1]));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback(
    (next: MemeTrend) => {
      if (!next.contractAddress || next.contractAddress === address) return;
      cacheTokenNav(next);
      setMobileTab("chart");
      const evm = EVM_ADDR_RE.test(next.contractAddress) ? chainOf(next.source) : null;
      const url = `/app/token/${encodeURIComponent(next.contractAddress)}${evm ? `?chain=${evm.key}` : ""}`;
      if (evm) { router.push(url); return; } // EVM view lives in a different branch: a real navigation is fine there
      window.history.pushState(null, "", url);
      setMeme(next);
      setAddress(next.contractAddress);
    },
    [router, address],
  );

  // Resolve the token identity: sessionStorage handoff first, API for direct links.
  useEffect(() => {
    if (!address || !validMint || isEvm) return;
    const cached = readTokenNav(address);
    if (cached) {
      setMeme(cached);
      return;
    }
    setMeme({ keyword: address.slice(0, 4).toUpperCase(), score: 0, posts: 0, source: "direct", contractAddress: address });
    let alive = true;
    fetch(`/api/token-price?mint=${encodeURIComponent(address)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { symbol?: string | null; marketCap?: number | null; liquidity?: number | null; imageUrl?: string | null } | null) => {
        if (!alive || !d?.symbol) return;
        const next: MemeTrend = {
          keyword: d.symbol,
          score: 0,
          posts: 0,
          source: "direct",
          contractAddress: address,
          mcap: d.marketCap ?? undefined,
          liquidity: d.liquidity ?? undefined,
          tokenImageUrl: d.imageUrl ?? undefined,
        };
        cacheTokenNav(next);
        setMeme(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [address, validMint, isEvm]);

  const sidebar = (
    <>
      <nav className="wx-side-tabs" aria-label="Token sidebar">
        {SIDE_TABS.map((t) => (
          <button key={t.key} type="button" className={sideTab === t.key ? "on" : ""} aria-pressed={sideTab === t.key} onClick={() => setSideTab(t.key)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="wx-side-body">
        {sideTab === "tokens" && <TokenMarketList onSelectMeme={go} selectedMeme={meme} />}
        {sideTab === "signals" && <SignalsSidebar onSelectMeme={go} selectedMeme={meme} />}
        {sideTab === "saved" &&
          (favorites.length ? (
            <div className="wx-side-scroll">
              {favorites.map((f) => (
                <div key={f.contractAddress} role="button" tabIndex={0} className="wx-side-row" onClick={() => go(f)} onKeyDown={(e) => { if (e.key === "Enter") go(f); }}>
                  <TokenIcon contractAddress={f.contractAddress} imageUrl={f.tokenImageUrl} symbol={f.keyword} size={36} />
                  <span className="mid">
                    <strong>{f.keyword}</strong>
                  </span>
                  <BookmarkBtn meme={f} />
                </div>
              ))}
            </div>
          ) : (
            <div className="wx-empty small"><span>Bookmark a token to keep it here.</span></div>
          ))}
      </div>
    </>
  );

  if (isEvm) {
    return (
      <ToastProvider>
        <div className="wraith-dashboard wraith-token-page wx-page">
          <Header onSelectMeme={go} />
          <EvmTokenView address={address} sidebar={sidebar} />
          <StatusBar />
        </div>
      </ToastProvider>
    );
  }

  if (!validMint) {
    return (
      <ToastProvider>
        <div className="wraith-dashboard wx-page">
          <Header onSelectMeme={go} />
          <div className="wx-empty" style={{ flex: 1 }}>
            <strong>That isn&apos;t a valid token address</strong>
            <span>Check the link, or pick a token from the market.</span>
            <button type="button" className="wx-btn primary" onClick={() => router.push("/app")}>Back to market</button>
          </div>
        </div>
      </ToastProvider>
    );
  }

  if (!meme || isMobile === null) return <div className="wraith-dashboard wx-page" />;


  return (
    <ToastProvider>
      <div className="wraith-dashboard wraith-token-page wx-page">
        <Header onSelectMeme={go} />

        {isMobile ? (
          <>
            <div className="wx-mobile-body">
              <div style={{ display: mobileTab === "market" ? "none" : "block", height: "100%" }}>
                <TokenPanel selectedMeme={meme} />
              </div>
              <div style={{ display: mobileTab === "market" ? "flex" : "none", height: "100%", flexDirection: "column" }}>{sidebar}</div>
            </div>
            <div className="wx-mbar" role="toolbar" aria-label="Trade">
              <button type="button" className="wx-mbar-nav" onClick={() => setMobileTab(mobileTab === "market" ? "chart" : "market")}>
                {mobileTab === "market" ? <Activity size={18} /> : <Flame size={18} />}
                <span>{mobileTab === "market" ? "Chart" : "Market"}</span>
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
                    <TokenTradeDock meme={meme} initialMode={shownSheet} />
                  </SheetBoundary>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="wx-workspace">
            <aside className="wx-sidebar">{sidebar}</aside>
            <div className="wx-center">
              <TokenPanel selectedMeme={meme} />
            </div>
            <aside className="wx-dock">
              <TokenTradeDock meme={meme} />
            </aside>
          </div>
        )}
        {!isMobile && <StatusBar />}
      </div>
    </ToastProvider>
  );
}
