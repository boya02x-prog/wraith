"use client";

// Coming back from a token (or any screen) puts you exactly where you were: same scroll position in the same list.
// The app scrolls inside several containers (not only the window), so every scroll is remembered per page and per container,
// and on Back it is restored as soon as that container has enough content (lists load after the page opens).
import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Saved = Record<string, number>;
const KEY = "wraith_scroll_v1:";
const DOC = "__doc";

function selectorOf(el: Element): string | null {
  if (el === document.scrollingElement || el === document.documentElement || el === document.body) return DOC;
  const cls = [...el.classList].filter((c) => !/^(on|active|open|is-)/.test(c)).slice(0, 2);
  if (!cls.length) return null;
  return `${el.tagName.toLowerCase()}.${cls.map((c) => CSS.escape(c)).join(".")}`;
}

export default function ScrollRestore() {
  const path = usePathname();

  // remember
  useEffect(() => {
    let saved: Saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(KEY + path) ?? "{}") as Saved; } catch { /* ignore */ }
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = (e: Event) => {
      const el = (e.target instanceof Element ? e.target : document.scrollingElement) as Element | null;
      if (!el) return;
      const sel = selectorOf(el);
      if (!sel) return;
      saved[sel] = sel === DOC ? window.scrollY : (el as HTMLElement).scrollTop;
      if (t) clearTimeout(t);
      t = setTimeout(() => { try { sessionStorage.setItem(KEY + path, JSON.stringify(saved)); } catch { /* ignore */ } }, 150);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      // no final write: when a page unmounts its containers snap to 0 and fire a scroll event; the last REAL position was already saved
      if (t) clearTimeout(t);
    };
  }, [path]);

  // restore, only when arriving by Back/Forward (a fresh link tap should start at the top)
  useEffect(() => {
    const w = window as unknown as { __wraithPop?: number };
    const arrivedByPop = typeof w.__wraithPop === "number" && Date.now() - w.__wraithPop < 2000;
    if (!arrivedByPop) return;
    let saved: Saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(KEY + path) ?? "{}") as Saved; } catch { return; }
    const todo = new Set(Object.keys(saved).filter((k) => saved[k] > 0));
    if (!todo.size) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries++;
      for (const sel of [...todo]) {
        if (sel === DOC) {
          if (document.documentElement.scrollHeight - window.innerHeight >= saved[sel] - 4) { window.scrollTo(0, saved[sel]); todo.delete(sel); }
          continue;
        }
        let els: HTMLElement[] = [];
        try { els = [...document.querySelectorAll<HTMLElement>(sel)]; } catch { todo.delete(sel); continue; }
        const el = els.find((x) => x.scrollHeight - x.clientHeight >= saved[sel] - 4);
        if (el) { el.scrollTop = saved[sel]; todo.delete(sel); }
      }
      if (!todo.size || tries > 40) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [path]);

  // flag Back/Forward so the restore above knows it should run
  useEffect(() => {
    const onPop = () => { (window as unknown as { __wraithPop?: number }).__wraithPop = Date.now(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return null;
}
