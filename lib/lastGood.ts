// Remember the last good copy of a piece of data so the screen never goes blank or shows "Failed to fetch" when the phone
// drops offline: the app keeps showing what it had and quietly refreshes when the connection is back.
const PREFIX = "wraith_last_";

export function readLast<T>(key: string, maxAgeMs = 24 * 3600_000): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const j = JSON.parse(raw) as { at: number; v: T };
    if (!j || typeof j.at !== "number" || Date.now() - j.at > maxAgeMs) return null;
    return j.v;
  } catch {
    return null;
  }
}

export function writeLast(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v: value }));
  } catch {
    /* storage full or blocked: the app works without it */
  }
}

/** True while the browser reports no connection. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
