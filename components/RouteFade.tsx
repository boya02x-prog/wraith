"use client";

// A short fade when the screen changes (opening a token, a profile, going Back), so pages ease in instead of snapping.
// Opacity only: a transform here would shift fixed elements such as the bottom tab bar while it plays.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function RouteFade() {
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const b = document.body;
    b.classList.remove("wx-enter");
    void b.offsetWidth; // restart the animation if another screen change comes straight after
    b.classList.add("wx-enter");
    const t = window.setTimeout(() => b.classList.remove("wx-enter"), 320);
    return () => window.clearTimeout(t);
  }, [path]);
  return null;
}
