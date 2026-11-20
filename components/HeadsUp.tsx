"use client";
// A heads-up banner at the top of the screen for alerts that arrive while the app is open. Android draws no system notification for the app that is
// already on screen, so the bell badge was the only sign. This is the banner you would see from any other app.
// Sources, both through the "wraith-headsup" event: a push that reaches the open app (NativePush) and fresh items the bell finds (NotificationBell).
// Tap = open what it is about. Swipe up or wait a few seconds = gone.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type HeadsUpDetail = { title: string; body?: string; href?: string };
const EVENT = "wraith-headsup";

export function showHeadsUp(d: HeadsUpDetail) {
  try { window.dispatchEvent(new CustomEvent<HeadsUpDetail>(EVENT, { detail: d })); } catch { /* very old browser */ }
}

export default function HeadsUp() {
  const router = useRouter();
  const [b, setB] = useState<(Required<HeadsUpDetail> & { id: number }) | null>(null);
  const [out, setOut] = useState(false);
  const timer = useRef(0);
  const last = useRef({ key: "", at: 0 });
  const startY = useRef<number | null>(null);

  const hide = useCallback(() => {
    setOut(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setB(null); setOut(false); }, 220);
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<HeadsUpDetail>).detail;
      if (!d?.title) return;
      const key = `${d.title}|${d.body ?? ""}`, now = Date.now();
      if (last.current.key === key && now - last.current.at < 90_000) return; // the same alert arrived by push and by the bell
      last.current = { key, at: now };
      setOut(false);
      setB({ id: now, title: d.title, body: d.body ?? "", href: d.href ?? "" });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(hide, 6000);
    };
    window.addEventListener(EVENT, on);
    return () => { window.removeEventListener(EVENT, on); window.clearTimeout(timer.current); };
  }, [hide]);

  if (!b) return null;
  const open = () => {
    hide();
    if (b.href.startsWith("/") && !b.href.startsWith("//")) router.push(b.href);
  };
  return (
    <div className={`wx-hu${out ? " out" : ""}`} role="alert" aria-live="assertive">
      <button
        type="button"
        className="wx-hu-body"
        onClick={open}
        onPointerDown={(e) => { startY.current = e.clientY; }}
        onPointerMove={(e) => { if (startY.current !== null && startY.current - e.clientY > 24) { startY.current = null; hide(); } }}
        onPointerUp={() => { startY.current = null; }}
        onPointerCancel={() => { startY.current = null; }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={34} height={34} />
        <span><b>{b.title}</b>{b.body && <small>{b.body}</small>}</span>
        <em>now</em>
      </button>
    </div>
  );
}
