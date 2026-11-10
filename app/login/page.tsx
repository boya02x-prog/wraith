"use client";

import "../site.css";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ChainLogo from "@/components/ChainLogo";
import { CallsTable, ChartReal, Coin, LiveBoard, fmtUsd, useLandingData, xf } from "@/components/landing/Mocks";
import "@/components/landing/landing.css";
import { useWraithSession } from "@/components/SessionProvider";

const CHAINS = [
  ["solana", "Solana"], ["base", "Base"], ["ethereum", "Ethereum"], ["bsc", "BNB"], ["monad", "Monad"], ["arc", "Arc"], ["robinhood", "Robinhood"],
] as const;

function safeCallback(raw: string | null): string {
  if (!raw) return "/app";
  try {
    if (raw.startsWith("http")) {
      const u = new URL(raw);
      if (typeof window !== "undefined" && u.origin !== window.location.origin)
        return "/app";
      return `${u.pathname}${u.search}` || "/app";
    }
  } catch {
    return "/app";
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
  if (raw === "/") return "/app";
  return raw;
}

function GoogleIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 48 48"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.09-6.09C34.46 3.04 29.53 1 24 1 14.82 1 7.07 6.48 3.64 14.22l7.1 5.52C12.48 13.48 17.77 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.52 24.5c0-1.64-.15-3.22-.43-4.74H24v8.98h12.67c-.55 2.9-2.2 5.36-4.68 7.01l7.18 5.58C43.36 37.28 46.52 31.36 46.52 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.74 28.26A14.5 14.5 0 0 1 9.5 24c0-1.49.26-2.93.72-4.27l-7.1-5.52A23.93 23.93 0 0 0 0 24c0 3.86.92 7.5 2.54 10.72l8.2-6.46z"
      />
      <path
        fill="#34A853"
        d="M24 47c5.52 0 10.16-1.83 13.54-4.96l-7.18-5.58c-1.83 1.23-4.18 1.96-6.36 1.96-6.22 0-11.5-3.98-13.26-9.5l-8.2 6.46C7.07 41.52 14.82 47 24 47z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

function LoginInner() {
  const { status, login, syncAppSession } = useWraithSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const redirected = useRef(false);
  const [oauthStale, setOauthStale] = useState(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOauthStale(true), 7000); return () => clearTimeout(t); }, []);
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"));
  const data = useLandingData();

  // Once Privy says authenticated, create the app session cookie, then go.
  useEffect(() => {
    if (status !== "authenticated" || redirected.current) return;
    let cancelled = false;
    setSyncError(null);
    setSyncing(true);
    // Privy can say "authenticated" a moment before its access token is ready (common on phones after the Google
    // redirect), so retry a few times instead of failing once and leaving the button stuck.
    const attempt = async () => {
      let last: unknown = null;
      for (let i = 0; i < 5; i++) {
        if (cancelled) return;
        try {
          await syncAppSession();
          if (cancelled || redirected.current) return;
          redirected.current = true;
          // In-app navigation: no second page load, so no second loading screen. refresh() drops any cached "go to /login" redirect.
          router.replace(callbackUrl);
          router.refresh();
          return;
        } catch (err) {
          last = err;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      if (cancelled) return;
      setSyncError(last instanceof Error ? last.message : "Could not start your session.");
      setSyncing(false);
    };
    void attempt();
    return () => {
      cancelled = true;
    };
  }, [status, syncAppSession, callbackUrl, router]);

  if (status === "loading") return null;
  // Coming back from Google: show "Signing you in…" right away instead of flashing the button again.
  const returningFromOAuth = searchParams.has("privy_oauth_code") || searchParams.has("privy_oauth_state");
  // "returning from Google" only counts for a few seconds: if Privy never finishes, the button must work again.
  const busy = syncing || opening || (returningFromOAuth && !syncError && !oauthStale);

  return (
    <div className="wl2">
      {/* The app, blurred behind the card. Real, public call data only. */}
      <div className="wl2-bg" aria-hidden="true">
        <div className="wl2-top">
          <span className="ws-brand"><img src="/logo.svg" alt="" />WRAITH</span>
          <span className="wl2-search">Search tokens &amp; traders…</span>
          <span className="wl2-cash"><small>CASH BALANCE</small><b>$0.00</b></span>
        </div>
        <div className="wl2-shell">
          <div className="wl2-col"><CallsTable data={data} /></div>
          <div className="wl2-mid">
            <div className="wl2-mcap"><small>MARKET CAP</small><b>$—</b></div>
            <ChartReal data={data} />
          </div>
          <div className="wl2-col"><LiveBoard data={data} loading={!data} /></div>
        </div>
      </div>
      <div className="wl2-veil" />

      <main className="wl2-main">
        {data?.wins[0] && (<div className="wl2-float l"><Coin c={data.wins[0]} /><div><b>${data.wins[0].symbol.toUpperCase()} reached {xf(data.wins[0].x)}</b><span>called at {fmtUsd(data.wins[0].spottedMcap)} · peak {fmtUsd(data.wins[0].peakMcap)}</span></div></div>)}
        {data?.wins[1] && (<div className="wl2-float r"><Coin c={data.wins[1]} /><div><b>${data.wins[1].symbol.toUpperCase()} reached {xf(data.wins[1].x)}</b><span>called at {fmtUsd(data.wins[1].spottedMcap)} · peak {fmtUsd(data.wins[1].peakMcap)}</span></div></div>)}
        <div className="wl2-card">
          <div className="logo"><i className="ring" /><i className="ring r2" /><img src="/logo.svg" alt="Wraith" /></div>
          <span className="wl2-eyebrow">WRAITH</span>
          <h1>Trade every chain.<br />One balance.</h1>
          <p className="lead">Scan new tokens, follow the best traders and trade across seven chains. Your wallets are created for you.</p>

          {syncError && <div className="wl-err">{syncError}</div>}

          <button
            className="ws-btn primary wl-g"
            disabled={busy}
            onClick={() => {
              setSyncError(null);
              if (status === "authenticated") {
                window.location.reload();
                return;
              }
              // In the Android app, Google opens in Chrome. Mark the address so Chrome knows to send you back to the app.
              if (/WraithApp/.test(navigator.userAgent)) {
                const u = new URL(window.location.href);
                u.searchParams.set("app", "1");
                window.history.replaceState(null, "", `${u.pathname}${u.search}`);
              }
              // Answer the tap immediately: Privy needs a moment to build the Google link before the screen can leave.
              setOpening(true);
              window.setTimeout(() => setOpening(false), 9000); // never leave the button stuck if Google does not open
              login();
            }}
          >
            {opening && !syncing ? "Opening Google…" : busy ? "Signing you in…" : (<><GoogleIcon />Continue with Google</>)}
          </button>

          {data && data.stats.calls > 0 && (
            <div className="wl2-stats">
              <div><b>{data.stats.calls.toLocaleString()}</b><small>calls tracked</small></div>
              <div><b>{data.stats.hit2.toLocaleString()}</b><small>reached 2x</small></div>
              <div><b>7</b><small>networks</small></div>
            </div>
          )}
          <div className="wl2-chains">
            {CHAINS.map(([k, n]) => (<span key={k} title={n}><ChainLogo chain={k} size={20} /></span>))}
          </div>
          <p className="wl-legal">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>. Wallets are secured by Privy and locked behind your PIN. Not financial advice, tokens are high risk.</p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
