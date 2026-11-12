"use client";
// Owner-only street theme. Asks the server whether this account is the owner (/api/admin/me); everybody else never even
// requests the stylesheet. The owner's choice (on/off) lives in localStorage and is flipped from the profile menu.
import { useEffect } from "react";

const KEY = "wraith_street";
export const STREET_EVENT = "wraith-street-toggle";

export function readStreet(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function toggleStreet(): boolean {
  const on = !readStreet();
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(STREET_EVENT));
  return on;
}

export default function StreetTheme() {
  useEffect(() => {
    let owner = false;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/api/admin/street/css";
    const apply = () => {
      if (owner && readStreet()) {
        document.documentElement.setAttribute("data-street", "");
        if (!link.isConnected) document.head.appendChild(link);
      } else {
        document.documentElement.removeAttribute("data-street");
        link.remove();
      }
    };
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { isAdmin?: boolean }) => { owner = !!d.isAdmin; apply(); })
      .catch(() => undefined);
    window.addEventListener(STREET_EVENT, apply);
    return () => {
      window.removeEventListener(STREET_EVENT, apply);
      link.remove();
      document.documentElement.removeAttribute("data-street");
    };
  }, []);
  return null;
}
