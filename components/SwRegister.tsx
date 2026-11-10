"use client";

import { useEffect } from "react";

// Registers the service worker on every visit so the offline page works even if push was never enabled.
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
