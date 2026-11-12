"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * App-style floating bottom navigation for phones (≤767px, CSS-controlled).
 * The five sections of the app, in the same order as the row at the top: Market, Scanner, Wins, Intel, Traders.
 * Market tab uses the Wraith logo as its icon. The round button on the right
 * opens token search. Hidden on the token page, which has its own
 * Chart / Trade / Market bar.
 */
type Item = {
  key: string;
  label: string;
  href: string;
  view?: "market" | "scanner" | "wins" | "intel";
  icon: ReactNode;
};

const stroke = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ITEMS: Item[] = [
  {
    key: "market",
    label: "Market",
    href: "/app",
    view: "market",
    icon: (
      <span className="wx-tab-logo">
        <Image src="/logo.svg" alt="" fill sizes="28px" style={{ objectFit: "contain", mixBlendMode: "screen" }} />
      </span>
    ),
  },
  {
    key: "scanner",
    label: "Scanner",
    href: "/app",
    view: "scanner",
    icon: (
      <svg {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 12l6-6" />
      </svg>
    ),
  },
  {
    key: "wins",
    label: "Wins",
    href: "/app",
    view: "wins",
    icon: (
      <svg {...stroke}>
        <path d="M3 17l6-6 4 4 8-8" />
        <path d="M14 7h7v7" />
      </svg>
    ),
  },
  {
    key: "intel",
    label: "Intel",
    href: "/app",
    view: "intel",
    icon: (
      <svg {...stroke}>
        <path d="M4 5h16v11H9l-5 4V5z" />
        <path d="M8 9h8M8 12h5" />
      </svg>
    ),
  },
  {
    key: "traders",
    label: "Traders",
    href: "/app/traders",
    icon: (
      <svg {...stroke}>
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
        <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
      </svg>
    ),
  },
];

function homeView(): "market" | "scanner" | "wins" | "intel" {
  try {
    const v = localStorage.getItem("wraith_home_view");
    if (v === "scanner" || v === "wins" || v === "intel") return v;
    if (v === "callouts") return "intel";
  } catch {
    /* ignore */
  }
  return "market";
}

export default function MobileTabBar() {
  const path = usePathname() || "";
  // Which section of the home screen is open. The bar is mounted once for the whole app, so it has to LISTEN for changes:
  // it used to read the saved value only when it happened to re-render, which left the highlight on the wrong icon after you
  // switched with the top row (Market / Scanner / Wins / Intel).
  const [view, setView] = useState<"market" | "scanner" | "wins" | "intel">("market");
  useEffect(() => {
    setView(homeView());
    const onView = (e: Event) => {
      const v = (e as CustomEvent).detail;
      setView(v === "scanner" || v === "wins" || v === "intel" ? v : v === "callouts" ? "intel" : "market");
    };
    window.addEventListener("wraith:view", onView);
    window.addEventListener("wraith:view-changed", onView);
    return () => { window.removeEventListener("wraith:view", onView); window.removeEventListener("wraith:view-changed", onView); };
  }, []);
  useEffect(() => { if (path === "/app") setView(homeView()); }, [path]);

  const hidden = path.startsWith("/app/token");
  const onHome = path === "/app";
  const activeKey = onHome
    ? view
    : path.startsWith("/app/traders")
      ? "traders"
      : path.startsWith("/app/profile")
        ? "profile"
        : "";

  // the highlight is one pill that slides to the active icon instead of jumping
  const pillRef = useRef<HTMLElement | null>(null);
  const [ind, setInd] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const measure = useCallback(() => {
    const el = pillRef.current?.querySelector<HTMLElement>("a.on");
    if (!el || !el.offsetWidth) { setInd(null); return; }
    setInd({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  }, []);
  useLayoutEffect(() => { measure(); }, [measure, activeKey, hidden]);
  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(true), 60); // no slide-in from the corner on first paint
    window.addEventListener("resize", measure);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [measure]);

  if (hidden) return null;

  const pick = (it: Item) => {
    if (!it.view) return;
    setView(it.view); // move the highlight at once, before the screen has switched
    try {
      localStorage.setItem("wraith_home_view", it.view);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("wraith:view", { detail: it.view }));
  };

  return (
    <div className="wx-tabbar" role="presentation">
      <nav className={`wx-tabbar-pill${ind ? " has-ind" : ""}`} aria-label="Main" ref={pillRef}>
        {ind && <i className={`wx-tab-ind${animate ? " slide" : ""}`} aria-hidden="true" style={{ width: ind.w, height: ind.h, transform: `translate(${ind.x}px, ${ind.y}px)` }} />}
        {ITEMS.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={activeKey === it.key ? "on" : ""}
            aria-label={it.label}
            aria-current={activeKey === it.key ? "page" : undefined}
            onClick={() => pick(it)}
          >
            {it.icon}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        className="wx-tabbar-search"
        aria-label="Search tokens"
        onClick={() => window.dispatchEvent(new CustomEvent("wraith:open-search"))}
      >
        <svg {...stroke} width={24} height={24}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      </button>
    </div>
  );
}
