"use client";

// How a screen change feels. On phones, going INTO a screen (opening a token, a profile, the admin) slides the new screen in from the right like a
// sheet, and going BACK (the Back button, the phone's back gesture) slides it in from the left. Switching between the main tabs (Market, Scanner, Wins,
// Intel, Traders) is always the same short ease-in, whichever tab you leave and whichever you open: those screens ease themselves in (see wx-tab-in in
// wraith-compact.css), so nothing is added here for them. Only the screen itself moves: the top bar and the bottom tab bar are outside it and stay put.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { takeTabTap } from "@/lib/tabNav";

const depth = (p: string) => p.split("/").filter(Boolean).length;
/** the screens of the tab bar: they ease in on their own */
const tabScreen = (p: string) => p === "/app" || p === "/app/traders";
/** the top-level screens (the tab bar's two, plus the ones the avatar menu opens) */
const mainScreen = (p: string) => tabScreen(p) || p === "/app/profile" || p === "/app/quests";

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
    // a tab bar tap, or one top-level screen to another, is a tab switch: never a slide
    const tab = takeTabTap(path) || (mainScreen(was) && mainScreen(path));
    const back = !tab && (popped.current || depth(path) < depth(was));
    const fwd = !tab && !popped.current && depth(path) > depth(was);
    popped.current = false;
    b.classList.remove("wx-enter", "wx-enter-fwd", "wx-enter-back", "wx-enter-tab");
    void b.offsetWidth; // restart the animation if another screen change comes straight after
    if (tab && tabScreen(path)) return; // the screen eases itself in
    b.classList.add("wx-enter", fwd ? "wx-enter-fwd" : back ? "wx-enter-back" : "wx-enter-tab");
    const t = window.setTimeout(() => b.classList.remove("wx-enter", "wx-enter-fwd", "wx-enter-back", "wx-enter-tab"), 420);
    return () => window.clearTimeout(t);
  }, [path]);
  return null;
}
