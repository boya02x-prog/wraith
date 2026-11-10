"use client";

// Native Android app only: the app adds ?fcm=<token> to the address it opens. This saves that token and
// links it to the signed-in account so the server can send real (Firebase) push notifications.
// On every open it also double-checks that the server still has this phone, and links it again if not.

import { useEffect } from "react";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";

const TOKEN_KEY = "wraith_fcm_token";
const LINKED_KEY = "wraith_fcm_linked";
const OFF_KEY = "wraith_fcm_off";
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* blocked */ } };

export default function FcmLink() {
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const t = u.searchParams.get("fcm");
      if (t) {
        if (get(TOKEN_KEY) !== t) set(LINKED_KEY, null);
        set(TOKEN_KEY, t);
        u.searchParams.delete("fcm");
        window.history.replaceState(null, "", u.pathname + u.search + u.hash);
      }
    } catch { /* ignore */ }

    let stopped = false;
    let tries = 0;
    let nextVerify = 0;

    const link = async (force = false) => {
      const token = get(TOKEN_KEY);
      if (!token || get(OFF_KEY)) return;
      if (!force && get(LINKED_KEY) === token) return;
      try {
        const r = await fetch("/api/push/fcm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            prefs: { trader: true, callout: true, saved: true, signal: true },
            saved: readTokenFavorites().filter((f) => f.contractAddress && SOL.test(f.contractAddress)).map((f) => ({ mint: f.contractAddress, symbol: f.keyword })),
          }),
        });
        if (r.ok) {
          set(LINKED_KEY, token);
          window.dispatchEvent(new Event("wraith:fcm-linked"));
        }
      } catch { /* retry */ }
    };

    // The server forgets a phone whose token went stale, and a phone that another account signed in on belongs to that
    // account. This app would still say "linked" while nothing arrives, so ask the server and link again if it does not
    // know this phone.
    const verify = async () => {
      const token = get(TOKEN_KEY);
      if (!token || get(OFF_KEY) || get(LINKED_KEY) !== token || Date.now() < nextVerify) return;
      nextVerify = Date.now() + 15_000; // no answer (signed out, offline): try again soon
      try {
        const r = await fetch("/api/push/fcm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, verify: true }) });
        if (!r.ok) return;
        const d = (await r.json()) as { thisPhone?: boolean };
        nextVerify = Date.now() + 5 * 60_000; // answered: ask again in 5 minutes at most
        if (d.thisPhone === false) { set(LINKED_KEY, null); await link(true); }
      } catch { /* retry soon */ }
    };

    void link();
    // you may sign in after the app opened, so keep trying for a while
    const timer = window.setInterval(() => {
      if (stopped || ++tries > 80) { window.clearInterval(timer); return; }
      void link();
      void verify();
    }, 15_000);
    const first = window.setTimeout(() => void verify(), 4_000);
    const onVisible = () => { if (document.visibilityState === "visible") void verify(); };
    const onFavs = () => { if (get(LINKED_KEY)) void link(true); };
    const onRelink = () => { set(OFF_KEY, null); void link(true); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(TOKEN_FAVORITES_EVENT, onFavs);
    window.addEventListener("wraith:fcm-relink", onRelink);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(TOKEN_FAVORITES_EVENT, onFavs);
      window.removeEventListener("wraith:fcm-relink", onRelink);
    };
  }, []);
  return null;
}
