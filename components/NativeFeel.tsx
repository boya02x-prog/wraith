"use client";
// The "native app" feel, for phones and tablets:
//  1. Elastic pull: dragging past the top or bottom of a scrolling screen stretches it with your finger (heavier the further you pull) and
//     springs back when you let go, like Instagram. The installed app turns the browser's own overscroll effect off (so a pull does not
//     refresh the page), which is why there was no bounce at all.
//  2. Rows arrive one after another: when a list appears, its first rows ease in with a tiny delay between them, so a screen feels like it
//     is filling in quickly instead of popping in all at once. Each row animates once (a row that only moves position does not replay).
// Neither touches the data or the layout: they only move things for a few hundred milliseconds. Both stand down for "reduce motion".
import { useEffect } from "react";

const ROW_SELECTOR = ".sg-card, .wx-tcard, .profile-trade-row, .hl-row, .tr-row, .wx-side-row, .hc-card, .la-row, .mn-row, .pt-item, .ad-user, .q-card";
const SKIP_ELASTIC = "[data-no-elastic], .wx-chart-host, canvas, input, textarea, select, .wpl, .ps, .wx-spot-sheet";

/** iOS-style resistance: the first pixels move almost 1:1, then it gets heavier and levels off near 160px. */
const rubber = (d: number) => (1 - 1 / (d * 0.0075 + 1)) * 160;

function scrollerFor(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

export default function NativeFeel() {
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    // ── 1. elastic pull ───────────────────────────────────────────────────────────
    let cleanup = () => undefined as void;
    if (coarse) {
      type Gesture = { x0: number; y0: number; scroller: HTMLElement | null; target: HTMLElement | null; mode: "top" | "bottom" | null; originY: number };
      let g: Gesture | null = null;
      let timer: number | undefined;

      const pageRoot = () => document.querySelector<HTMLElement>(".wx-page, .profile-page, main.wraith-dashboard:not(.wx-shell)");
      const edge = (s: HTMLElement | null) => {
        if (s) return { top: s.scrollTop <= 0, bottom: s.scrollTop + s.clientHeight >= s.scrollHeight - 1 };
        const el = document.scrollingElement ?? document.documentElement;
        return { top: el.scrollTop <= 0, bottom: el.scrollTop + window.innerHeight >= el.scrollHeight - 1 };
      };
      const release = (t: HTMLElement) => {
        t.style.transition = "transform .55s cubic-bezier(.22, 1, .36, 1)";
        t.style.transform = "";
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { t.style.transition = ""; t.style.willChange = ""; }, 600);
      };

      const onStart = (e: TouchEvent) => {
        g = null;
        if (e.touches.length !== 1) return;
        const t = e.target as HTMLElement | null;
        if (!t || t.closest(SKIP_ELASTIC) || document.body.style.overflow === "hidden") return;
        const scroller = scrollerFor(t);
        const target = scroller ?? pageRoot();
        if (!target) return;
        g = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, scroller, target, mode: null, originY: 0 };
      };
      const onMove = (e: TouchEvent) => {
        if (!g || !g.target) return;
        const x = e.touches[0].clientX, y = e.touches[0].clientY;
        if (!g.mode) {
          const dx = x - g.x0, dy = y - g.y0;
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { g = null; return; } // a sideways swipe: not ours
          const ed = edge(g.scroller);
          if (dy > 6 && ed.top) g.mode = "top";
          else if (dy < -6 && ed.bottom) g.mode = "bottom";
          else return; // normal scrolling
          g.originY = y;
          g.target.style.transition = "none";
          g.target.style.willChange = "transform";
        }
        const d = g.mode === "top" ? y - g.originY : g.originY - y;
        if (d < 0) { release(g.target); g.mode = null; return; } // the finger came back past where the pull began: normal scrolling again
        if (d === 0) return; // the pull has just begun
        if (e.cancelable) e.preventDefault();
        const off = rubber(d);
        g.target.style.transform = `translate3d(0, ${g.mode === "top" ? off : -off}px, 0)`;
      };
      const onEnd = () => {
        if (g?.mode && g.target) release(g.target);
        g = null;
      };
      document.addEventListener("touchstart", onStart, { passive: true, capture: true });
      document.addEventListener("touchmove", onMove, { passive: false, capture: true });
      document.addEventListener("touchend", onEnd, { passive: true, capture: true });
      document.addEventListener("touchcancel", onEnd, { passive: true, capture: true });
      cleanup = () => {
        document.removeEventListener("touchstart", onStart, true);
        document.removeEventListener("touchmove", onMove, true);
        document.removeEventListener("touchend", onEnd, true);
        document.removeEventListener("touchcancel", onEnd, true);
        window.clearTimeout(timer);
      };
    }

    // ── 2. rows arrive one after another ──────────────────────────────────────────
    const seen = new WeakSet<Element>();
    let batchAt = 0, batchN = 0;
    const animateIn = (el: Element) => {
      if (seen.has(el)) return;
      seen.add(el);
      const now = performance.now();
      if (now - batchAt > 140) batchN = 0; // a new batch of rows: start counting from the top again
      batchAt = now;
      const i = batchN++;
      if (i > 11) return; // only the first rows of a batch are staged; the rest just appear
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight || r.bottom < 0) return; // not on screen: nothing to stage
      try { el.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: i * 30, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "backwards" }); } catch { /* old WebView: rows just appear */ }
    };
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches(ROW_SELECTOR)) animateIn(n);
          else n.querySelectorAll(ROW_SELECTOR).forEach(animateIn);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => { cleanup(); mo.disconnect(); };
  }, []);
  return null;
}
