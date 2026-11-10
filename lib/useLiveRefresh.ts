"use client";

import { useEffect, useRef } from "react";

export const CALLOUT_POSTED_EVENT = "wraith:callout-posted";

/**
 * Calls `fn` every `ms` while the tab is visible, when the tab regains focus,
 * and right away when something on this page posts a callout.
 */
export function useLiveRefresh(fn: () => void, ms = 8000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const run = () => { if (!document.hidden) ref.current(); };
    const t = setInterval(run, ms);
    const onVis = () => { if (!document.hidden) ref.current(); };
    const onPost = () => ref.current();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener(CALLOUT_POSTED_EVENT, onPost);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener(CALLOUT_POSTED_EVENT, onPost);
    };
  }, [ms]);
}
