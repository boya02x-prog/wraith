// Tiny stale-while-revalidate store. Lists render instantly from the last response while fresh data loads in the background,
// so switching tabs or coming back to a screen never shows an empty skeleton.
// Memory survives in-app navigation; sessionStorage also survives a reload of the tab.

type Entry = { v: unknown; t: number };
const mem = new Map<string, Entry>();
const PREFIX = "wraith_swr_v1:";
const DEFAULT_MAX_AGE = 30 * 60_000;

/** Memory only: safe to use in the first render of a component that is also server-rendered. */
export function swrPeek<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE): T | undefined {
  const e = mem.get(key);
  return e && Date.now() - e.t < maxAgeMs ? (e.v as T) : undefined;
}

/** Memory first, then sessionStorage. Use in client-only components or inside effects. */
export function swrRead<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE): T | undefined {
  const hit = swrPeek<T>(key, maxAgeMs);
  if (hit !== undefined) return hit;
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const e = JSON.parse(raw) as Entry;
    if (!e || Date.now() - e.t >= maxAgeMs) return undefined;
    mem.set(key, e);
    return e.v as T;
  } catch {
    return undefined;
  }
}

export function swrWrite(key: string, v: unknown): void {
  const e: Entry = { v, t: Date.now() };
  mem.set(key, e);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(e));
  } catch {
    /* storage full or unavailable: memory copy is enough */
  }
}
