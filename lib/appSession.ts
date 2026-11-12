// lib/appSession.ts  (server only: used by proxy.ts and the API routes)
//
// Wraith's own sign-in cookie.
//
// The cookie used to hold the raw Privy access token, which lives for one hour and was only written when a page loaded. So:
//   - opening the app more than an hour after the last visit bounced you to the sign-in page and back, every time, and
//   - leaving the app open for more than an hour made every data request fail until you reloaded.
//
// Now, once Privy has proved who you are (a fresh access token sent to /api/auth/session), the server hands out its own signed
// session: "this is Privy user X, valid until T". It lasts 30 days and is renewed on every visit, like the session of any normal
// site. It is HMAC-signed with a key only the server has, so it cannot be forged or edited, and it sits in an httpOnly cookie
// that page scripts cannot read.
//
// What it can and cannot do: it lets the server know who is asking (profile, quests, feeds, your own gas top-up). It can NOT move
// funds: every trade is signed in the browser by the Privy wallet, which needs a live Privy login of its own. Logging out deletes
// it, and private mode still checks the user against the allowed list on every request.

const enc = new TextEncoder();
const dec = new TextDecoder();
export const SESSION_DAYS = 30;
const PREFIX = "w1.";

function secret(): string | null {
  return process.env.WRAITH_SESSION_SECRET || process.env.PRIVY_APP_SECRET || null;
}

let keyFor: { secret: string; key: Promise<CryptoKey> } | null = null;
function key(): Promise<CryptoKey> | null {
  const s = secret();
  if (!s) return null;
  if (keyFor?.secret === s) return keyFor.key;
  // derive a key just for sessions, so the Privy secret itself is never used directly as the signing key
  const k = (async () => {
    const root = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const derived = await crypto.subtle.sign("HMAC", root, enc.encode("wraith-app-session-v1"));
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

/** A signed session for this Privy user. null when the server has no secret to sign with (then the old 1-hour cookie is used). */
export async function signSession(userId: string, now = Date.now()): Promise<string | null> {
  const k = key();
  if (!k || !userId) return null;
  const body = b64u(enc.encode(JSON.stringify({ u: userId, e: Math.floor(now / 1000) + SESSION_DAYS * 86_400 })));
  const sig = await crypto.subtle.sign("HMAC", await k, enc.encode(PREFIX + body));
  return `${PREFIX}${body}.${b64u(new Uint8Array(sig))}`;
}

/** Who a session cookie belongs to, or null if it is not one of ours, was edited, or has run out. */
export async function readSession(token: string | null | undefined, now = Date.now()): Promise<{ userId: string; exp: number } | null> {
  if (!token || !token.startsWith(PREFIX)) return null;
  const k = key();
  if (!k) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= PREFIX.length) return null;
  const body = token.slice(PREFIX.length, dot);
  try {
    const ok = await crypto.subtle.verify("HMAC", await k, unb64u(token.slice(dot + 1)), enc.encode(PREFIX + body));
    if (!ok) return null;
    const p = JSON.parse(dec.decode(unb64u(body))) as { u?: unknown; e?: unknown };
    if (typeof p.u !== "string" || !p.u || typeof p.e !== "number" || p.e * 1000 <= now) return null;
    return { userId: p.u, exp: p.e };
  } catch {
    return null;
  }
}

/** True for a cookie in our own format (valid or not): such a cookie is never tried as a Privy token. */
export const isOwnSessionFormat = (token: string) => token.startsWith(PREFIX);
