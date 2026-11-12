"use client";
// The part of the app that never reloads. The top bar (cash balance, bell, avatar, search), the bottom tab bar and the
// trading engines that live inside the Header used to be torn down and rebuilt on every screen change, which is why the
// balance, the avatar and the tabs blinked each time. They now mount once here and stay while the screens swap under them.
// Each screen still writes <Header /> (see HeaderSlot): that only reserves the bar's space and hands over its handlers.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { MemeTrend } from "@/app/app/page";
import { useWraithSession } from "@/components/SessionProvider";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import ReferralPrompt from "@/components/ReferralPrompt";

type SelectFn = (meme: MemeTrend) => void;
type ShellCtx = { setSelect: (fn: SelectFn | null) => void };
const Ctx = createContext<ShellCtx | null>(null);
export const useAppShell = () => useContext(Ctx);

const Header = dynamic(() => import("@/components/Header"), {
  ssr: false,
  // first paint only, before the bar's code has arrived: the same bar shape, so nothing jumps when it appears
  loading: () => <header className="wraith-app-header" aria-hidden="true"><span className="wsk-b" style={{ width: 34, height: 34, borderRadius: 10 }} /><span style={{ flex: 1 }} /><span className="wsk-b" style={{ width: 150, height: 36, borderRadius: 10 }} /><span className="wsk-b" style={{ width: 36, height: 36, borderRadius: 12 }} /><span className="wsk-b" style={{ width: 34, height: 34, borderRadius: 17 }} /></header>,
});

export default function AppShell({ children }: { children: React.ReactNode }) {
  const select = useRef<SelectFn | null>(null);
  const [hasSelect, setHasSelect] = useState(false);
  const setSelect = useCallback((fn: SelectFn | null) => { select.current = fn; setHasSelect(!!fn); }, []);
  const ctx = useMemo(() => ({ setSelect }), [setSelect]);
  const onSelect = useCallback((m: MemeTrend) => select.current?.(m), []);

  // The page loaded, so the server holds a session cookie (it lasts 30 days). If Privy on this device says nobody is signed in
  // (logged out, storage cleared, the Privy login ran out), the wallet cannot sign anything and the two would disagree: end the
  // server session too and go to the sign-in page. Waits a moment and skips when offline, so a network blip never logs you out.
  const { status } = useWraithSession();
  useEffect(() => {
    if (!PRIVY_WALLETS_ENABLED || status !== "unauthenticated") return;
    const t = window.setTimeout(() => {
      if (navigator.onLine === false) return;
      fetch("/api/auth/session", { method: "DELETE" })
        .then((r) => { if (r.ok) window.location.assign(`/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`); })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [status]);
  return (
    <Ctx.Provider value={ctx}>
      <div className="wraith-dashboard wx-shell">
        <Header onSelectMeme={hasSelect ? onSelect : undefined} />
      </div>
      <ReferralPrompt />
      {children}
    </Ctx.Provider>
  );
}
