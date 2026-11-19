"use client";

// How a screen change feels. On phones, going INTO a screen (opening a token, a profile, the admin) slides the new screen in from the right like a
// sheet, and going BACK (the Back button, the phone's back gesture) slides it in from the left; switching between the main tabs, and any screen
// on a big display, is the short fade. Only the screen itself moves: the top bar and the bottom tab bar are outside it and stay put.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const depth = (p: string) => p.split("/").filter(Boolean).length;

export default function RouteFade() {
  const path = usePathname();
  const first = useRef(true);
  const prev = useRef(path);
  const popped = useRef(false);
  useEffect(() => {
    const onPop = () => { popped.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const was = prev.current;
    prev.current = path;
    if (first.current) { first.current = false; popped.current = false; return; }
    const b = document.body;
    const back = popped.current || depth(path) < depth(was);
    const fwd = !popped.current && depth(path) > depth(was);
    popped.current = false;
    b.classList.remove("wx-enter", "wx-enter-fwd", "wx-enter-back");
    void b.offsetWidth; // restart the animation if another screen change comes straight after
    b.classList.add("wx-enter", fwd ? "wx-enter-fwd" : back ? "wx-enter-back" : "wx-enter-tab");
    const t = window.setTimeout(() => b.classList.remove("wx-enter", "wx-enter-fwd", "wx-enter-back", "wx-enter-tab"), 420);
    return () => window.clearTimeout(t);
  }, [path]);
  return null;
}
