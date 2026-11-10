"use client";

// Fingerprint / face / screen-lock helpers (WebAuthn platform authenticator).
// They let the existing passcode screen ("The veil is down") be opened with the phone's fingerprint instead of typing the passcode.


const KEY = "wraith_applock_v1";
const LOCK_AFTER_MS = 30_000; // locks again after being in the background this long

interface Stored { id: string; on: boolean }

function b64e(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64d(s: string) {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** The lock only applies inside the installed app (APK / home-screen app), never in a normal browser tab. */
export function isInstalledApp(): boolean {
  try {
    if (document.referrer.startsWith("android-app://")) sessionStorage.setItem("wx_app", "1");
    return (
      /WraithApp/.test(navigator.userAgent) || // the native Android app (Capacitor) adds this to its user agent
      sessionStorage.getItem("wx_app") === "1" ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)").matches
    );
  } catch {
    return false;
  }
}
function load(): Stored | null {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Stored) : null; } catch { return null; }
}
function save(v: Stored | null) {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* blocked */ }
  window.dispatchEvent(new Event("wraith:applock-changed"));
}
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// Inside the Android app the phone's own fingerprint / face prompt is used (Capacitor biometric plugin). A WebAuthn
// prompt does not exist inside an app window, which is why this was dead there before.
type BioPlugin = {
  checkBiometry: () => Promise<{ isAvailable: boolean }>;
  authenticate: (o?: Record<string, unknown>) => Promise<void>;
};
function nativeBio(): BioPlugin | null {
  try {
    const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, { checkBiometry: () => Promise<{ isAvailable: boolean }>; internalAuthenticate: (o?: Record<string, unknown>) => Promise<void> } | undefined> } }).Capacitor;
    const n = c?.isNativePlatform?.() ? c.Plugins?.BiometricAuthNative : undefined;
    if (!n) return null;
    return { checkBiometry: () => n.checkBiometry(), authenticate: (o) => n.internalAuthenticate(o) };
  } catch { return null; }
}
async function nativeVerify(reason: string): Promise<boolean> {
  const p = nativeBio();
  if (!p) return false;
  try {
    await p.authenticate({ reason, cancelTitle: "Use PIN", allowDeviceCredential: true, androidTitle: "Unlock Wraith", androidSubtitle: reason });
    return true;
  } catch { return false; }
}

export function appLockSupported() {
  if (typeof window === "undefined") return false;
  if (nativeBio()) return true;
  return !!window.PublicKeyCredential && !!navigator.credentials;
}

async function verify(id: string) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      allowCredentials: [{ id: b64d(id) as BufferSource, type: "public-key", transports: ["internal"] }],
      userVerification: "required",
      timeout: 60_000,
    },
  });
  return !!cred;
}

export async function enableAppLock(): Promise<boolean> {
  if (!appLockSupported()) throw new Error("This device does not support biometric lock.");
  const native = nativeBio();
  if (native) {
    const info = await native.checkBiometry().catch(() => ({ isAvailable: false }));
    if (!info.isAvailable) throw new Error("Set up a fingerprint, face or screen lock in your phone's settings first.");
    if (!(await nativeVerify("Confirm it is you to turn on unlock"))) return false; // prove it works before turning it on
    save({ id: "native", on: true });
    return true;
  }
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Wraith", id: location.hostname },
      user: { id: rand(16), name: "wraith-app-lock", displayName: "Wraith app lock" },
      challenge: rand(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  const id = b64e(cred.rawId);
  if (!(await verify(id))) return false; // prove it works before turning it on
  save({ id, on: true });
  return true;
}

export function disableAppLock() { save(null); }
export function appLockEnabled() { return !!load()?.on; }

/** Is a fingerprint / face credential registered on this device? */
export function biometricReady(): boolean {
  return appLockSupported() && !!load()?.on;
}

/** Ask the phone for fingerprint / face / screen lock. Resolves true when the owner is verified. */
export async function biometricVerify(): Promise<boolean> {
  const s = load();
  if (!s?.on) return false;
  if (s.id === "native") return nativeVerify("Unlock Wraith");
  // The page asks the phone for the fingerprint before React loads (see layout), so the prompt is already up.
  const w = window as unknown as { __wxBio?: Promise<Credential | null> };
  const early = w.__wxBio;
  if (early) {
    delete w.__wxBio;
    try { return !!(await early); } catch { return false; }
  }
  try { return await verify(s.id); } catch { return false; }
}
