"use client";

// Turns real phone notifications on/off for this device and keeps the server in sync
// with what you want to hear about (categories + the tokens you saved).

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { readTokenFavorites, TOKEN_FAVORITES_EVENT } from "@/lib/tokenFavorites";
import { enablePush } from "@/lib/pushClient";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Prefs = { trader: boolean; callout: boolean; saved: boolean; signal: boolean };
type State = "checking" | "unsupported" | "off" | "on" | "blocked";
export default function PushToggle({ prefs }: { prefs: Prefs }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [perm, setPerm] = useState("");
  const fcmRef = useRef(false); // native Android push is linked
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const payload = useCallback((sub: PushSubscription) => ({
    subscription: sub.toJSON(),
    prefs: prefsRef.current,
    saved: readTokenFavorites()
      .filter((f) => f.contractAddress && SOL.test(f.contractAddress))
      .map((f) => ({ mint: f.contractAddress, symbol: f.keyword })),
  }), []);

  const sync = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(sub)) });
    } catch { /* retry next change */ }
  }, [payload]);

  const check = useCallback(() => {
    if (fcmRef.current) { setState("on"); return; }
    // inside the Android app the phone permission is handled natively, so Chrome's (often stale) "denied" must not matter
    let nativeTok = false, nativeOff = false, nativeLinked = false;
    try {
      nativeTok = !!localStorage.getItem("wraith_fcm_token");
      nativeOff = !!localStorage.getItem("wraith_fcm_off");
      nativeLinked = !!localStorage.getItem("wraith_fcm_linked");
    } catch { /* blocked */ }
    if (nativeTok) {
      if (nativeLinked && !nativeOff) { fcmRef.current = true; setState("on"); } else setState("off");
      return;
    }
    if (!VAPID || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
    setPerm(Notification.permission);
    if (Notification.permission === "denied") { setState("blocked"); return; }
    navigator.serviceWorker.getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setState(s && Notification.permission === "granted" ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  // native Android push (Firebase): when the app has linked this phone, that is what "on" means
  useEffect(() => {
    const probe = () => {
      fetch("/api/push/fcm").then((r) => r.json()).then((d: { linked?: boolean }) => {
        if (d.linked) {
          fcmRef.current = true;
          setState("on");
        }
      }).catch(() => undefined);
    };
    probe();
    window.addEventListener("wraith:fcm-linked", probe);
    return () => window.removeEventListener("wraith:fcm-linked", probe);
  }, []);

  useEffect(() => {
    check();
    // re-check when you come back from the phone's Settings
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", check); };
  }, [check]);

  // keep the server in step when you change categories or save / unsave a token
  useEffect(() => {
    if (state !== "on") return;
    const t = setTimeout(() => void sync(), 600);
    return () => clearTimeout(t);
  }, [state, prefs, sync]);
  useEffect(() => {
    if (state !== "on") return;
    const h = () => void sync();
    window.addEventListener(TOKEN_FAVORITES_EVENT, h);
    return () => window.removeEventListener(TOKEN_FAVORITES_EVENT, h);
  }, [state, sync]);

  const enable = async () => {
    setBusy(true); setMsg("");
    try {
      if (localStorage.getItem("wraith_fcm_token")) {
        // native app: link the phone for Firebase push instead of web push, then send a test alert
        window.dispatchEvent(new Event("wraith:fcm-relink"));
        return;
      }
      const r = await enablePush(prefsRef.current, true);
      if (r !== "on") { setState(r === "blocked" ? "blocked" : "off"); return; }
      setState("on");
    } catch {
      setMsg("Could not turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setMsg("");
    try {
      if (fcmRef.current) {
        await fetch("/api/push/fcm", { method: "DELETE" }).catch(() => undefined);
        try { localStorage.setItem("wraith_fcm_off", "1"); localStorage.removeItem("wraith_fcm_linked"); } catch { /* blocked */ }
        fcmRef.current = false;
        setState("off");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") return null;
  if (!VAPID && !fcmRef.current && state !== "on" && state !== "off") return null;
  if (state === "unsupported") {
    return <p className="wx-push-note">Phone notifications need a supported browser. On iPhone, add Wraith to your Home Screen first.</p>;
  }
  if (state === "blocked") {
    return (
      <div className="wx-push-note">
        <p style={{ margin: 0 }}>Notifications are blocked for Wraith. Switch them on in Settings → Apps → Wraith → Notifications, then come back here.</p>
        <p style={{ margin: "6px 0 0", opacity: 0.7, fontSize: 12 }}>Phone says: {perm || "denied"}</p>
        <button type="button" onClick={() => { check(); window.setTimeout(() => window.location.reload(), 300); }} style={{ marginTop: 8, padding: "7px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontWeight: 700, fontSize: 12.5 }}>Check again</button>
      </div>
    );
  }
  return (
    <div className="wx-push">
      {state === "on" ? (
        <>
          <span><BellRing size={15} /> Phone notifications are on</span>
          <span>
            <button type="button" disabled={busy} onClick={() => void disable()}>Turn off</button>
          </span>
        </>
      ) : (
        <>
          <span><BellRing size={15} /> Get alerts on your phone, even when the app is closed</span>
          <button type="button" className="primary" disabled={busy} onClick={() => void enable()}>{busy ? "…" : "Turn on"}</button>
        </>
      )}
      {msg && <small>{msg}</small>}
    </div>
  );
}
