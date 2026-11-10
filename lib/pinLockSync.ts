"use client";

// App-lock PIN: salted PBKDF2 hash kept in localStorage for the instant lock screen, and mirrored to the account
// (/api/user/lock) so the SAME PIN works on every device. Old PINs (plain SHA-256, no salt) still unlock the device they were set on.

export const PIN_HASH_KEY = "wraith_pin_hash";
export const PIN_ENABLED_KEY = "wraith_pin_enabled";
export const PIN_TIMEOUT_KEY = "wraith_pin_timeout_ms";
export const PIN_SALT_KEY = "wraith_pin_salt";

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export function newSalt(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  b.forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** salt given: PBKDF2-SHA256 (150k rounds). No salt: the legacy unsalted SHA-256 used before accounts synced the PIN. */
export async function hashPin(pin: string, salt?: string | null): Promise<string> {
  const enc = new TextEncoder();
  if (!salt) return hex(await crypto.subtle.digest("SHA-256", enc.encode("wraith-pin-v1:" + pin)));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 150_000 }, key, 256));
}

export function storedSalt(): string | null {
  try { return localStorage.getItem(PIN_SALT_KEY); } catch { return null; }
}

export function saveLocalPin(hash: string, salt: string, timeoutMs?: number) {
  try {
    localStorage.setItem(PIN_HASH_KEY, hash);
    localStorage.setItem(PIN_SALT_KEY, salt);
    localStorage.setItem(PIN_ENABLED_KEY, "true");
    if (typeof timeoutMs === "number") localStorage.setItem(PIN_TIMEOUT_KEY, String(timeoutMs));
  } catch { /* storage blocked */ }
}

export function clearLocalPin() {
  try {
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    localStorage.setItem(PIN_ENABLED_KEY, "false");
  } catch { /* storage blocked */ }
}

const send = (method: string, body?: unknown) =>
  fetch("/api/user/lock", { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }).catch(() => null);

export const pushLockPin = (hash: string, salt: string, timeoutMs: number) => send("PUT", { hash, salt, timeoutMs });
export const pushLockTimeout = (timeoutMs: number) => send("PUT", { timeoutMs });
export const clearServerPin = () => send("DELETE");

/**
 * Signed-in start-up sync. The account's PIN wins on every device; if the account has none yet and this device has a
 * salted one, it becomes the account's. Returns true when the local lock settings changed.
 */
export async function syncLockFromAccount(): Promise<boolean> {
  try {
    const res = await fetch("/api/user/lock", { cache: "no-store" });
    if (!res.ok) return false;
    const { pin } = (await res.json()) as { pin: { hash: string; salt: string; timeoutMs: number } | null };
    if (pin) {
      const changed = localStorage.getItem(PIN_HASH_KEY) !== pin.hash || localStorage.getItem(PIN_ENABLED_KEY) !== "true";
      saveLocalPin(pin.hash, pin.salt, pin.timeoutMs);
      return changed;
    }
    const hash = localStorage.getItem(PIN_HASH_KEY);
    const salt = localStorage.getItem(PIN_SALT_KEY);
    if (hash && salt && localStorage.getItem(PIN_ENABLED_KEY) === "true") {
      await pushLockPin(hash, salt, parseInt(localStorage.getItem(PIN_TIMEOUT_KEY) ?? "300000", 10));
    }
  } catch { /* offline: keep what this device has */ }
  return false;
}
