"use client";
// "Download app" button + sheet: Android APK (until Play Store), Play Store / App Store (soon), iPhone via Add to Home Screen.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const APK_URL = "/downloads/wraith.apk";

const PlayLogo = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="#00d7fe" d="M3.6 1.6 13.3 12 3.6 22.4a1.9 1.9 0 0 1-.6-1.4V3c0-.6.2-1 .6-1.4Z" />
    <path fill="#00f076" d="m16.6 8.7-3.3 3.3L3.6 1.6c.5-.3 1.2-.3 1.9.1l11.1 7Z" />
    <path fill="#ff3a44" d="m16.6 15.3-11.1 7c-.7.4-1.4.4-1.9.1L13.3 12l3.3 3.3Z" />
    <path fill="#ffd500" d="m20.5 10.9-3.9-2.2L13.3 12l3.3 3.3 3.9-2.2c1.2-.7 1.2-1.5 0-2.2Z" />
  </svg>
);
const AppleLogo = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
    <path d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.2 3.09 3.79 3.04 1.52-.07 2.09-.99 3.94-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.42-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.62-2.32-4.39-2.38-2-.16-3.68 1.09-4.61 1.09ZM15.53 3.83c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.8-3.53 1.82-.78.9-1.45 2.34-1.27 3.71 1.34.1 2.72-.69 3.55-1.7Z" />
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0-5-5m5 5 5-5M4 20h16" />
  </svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3m0 0L8 7m4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

export default function DownloadApp({ className = "ws-btn lg", label = "Download app" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<"android" | "ios" | "other">("other");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setMounted(true);
    setOs(/android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "other");
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const android = (
    <section className="dl-card dl-android">
      <div className="dl-head">
        <span className="dl-chip android">Android</span>
        <span className="dl-note">Direct install · free</span>
      </div>
      <a className="dl-btn" href={APK_URL} download="WRAITH.apk"><DownloadIcon />Download APK</a>
      <ol className="dl-steps">
        <li><i>1</i><span>Open the downloaded file</span></li>
        <li><i>2</i><span>If asked, allow installs from this source</span></li>
        <li><i>3</i><span>Tap Install, then open WRAITH</span></li>
      </ol>
      <div className="dl-store">
        <span className="dl-badge" aria-disabled="true"><PlayLogo /><span><small>Get it on</small><b>Google Play</b></span><em>Soon</em></span>
      </div>
    </section>
  );
  const ios = (
    <section className="dl-card dl-ios">
      <div className="dl-head">
        <span className="dl-chip ios">iPhone / iPad</span>
        <span className="dl-note">No download needed</span>
      </div>
      <ol className="dl-steps">
        <li><i>1</i><span>Open <b>wraith.farm</b> in Safari</span></li>
        <li><i>2</i><span>Tap the Share button <u><ShareIcon /></u></span></li>
        <li><i>3</i><span>Choose <b>Add to Home Screen</b></span></li>
      </ol>
      <div className="dl-store">
        <span className="dl-badge" aria-disabled="true"><AppleLogo /><span><small>Download on the</small><b>App Store</b></span><em>Soon</em></span>
      </div>
    </section>
  );

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && mounted && createPortal(
        <div className="dl-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dl-sheet" role="dialog" aria-modal="true" aria-label="Download the WRAITH app">
            <button type="button" className="dl-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            <div className="dl-top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="dl-app" src="/app-icon-v3.png" alt="" width={56} height={56} />
              <div>
                <h3>Get WRAITH on your phone</h3>
                <p className="dl-sub">Same account, same wallets. Live alerts like Telegram, right on your lock screen.</p>
              </div>
            </div>
            {os === "ios" ? <>{ios}{android}</> : <>{android}{ios}</>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
