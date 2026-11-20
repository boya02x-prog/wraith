"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Menu, Search, X } from "lucide-react";
import DocsSearch, { type NavGroup } from "./DocsSearch";

/** The frame around every docs page: top bar, the menu on the left (a sheet on phones), the search box, and the page itself. */
export default function DocsShell({ nav, children }: { nav: NavGroup[]; children: ReactNode }) {
  const path = usePathname() || "";
  // the sheet remembers which page it was opened on, so going to another page closes it without an effect
  const [openAt, setOpenAt] = useState<string | null>(null);
  const menu = openAt === path;
  const setMenu = (v: boolean) => setOpenAt(v ? path : null);
  const [find, setFind] = useState(false);
  const sideRef = useRef<HTMLElement>(null);

  // Ctrl/Cmd + K or "/" opens the search from anywhere; the home page's big search button asks for it with an event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setFind((v) => !v); }
      else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setFind(true); }
      else if (e.key === "Escape") setOpenAt(null);
    };
    const onAsk = () => setFind(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wraith:docs-search", onAsk);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("wraith:docs-search", onAsk); };
  }, []);

  // the sheet does not let the page behind scroll
  useEffect(() => {
    if (!menu) return;
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = was; };
  }, [menu]);

  // keep the page you are on in view inside the menu
  useEffect(() => {
    const box = sideRef.current;
    const on = box?.querySelector<HTMLElement>("a.on");
    if (box && on) box.scrollTop = Math.max(0, on.offsetTop - box.clientHeight / 2);
  }, [path, menu]);

  const slug = path.startsWith("/docs/") ? path.slice(6).split("/")[0] : "";

  return (
    <div className="dx">
      <a href="#dx-main" className="dx-skip">Skip to the page</a>

      <header className="dx-bar">
        <button type="button" className="dx-menu" aria-label="Open the menu" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={20} /></button>
        <Link href="/docs" className="dx-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={26} height={26} />
          <b>Wraith</b>
          <span>Docs</span>
        </Link>
        <button type="button" className="dx-find-btn" onClick={() => setFind(true)} aria-label="Search the docs">
          <Search size={16} aria-hidden="true" />
          <span>Search the docs</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="dx-links" aria-label="Wraith">
          <Link href="/" className="site">Website</Link>
          <Link href="/app" className="dx-cta">Open app</Link>
        </nav>
      </header>

      <div className={`dx-scrim${menu ? " on" : ""}`} onClick={() => setMenu(false)} aria-hidden="true" />
      <aside ref={sideRef} className={`dx-side${menu ? " open" : ""}`} aria-label="Documentation menu">
        <div className="dx-side-top">
          <Link href="/docs" className="dx-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={26} height={26} />
            <b>Wraith</b>
            <span>Docs</span>
          </Link>
          <button type="button" className="dx-x" aria-label="Close the menu" onClick={() => setMenu(false)}><X size={20} /></button>
        </div>
        <nav>
          {nav.map((g) => (
            <section key={g.group}>
              <h2>{g.group}</h2>
              <ul>
                {g.items.map((it) => (
                  <li key={it.slug}>
                    <Link href={`/docs/${it.slug}`} className={it.slug === slug ? "on" : undefined} aria-current={it.slug === slug ? "page" : undefined}>{it.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      <main id="dx-main" className="dx-main">{children}</main>

      {find && <DocsSearch onClose={() => setFind(false)} nav={nav} />}
    </div>
  );
}
