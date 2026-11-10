"use client";
// Launch-control state in the browser. One fetch per page load, shared by every component; refreshes every 60s.
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, normalizeSettings, resolveSettings, type LaunchSettings } from "@/lib/launchSettings";

let cached: LaunchSettings | null = null;
let inflight: Promise<LaunchSettings> | null = null;
let fetchedAt = 0;
const listeners = new Set<(s: LaunchSettings) => void>();

function load(force = false): Promise<LaunchSettings> {
  if (!force && cached && Date.now() - fetchedAt < 60_000) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch("/api/settings", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j) => {
      cached = normalizeSettings(j);
      fetchedAt = Date.now();
      listeners.forEach((fn) => fn(cached as LaunchSettings));
      return cached;
    })
    .catch(() => cached ?? DEFAULT_SETTINGS)
    .finally(() => { inflight = null; });
  return inflight;
}

/** Call after the admin saves, so this tab shows the change at once. */
export function refreshLaunchSettings(next?: LaunchSettings) {
  if (next) {
    cached = next;
    fetchedAt = Date.now();
    listeners.forEach((fn) => fn(next));
    return;
  }
  void load(true);
}

export function useLaunchSettings(): { settings: LaunchSettings; ready: boolean } {
  const [s, setS] = useState<LaunchSettings | null>(cached);
  useEffect(() => {
    listeners.add(setS);
    void load().then(setS);
    const t = setInterval(() => void load(), 60_000);
    return () => { listeners.delete(setS); clearInterval(t); };
  }, []);
  // The schedule is applied again here so an auto-launch flips the UI at the exact minute, not on the next fetch.
  return { settings: resolveSettings(s ?? DEFAULT_SETTINGS), ready: s !== null };
}
