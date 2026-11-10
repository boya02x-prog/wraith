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
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", top: "calc(var(--sai-top) + 8px)", left: "50%", zIndex: 5000, pointerEvents: "none",
        transform: `translate(-50%, ${Math.min(pull, 70) - 40}px)`, opacity: Math.min(1, pull / 40),
        width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center",
        background: "var(--surface-2, #1a1a1d)", border: "1px solid var(--border)", boxShadow: "0 6px 18px rgba(0,0,0,.5)",
        transition: busy ? "none" : "opacity .1s",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ready || busy ? "var(--accent, #ff7b3d)" : "var(--text-muted)"} strokeWidth="2.4" strokeLinecap="round" style={{ transform: busy ? undefined : `rotate(${pull * 3}deg)`, animation: busy ? "wx-ptr-spin .7s linear infinite" : undefined }}>
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v6h-6" />
      </svg>
      <style>{"@keyframes wx-ptr-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
