// Last-known header profile (photo, name, currency) kept in this browser so the header paints the saved photo on the very first
// frame instead of a placeholder while Privy initialises and the profile request is in flight.
// The cache is only a first paint: the server answer always wins as soon as it arrives, and it is wiped on sign-out.

export type HeaderProfile = {
  uid: string | null;
  avatar: string | null; // data URL (uploaded photo) or https URL
  name: string | null;
  username: string | null;
  currency: string | null;
};

const KEY = "wraith_profile_cache_v2";
const LEGACY_AVATAR_KEY = "wraith_avatar_cache_v1";
const MAX_AVATAR_CHARS = 400_000;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function readHeaderProfile(): HeaderProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j: unknown = JSON.parse(raw);
    if (typeof j !== "object" || j === null) return null;
    const o = j as Record<string, unknown>;
    return { uid: str(o.uid), avatar: str(o.avatar), name: str(o.name), username: str(o.username), currency: str(o.currency) };
  } catch {
    return null;
  }
}

export function writeHeaderProfile(p: HeaderProfile): void {
  try {
    const avatar = p.avatar && p.avatar.length <= MAX_AVATAR_CHARS ? p.avatar : null;
    localStorage.setItem(KEY, JSON.stringify({ ...p, avatar }));
    localStorage.removeItem(LEGACY_AVATAR_KEY);
  } catch {
    /* storage full or blocked: the header simply paints a moment later */
  }
}

/**
 * Wipe everything this browser remembered about the signed-in person: photo, name, last balance and the "last good copy"
 * lists. Called on sign-out so a shared device never flashes the previous account. Device settings (PIN, currency, theme) stay.
 */
export function clearUserCaches(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_AVATAR_KEY);
    localStorage.removeItem("wraith_cash_cache_v1");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("wraith_last_")) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("wraith_swr_v1:")) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

let inflight: Promise<HeaderProfile | null> | null = null;

/**
 * One shared request for the light profile. It authenticates with the app session cookie, so it can start the moment the page
 * mounts instead of waiting for the wallet SDK. Concurrent callers (several headers, React strict mode) share one request.
 * Resolves to null when signed out or when the request fails.
 */
export function loadHeaderProfile(): Promise<HeaderProfile | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/user/profile?lite=1", { cache: "no-store", credentials: "same-origin" })
    .then(async (r): Promise<HeaderProfile | null> => {
      if (!r.ok) return null;
      const j: unknown = await r.json();
      if (typeof j !== "object" || j === null) return null;
      const o = j as { profile?: Record<string, unknown>; userId?: unknown };
      const p = o.profile ?? {};
      return {
        uid: str(o.userId),
        avatar: str(p.avatarDataUrl) ?? str(p.avatarUrl),
        name: str(p.displayName),
        username: str(p.username),
        currency: str(p.displayCurrency),
      };
    })
    .catch(() => null)
    .finally(() => {
      // keep the answer for a moment so a second header mounting right after reuses it, then allow a fresh request
      setTimeout(() => { inflight = null; }, 1500);
    });
  return inflight;
}
