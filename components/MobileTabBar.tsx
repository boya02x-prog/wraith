"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * App-style floating bottom navigation for phones (≤767px, CSS-controlled).
 * Market tab uses the Wraith logo as its icon. The round button on the right
 * opens token search. Hidden on the token page, which has its own
 * Chart / Trade / Market bar.
 */
type Item = {
  key: string;
  label: string;
  href: string;
  view?: "market" | "scanner" | "intel";
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
  if (path.startsWith("/app/token")) return null;

  const onHome = path === "/app";
  const activeKey = onHome
    ? (typeof window !== "undefined" ? (homeView() === "scanner" ? "scanner" : homeView() === "intel" ? "intel" : "market") : "market")
    : path.startsWith("/app/traders")
      ? "traders"
      : path.startsWith("/app/profile")
        ? "profile"
        : "";

  const pick = (it: Item) => {
    if (!it.view) return;
    try {
      localStorage.setItem("wraith_home_view", it.view);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("wraith:view", { detail: it.view }));
  };

  return (
    <div className="wx-tabbar" role="presentation">
      <nav className="wx-tabbar-pill" aria-label="Main">
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
