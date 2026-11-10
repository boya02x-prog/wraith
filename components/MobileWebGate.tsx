"use client";

// On a phone-sized browser window (not the installed app) show a "download the app" screen instead of the cramped web page,
// the way fomo.family does. Android gets the APK, iPhone gets Add to Home Screen. "Continue on web" is always there
// because there is no iPhone app yet. The installed app (APK / home-screen) never sees this screen.
import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { isInstalledApp } from "@/components/AppLock";

const APK_URL = "/downloads/wraith.apk";
const SKIP_KEY = "wraith_web_ok";

export default function MobileWebGate() {
  const path = usePathname() || "";
  const [show, setShow] = useState(false);
  const [os, setOs] = useState<"android" | "ios" | "other">("other");

  useEffect(() => {
    if (!path.startsWith("/app")) { setShow(false); return; }
    const check = () => {
      let skipped = false;
      try { skipped = sessionStorage.getItem(SKIP_KEY) === "1"; } catch { /* ignore */ }
      setShow(window.innerWidth < 768 && !skipped && !isInstalledApp());
    };
    const ua = navigator.userAgent || "";
    setOs(/android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "other");
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [path]);

  if (!show) return null;
  return (
    <div className="wx-gate" role="dialog" aria-label="Download the Wraith app">
      <style>{`
        .wx-gate{position:fixed;inset:0;z-index:2147482000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px 24px;background:#0c0c0d;text-align:center;color:#eee}
        .wx-gate .logo{position:relative;width:84px;height:84px;margin-bottom:6px}
        .wx-gate h1{margin:0;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:.2px}
        .wx-gate p{margin:0;max-width:300px;color:#9a9a9f;font-size:14px;line-height:1.5}
        .wx-gate .btn{display:flex;align-items:center;justify-content:center;gap:8px;width:min(280px,100%);height:48px;border-radius:12px;background:#ff7b3d;color:#140a04;font-weight:700;font-size:15px;text-decoration:none;border:0;cursor:pointer}
        .wx-gate .ghost{background:transparent;color:#bbb;border:1px solid #2a2a2e;font-weight:600}
        .wx-gate .link{background:none;border:0;color:#8a8a90;font-size:13px;text-decoration:underline;cursor:pointer;padding:8px}
        .wx-gate .note{font-size:12px;color:#77777c}
      `}</style>
      <div className="logo"><Image src="/logo.svg" alt="" fill sizes="84px" style={{ objectFit: "contain" }} priority /></div>
      <h1>Download the app<br />to start trading</h1>
      <p>Wraith is built for the app: faster charts, push alerts and fingerprint unlock.</p>
      {os !== "ios" && <a className="btn" href={APK_URL} download="WRAITH.apk">Download for Android</a>}
      {os === "ios" ? (
        <p className="note">On iPhone: tap Share, then Add to Home Screen.</p>
      ) : (
        <p className="note">Open the file, allow installs from this source, tap Install.</p>
      )}
      <button type="button" className="link" onClick={() => { try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* ignore */ } setShow(false); }}>
        Continue on web
      </button>
    </div>
  );
}
