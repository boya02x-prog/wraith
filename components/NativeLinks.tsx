"use client";

// Native Android app only. Google sign-in opens in Chrome (Google blocks it inside an app window). When it finishes,
// Chrome sends you back to wraith.farm and Android opens this app with that address. Load it here so the sign-in completes.
import { useEffect } from "react";

type AppPlugin = { addListener: (ev: string, cb: (d: { url?: string }) => void) => Promise<{ remove: () => void }> };
type Cap = { isNativePlatform?: () => boolean; Plugins?: { App?: AppPlugin } };

export default function NativeLinks() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: Cap }).Capacitor;
    const app = cap?.Plugins?.App;
    if (!cap?.isNativePlatform?.() || !app) return;
    let handle: { remove: () => void } | null = null;
    let gone = false;
    void (async () => {
      try {
        const h = await app.addListener("appUrlOpen", ({ url }) => {
          try {
            if (!url) return;
            const u = new URL(url);
            if (u.protocol !== "https:" || !/(^|\.)wraith\.farm$/.test(u.hostname)) return;
            const next = u.pathname + u.search + u.hash;
            if (next !== location.pathname + location.search + location.hash) window.location.assign(next);
          } catch { /* ignore */ }
        });
        if (gone) h.remove(); else handle = h;
      } catch { /* plugin not available */ }
    })();
    return () => { gone = true; handle?.remove(); };
  }, []);
  return null;
}
