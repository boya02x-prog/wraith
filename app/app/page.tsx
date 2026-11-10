"use client";

import StatusBar from "@/components/StatusBar";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cacheTokenNav } from "@/lib/tokenNav";
import { ToastProvider } from "@/components/Toast";

const Header = dynamic(() => import("@/components/Header"), { ssr: false });
const TokenBoard = dynamic(() => import("@/components/TokenBoard"), { ssr: false });
const WinsBoard = dynamic(() => import("@/components/WinsBoard"), { ssr: false });
const SignalScanner = dynamic(() => import("@/components/SignalScanner"), { ssr: false });
const HotCalloutsFeed = dynamic(() => import("@/components/HotCalloutsFeed"), { ssr: false });
const MarketCallsRail = dynamic(() => import("@/components/MarketCallsRail"), { ssr: false });

// Shared across the app (scanner, wins, favorites, token navigation).
export interface MemeTrend {
  keyword: string;
  score: number;
  posts: number;
  source: string;
  hasTicker?: boolean;
  crossPlatforms?: number;
  isNewCoin?: boolean;
  ageLabel?: string;
  mcap?: number;
  liquidity?: number;
  volume?: number;
  tokenImageUrl?: string;
  platforms?: string[];
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
}

type View = "market" | "scanner" | "wins" | "intel";
const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "market", label: "Market", hint: "Live Solana tokens" },
  { key: "scanner", label: "Scanner", hint: "Live momentum signals" },
  { key: "wins", label: "Wins", hint: "How our calls performed" },
  { key: "intel", label: "Intel", hint: "What traders are calling right now" },
];

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>("market");
  const [selected, setSelected] = useState<MemeTrend | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("wraith_home_view");
      if (v === "market" || v === "scanner" || v === "wins" || v === "intel") setView(v);
      else if (v === "callouts") setView("intel"); // old saved value from before the rename
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Warm the token screen's code while the list is on screen, so the first token you tap opens without waiting for its code to download.
  // (Any token address works: the page code is shared, and this does nothing in development.)
  useEffect(() => {
    const run = () => { try { router.prefetch("/app/token/So11111111111111111111111111111111111111112"); router.prefetch("/app/traders"); } catch { /* ignore */ } };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(run, { timeout: 2500 }); else window.setTimeout(run, 1500);
  }, [router]);

  // Mobile tab bar switches the home view without a reload
  useEffect(() => {
    const h = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "market" || v === "scanner" || v === "wins" || v === "intel") setView(v);
    };
    window.addEventListener("wraith:view", h);
    return () => window.removeEventListener("wraith:view", h);
  }, []);

  const changeView = useCallback((next: View) => {
    setView(next);
    try {
      localStorage.setItem("wraith_home_view", next);
    } catch {
      /* ignore */
    }
  }, []);

  const handleSelectMeme = useCallback(
    (meme: MemeTrend) => {
      setSelected(meme);
      if (!meme.contractAddress) return;
      cacheTokenNav(meme);
      router.push(`/app/token/${encodeURIComponent(meme.contractAddress)}`);
    },
    [router],
  );

  return (
    <ToastProvider>
    <div className="wraith-dashboard wx-page">
      <Header onSelectMeme={handleSelectMeme} />


      <nav className="wx-subnav" aria-label="Discover sections">
        <div className="wx-subnav-inner">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" data-view={v.key} className={view === v.key ? "on" : ""} aria-current={view === v.key ? "page" : undefined} onClick={() => changeView(v.key)}>
              {v.label}
            </button>
          ))}
          <button type="button" data-view="traders" onClick={() => router.push("/app/traders")} title="Rankings and the traders you follow">Traders</button>
          <span className="wx-subnav-hint">{VIEWS.find((v) => v.key === view)?.hint}</span>
        </div>
      </nav>

      <main className="wx-main">
        {view === "market" && (
          <div className="wx-market-layout">
            <MarketCallsRail onSelectMeme={handleSelectMeme} onOpenScanner={() => changeView("scanner")} />
            <div className="wx-market-main">
              <TokenBoard onSelectMeme={handleSelectMeme} />
            </div>
          </div>
        )}

        {view === "scanner" && (
          <div className="wx-scanner-layout">
            <SignalScanner
              onSelectMeme={handleSelectMeme}
            />
          </div>
        )}

        {view === "wins" && (
          <div className="wx-wins-wrap">
            <WinsBoard onSelectMeme={handleSelectMeme} />
          </div>
        )}
        {view === "intel" && <HotCalloutsFeed onSelectMeme={handleSelectMeme} />}
      </main>
      <StatusBar />
    </div>
    </ToastProvider>
  );
}
