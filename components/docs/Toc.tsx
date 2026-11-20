"use client";

import { useEffect, useState } from "react";
import type { Heading } from "@/lib/docs/headings";

/** "On this page": the list of headings on the right of a wide screen, with the one you are reading marked. */
export default function Toc({ heads }: { heads: Heading[] }) {
  const [active, setActive] = useState("");

  useEffect(() => {
    if (!heads.length) return;
    const els = heads.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    let raf = 0;
    const pick = () => {
      raf = 0;
      // the current heading is the last one that has scrolled up to just under the top bar (none yet while you are still in the intro)
      let cur = "";
      for (const el of els) {
        if (el.getBoundingClientRect().top <= 120) cur = el.id;
        else break;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 6) cur = els[els.length - 1].id;
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [heads]);

  if (heads.length < 2) return null;
  return (
    <aside className="dx-toc" aria-label="On this page">
      <p>On this page</p>
      <ul>
        {heads.map((h) => (
          <li key={h.id} className={h.level === 3 ? "sub" : undefined}>
            <a href={`#${h.id}`} className={h.id === active ? "on" : undefined} aria-current={h.id === active ? "location" : undefined}>{h.text}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
