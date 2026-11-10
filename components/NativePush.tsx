"use client";

// Native Android app only (Capacitor). Asks for notification permission, gets the Firebase token from the app's own
// push plugin and hands it to FcmLink (same storage key the old app used), which links it to the signed-in account.
import { useEffect } from "react";

type PushPlugin = {
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  createChannel?: (c: { id: string; name: string; importance: number }) => Promise<void>;
  addListener: (ev: string, cb: (d: { value?: string; notification?: { data?: { url?: string } } }) => void) => Promise<unknown>;
};
type Cap = { isNativePlatform?: () => boolean; Plugins?: { PushNotifications?: PushPlugin } };

export default function NativePush() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: Cap }).Capacitor;
    const push = cap?.Plugins?.PushNotifications;
    // "WraithPush" is in the app's user agent only when the build has Firebase set up. Without it, registering crashes the app.
    if (!cap?.isNativePlatform?.() || !push || !/WraithPush/.test(navigator.userAgent)) return;
    // ask for notifications once you are inside the app, not on the sign-in screen
    if (!location.pathname.startsWith("/app")) return;
    let off = false;
    void (async () => {
      try {
        await push.addListener("registration", (t) => {
          if (off || !t.value) return;
          try {
            if (localStorage.getItem("wraith_fcm_token") !== t.value) localStorage.removeItem("wraith_fcm_linked");
            localStorage.setItem("wraith_fcm_token", t.value);
            localStorage.removeItem("wraith_fcm_off");
          } catch { /* blocked */ }
          window.dispatchEvent(new Event("wraith:fcm-relink"));
        });
        await push.addListener("registrationError", () => undefined);
        // tapping a notification opens the page it is about
        await push.addListener("pushNotificationActionPerformed", (a) => {
          const url = a.notification?.data?.url;
          if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && url !== location.pathname + location.search) window.location.assign(url);
        });
        await push.createChannel?.({ id: "wraith", name: "Wraith alerts", importance: 4 }).catch(() => undefined);
        const p = await push.requestPermissions();
        if (p.receive === "granted") await push.register();
      } catch { /* Firebase not configured in this build */ }
    })();
    return () => { off = true; };
  }, []);
  return null;
}
