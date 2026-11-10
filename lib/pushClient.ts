"use client";

// Browser side of phone notifications: ask permission, subscribe, and tell the server about this device.

import { readTokenFavorites } from "@/lib/tokenFavorites";

export const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type PushPrefs = { trader: boolean; callout: boolean; saved: boolean; signal: boolean };

function key(b64: string) {
  const p = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(p);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushAvailable(): boolean {
  return typeof window !== "undefined" && !!VAPID && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalone(): boolean {
  try { return window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches; } catch { return false; }
}

export function pushPayload(sub: PushSubscription, prefs: PushPrefs) {
  return {
    subscription: sub.toJSON(),
    prefs,
    saved: readTokenFavorites()
      .filter((f) => f.contractAddress && SOL.test(f.contractAddress))
      .map((f) => ({ mint: f.contractAddress, symbol: f.keyword })),
  };
}

/** Asks for permission (Android shows the "Allow notifications?" prompt), subscribes and saves this device. */
export async function enablePush(prefs: PushPrefs, force = false): Promise<"on" | "blocked" | "off"> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && force) { await sub.unsubscribe().catch(() => undefined); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID) as BufferSource });
  const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pushPayload(sub, prefs)) });
  if (!r.ok) throw new Error("save failed");
  return "on";
}
