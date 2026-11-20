"use client";

import StatusBar from "@/components/StatusBar";
import { startTransition, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { cacheTokenNav } from "@/lib/tokenNav";
import { ToastProvider } from "@/components/Toast";

import Header from "@/components/HeaderSlot";
import DiscoverNav from "@/components/DiscoverNav";
// Each section's code arrives separately. While it does, a plain placeholder stands in (before, the screen stayed blank until the code was in,
// which on the Wins tab felt like the tap did nothing). AppShell also fetches these in the background when the app is idle.
const ViewSkel = () => <div className="wx-view-skel" aria-hidden="true"><i /><i /><i /></div>;
const TokenBoard = dynamic(() => import("@/components/TokenBoard"), { ssr: false, loading: () => <ViewSkel /> });
const WinsBoard = dynamic(() => import("@/components/WinsBoard"), { ssr: false, loading: () => <ViewSkel /> });
const SignalScanner = dynamic(() => import("@/components/SignalScanner"), { ssr: false, loading: () => <ViewSkel /> });
const HotCalloutsFeed = dynamic(() => import("@/components/HotCalloutsFeed"), { ssr: false, loading: () => <ViewSkel /> });
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

function savedView(): View {
  try {
    const v = localStorage.getItem("wraith_home_view");
    if (v === "market" || v === "scanner" || v === "wins" || v === "intel") return v;
    if (v === "callouts") return "intel"; // old saved value from before the rename
  } catch {
    /* storage unavailable */
  }
  return "market";
}
const noSubscribe = () => () => undefined;

export default function Home() {
  const router = useRouter();
  // Arriving from another screen (tapping Wins on the Traders screen, say) the saved section is read before the first paint, so Market never flashes
  // up first. While the page is first built on the server and hydrated, the answer has to be Market (that is what the server drew); the effect below
  // then moves to the saved one.
  const clientRender = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [view, setView] = useState<View>(() => (clientRender ? savedView() : "market"));
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
      // a transition: the tab bar has already moved its highlight, and the (heavy) new section is built in small slices, so the tap never freezes the phone
      if (v === "market" || v === "scanner" || v === "wins" || v === "intel") startTransition(() => setView(v));
    };
    window.addEventListener("wraith:view", h);
    return () => window.removeEventListener("wraith:view", h);
  }, []);

  const changeView = useCallback((next: View) => {
    startTransition(() => setView(next));
    try {
      localStorage.setItem("wraith_home_view", next);
    } catch {
      /* ignore */
    }
    // tell the bottom tab bar, so its highlight follows the top row
    window.dispatchEvent(new CustomEvent("wraith:view-changed", { detail: next }));
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


      <DiscoverNav active={view} onPick={changeView} />

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
