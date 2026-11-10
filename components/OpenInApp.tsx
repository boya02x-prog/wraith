"use client";

// Shown only in Chrome right after Google sign-in that was started from the Wraith Android app (the app adds ?app=1 to the
// address before it hands off to Google). Sends the result back to the app with an Android intent that names the app
// directly, so it does not depend on Android's link verification. If the app is not installed, the page carries on as usual.
import { useEffect, useMemo, useState } from "react";

export default function OpenInApp() {
  const [show, setShow] = useState(false);
  const link = useMemo(() => {
    if (typeof window === "undefined") return "";
    const here = new URL(window.location.href);
    const back = new URL(here.href);
    back.searchParams.delete("app");
    return `intent://${here.host}${here.pathname}${here.search}#Intent;scheme=https;package=farm.wraith.app;S.browser_fallback_url=${encodeURIComponent(back.href)};end`;
  }, []);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/WraithApp/.test(ua) || !/Android/i.test(ua)) return;
    const u = new URL(window.location.href);
    const returning = u.searchParams.get("app") === "1" && [...u.searchParams.keys()].some((k) => k.startsWith("privy_oauth"));
    if (!returning) return;
    setShow(true);
    const t = window.setTimeout(() => { window.location.href = link; }, 400);
    return () => window.clearTimeout(t);
  }, [link]);

  if (!show) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483000, display: "grid", placeItems: "center", background: "#0c0c0d", padding: 24, textAlign: "center", color: "#ededee", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Signed in</div>
        <p style={{ margin: "0 0 22px", color: "#a1a1a6", fontSize: 15, lineHeight: 1.5 }}>Opening the Wraith app to finish.</p>
        <a href={link} style={{ display: "block", height: 54, lineHeight: "54px", borderRadius: 16, background: "#ff7b3d", color: "#140a04", fontWeight: 800, fontSize: 16, textDecoration: "none" }}>Open Wraith</a>
      </div>
    </div>
  );
}
