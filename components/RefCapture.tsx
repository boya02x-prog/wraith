"use client";
// Remembers an invite code from ?ref=CODE for 30 days, so the account created afterwards is credited to the friend who shared it.
import { useEffect } from "react";

export default function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^[A-Za-z0-9]{5,12}$/.test(ref) && !document.cookie.includes("wr_ref=")) {
        document.cookie = `wr_ref=${ref.toUpperCase()}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax; Secure`;
      }
    } catch { /* cookies blocked: invite just won't be credited */ }
  }, []);
  return null;
}
