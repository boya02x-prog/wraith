"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// Pull down from the top of any screen to reload, like Facebook / Instagram. Touch devices only, and only when the screen is
// already scrolled to the very top, so it never fights normal scrolling, the chart, sheets or text boxes.
const TRIGGER = 78;
const MAX = 120;

function scrolledAncestor(el: Element | null): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollTop > 0) return true;
    }
  }
  return false;
}

export default function PullToRefresh() {
  const path = usePathname();
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);
  const live = useRef(0);

  const enabled = path?.startsWith("/app") ?? false;

  useEffect(() => {
    if (!enabled) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const onStart = (e: TouchEvent) => {
      start.current = null;
      if (e.touches.length !== 1 || window.scrollY > 0) return;
      const t = e.target as Element | null;
      if (!t || t.closest("input, textarea, select, canvas, [role='dialog'], .wx-sheet, .wx-chart-card, .wx-notif, .profile-modal, [data-no-ptr]")) return;
      if (scrolledAncestor(t)) return;
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      const dx = Math.abs(e.touches[0].clientX - s.x);
      if (dy <= 0 || dx > dy) { live.current = 0; setPull(0); return; }
      const v = Math.min(MAX, dy * 0.5);
      live.current = v;
      setPull(v);
    };
    const onEnd = () => {
      const v = live.current;
      start.current = null;
      live.current = 0;
      if (v >= TRIGGER / 2 + 10) {
        setBusy(true);
        setPull(TRIGGER / 2);
        // Refresh in place (like Facebook / Instagram): no page reload, so no splash screen and no lost scroll or lock state.
        window.dispatchEvent(new Event("wraith:refresh"));
        window.dispatchEvent(new Event("focus")); // live lists (callouts, rails) refetch on focus
        try { router.refresh(); } catch { /* ignore */ }
        window.setTimeout(() => { setBusy(false); setPull(0); }, 900);
      } else {
        setPull(0);
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, router]);

  if (!enabled || (pull <= 0 && !busy)) return null;
  const ready = pull >= TRIGGER / 2 + 10;
  // Instagram style: no button, just a thin ring that draws itself as you pull and spins while it loads, lower down, under the top bar
  const C = 2 * Math.PI * 9;
  const frac = Math.min(1, pull / (TRIGGER / 2 + 10));
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", top: "calc(var(--sai-top) + 64px)", left: "50%", zIndex: 60, pointerEvents: "none",
        transform: `translate(-50%, ${Math.min(pull, 60) * 0.5}px)`, opacity: busy ? 1 : Math.min(1, pull / 30),
        width: 28, height: 28, transition: busy ? "none" : "opacity .1s",
      }}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ animation: busy ? "wx-ptr-spin .75s linear infinite" : undefined, transform: busy ? undefined : `rotate(${pull * 4}deg)` }}>
        <circle cx="14" cy="14" r="9" stroke="rgba(255,255,255,.14)" strokeWidth="2.4" />
        <circle cx="14" cy="14" r="9" stroke={frac >= 1 || busy ? "var(--accent, #ff7b3d)" : "rgba(255,255,255,.85)"} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${busy ? C * 0.3 : C * frac * 0.85} ${C}`} transform="rotate(-90 14 14)" />
      </svg>
      <style>{"@keyframes wx-ptr-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
