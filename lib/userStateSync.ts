// Client side of /api/user/state: restore bell history and saved tokens after a reinstall, and keep the copy fresh.
import { TOKEN_FAVORITES_EVENT, TOKEN_FAVORITES_KEY } from "@/lib/tokenFavorites";

export const NOTIF_KEYS = { items: "wraith_notifs_v1", seen: "wraith_notifs_seen_v1", known: "wraith_notifs_known_v1", base: "wraith_notifs_pxbase_v1" };

const rd = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const wr = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

let timer: ReturnType<typeof setTimeout> | null = null;
let ready = false; // never upload before the restore has run, or an empty fresh install would overwrite the saved copy

export function pushState() {
  if (!ready) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void fetch("/api/user/state", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notifs: { items: rd(NOTIF_KEYS.items, []), seen: rd(NOTIF_KEYS.seen, 0), known: rd(NOTIF_KEYS.known, []), base: rd(NOTIF_KEYS.base, {}) },
        favorites: rd(TOKEN_FAVORITES_KEY, []),
      }),
    }).catch(() => undefined);
  }, 2500);
}

/** Restore from the account when this device has nothing yet. Returns true if it filled something in. */
export async function restoreState(): Promise<boolean> {
  let changed = false;
  try {
    const r = await fetch("/api/user/state", { cache: "no-store" });
    if (r.ok) {
      const d = (await r.json()) as { notifs?: { items?: unknown[]; seen?: number; known?: string[]; base?: object }; favorites?: unknown[] };
      if (d.notifs && rd<unknown[]>(NOTIF_KEYS.items, []).length === 0 && (d.notifs.items?.length ?? 0) > 0) {
        wr(NOTIF_KEYS.items, d.notifs.items); wr(NOTIF_KEYS.seen, d.notifs.seen ?? 0);
        wr(NOTIF_KEYS.known, d.notifs.known ?? []); wr(NOTIF_KEYS.base, d.notifs.base ?? {});
        changed = true;
      }
      if (Array.isArray(d.favorites) && d.favorites.length && rd<unknown[]>(TOKEN_FAVORITES_KEY, []).length === 0) {
        wr(TOKEN_FAVORITES_KEY, d.favorites);
        window.dispatchEvent(new Event(TOKEN_FAVORITES_EVENT));
        changed = true;
      }
      ready = true;
      return changed;
    }
  } catch { /* offline: try again next time */ }
  return changed;
}

export function watchFavorites(): () => void {
  const on = () => pushState();
  window.addEventListener(TOKEN_FAVORITES_EVENT, on);
  return () => window.removeEventListener(TOKEN_FAVORITES_EVENT, on);
}
