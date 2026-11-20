// lib/humanGate.ts  (server only: used by proxy.ts, /verify and /api/human)
//
// The "checking that you are human" screen that opens before the app (like the one pump.fun shows), done with Cloudflare Turnstile.
// It switches itself on ONLY when both keys exist in the environment, so nothing changes (and nobody can be locked out) until you add them:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY   the public key of a Turnstile widget (Cloudflare dashboard > Turnstile > Add widget, hostname www.wraith.farm)
//   TURNSTILE_SECRET_KEY             that widget's secret key
// A visitor passes the check once; the server then hands out a signed cookie ("this browser passed at time T") that lasts HUMAN_HOURS. The
// cookie is HMAC-signed with a key only the server has (same idea as lib/appSession.ts), so it cannot be forged or edited.
// Only desktop browsers are asked. Phones (Android and iPhone browsers) and the Android app are never shown it: a phone sees the "download the
// app" screen instead, and Google sign-in in the app hops between the app and Chrome, which the check would break.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const HUMAN_COOKIE = "wraith_human";
export const HUMAN_HOURS = 24;
const PREFIX = "h1.";

export const turnstileSiteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || "";
const turnstileSecret = () => process.env.TURNSTILE_SECRET_KEY || "";
export const humanGateOn = () => Boolean(turnstileSiteKey() && turnstileSecret());

/** A phone, a tablet or the Wraith app: these are never asked (see above). The check is for desktop browsers only. */
export const skipHumanCheck = (userAgent: string | null | undefined) => /Android|iPhone|iPad|iPod|Mobile|WraithApp|Capacitor|CriOS|FxiOS/i.test(userAgent ?? "");

function secret(): string | null {
  return process.env.WRAITH_SESSION_SECRET || process.env.PRIVY_APP_SECRET || null;
}
let keyFor: { secret: string; key: Promise<CryptoKey> } | null = null;
function key(): Promise<CryptoKey> | null {
  const s = secret();
  if (!s) return null;
  if (keyFor?.secret === s) return keyFor.key;
  const k = (async () => {
    const root = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const derived = await crypto.subtle.sign("HMAC", root, enc.encode("wraith-human-gate-v1"));
    return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  })();
  keyFor = { secret: s, key: k };
  return k;
}
const b64u = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A signed "this browser passed the check" cookie value; null when the server has no secret to sign with. */
export async function signHuman(now = Date.now()): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const body = b64u(enc.encode(JSON.stringify({ e: Math.floor(now / 1000) + HUMAN_HOURS * 3600 })));
  const sig = await crypto.subtle.sign("HMAC", await k, enc.encode(PREFIX + body));
  return `${PREFIX}${body}.${b64u(new Uint8Array(sig))}`;
}

/** True when the cookie is ours, untouched and not run out. */
export async function readHuman(token: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !token.startsWith(PREFIX)) return false;
  const k = key();
  if (!k) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= PREFIX.length) return false;
  const body = token.slice(PREFIX.length, dot);
  try {
    if (!(await crypto.subtle.verify("HMAC", await k, unb64u(token.slice(dot + 1)), enc.encode(PREFIX + body)))) return false;
    const p = JSON.parse(dec.decode(unb64u(body))) as { e?: unknown };
    return typeof p.e === "number" && p.e * 1000 > now;
  } catch {
    return false;
  }
}

/** Asks Cloudflare whether the token the widget produced is real. */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secretKey = turnstileSecret();
  if (!secretKey || !token) return false;
  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const d = (await r.json()) as { success?: boolean };
    return d.success === true;
  } catch {
    return false;
  }
}

/** Where to go after the check: only a page inside the app, never an outside address. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !/^\/app(?:[/?#]|$)/.test(next) || next.startsWith("//") || next.includes("\\")) return "/app";
  return next;
}
