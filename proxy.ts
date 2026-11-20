import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyAccessToken } from "@/lib/privyServer";
import { isOwnSessionFormat, readSession } from "@/lib/appSession";
import { isSitePrivate } from "@/lib/siteAccess";
import { HUMAN_COOKIE, humanGateOn, readHuman, skipHumanCheck } from "@/lib/humanGate";

const PUBLIC_PATHS = new Set(["/login", "/", "/privacy", "/terms", "/docs", "/verify"]);
const PUBLIC_PAGE_PREFIXES = ["/docs/"]; // the documentation: one page per topic, readable without an account
const PUBLIC_API_PATHS = new Set(["/api/native-prices", "/api/landing", "/api/banner", "/api/settings"]);
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/human", // the "are you human" check (lib/humanGate.ts)
  "/api/telegram/bot",
  "/api/telegram/setup", // protected by TELEGRAM_SETUP_KEY inside the route
  "/api/cron/", // protected by CRON_SECRET inside the route
  "/api/traders/search",
  "/api/user/username/check",
  "/api/callouts",
];
const PRIVY_SESSION_COOKIE = "wraith_privy_session";

/**
 * Who the sign-in cookie belongs to (their Privy user id), or null. The cookie is Wraith's own signed 30-day session
 * (lib/appSession.ts); one written before that existed holds a raw Privy token and is honoured until it runs out.
 */
async function sessionUser(token: string | undefined): Promise<string | null> {
  return (await sessionInfo(token))?.userId ?? null;
}
async function sessionInfo(token: string | undefined): Promise<{ userId: string; owner: boolean } | null> {
  if (!token) return null;
  const own = await readSession(token);
  if (own) return { userId: own.userId, owner: own.owner };
  if (isOwnSessionFormat(token)) return null; // ours, but edited or expired
  const raw = (await verifyPrivyAccessToken(token))?.userId;
  return raw ? { userId: raw, owner: false } : null;
}

async function route(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/sitemap.xml" || pathname === "/og.png" || pathname === "/manifest.webmanifest" || pathname === "/sw.js" || pathname === "/offline.html" || pathname.startsWith("/.well-known/") || pathname.startsWith("/downloads/")) {
    return NextResponse.next();
  }

  if (
    PUBLIC_API_PATHS.has(pathname) ||
    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  // "Checking that you are human" before the app opens (Cloudflare Turnstile). Off until the two keys exist (lib/humanGate.ts); desktop browsers only.
  if ((pathname === "/app" || pathname.startsWith("/app/")) && request.method === "GET" && humanGateOn() && !skipHumanCheck(request.headers.get("user-agent"))) {
    if (!(await readHuman(request.cookies.get(HUMAN_COOKIE)?.value))) {
      const to = new URL("/verify", request.url);
      to.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(to);
    }
  }

  const hasSession = Boolean(await sessionUser(request.cookies.get(PRIVY_SESSION_COOKIE)?.value));
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (pathname === "/login" && hasSession) {
      return NextResponse.redirect(new URL("/app", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// ── PRIVATE MODE ─────────────────────────────────────────────────────────────────────────────────────────────
// WRAITH_PRIVATE=1 hides the whole site while you are not ready to show it. Strangers get a plain "private" page (HTTP 403) on every
// address, search engines are told to ignore everything, and only the accounts listed in WRAITH_ALLOWED_USERS (Privy user ids, comma
// separated, e.g. did:privy:abc123) can get past the sign-in page. Left reachable on purpose: the sign-in page and its endpoints (or
// nobody could ever log in), the cron jobs and the Telegram bot (they carry their own secrets), the privacy and terms pages (Google
// sign-in needs them public) and the app's icon and service-worker files. Off by default; remove the variable to open the site again.
const privateOn = () => isSitePrivate();
const allowedIds = () => new Set((process.env.WRAITH_ALLOWED_USERS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
const PRIVATE_OPEN_PREFIXES = ["/api/auth/", "/api/cron/", "/api/telegram/bot", "/api/telegram/setup", "/api/banner", "/_next/", "/.well-known/"];
const PRIVATE_OPEN_PATHS = new Set(["/login", "/privacy", "/terms", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/offline.html"]);
const NO_INDEX = "noindex, nofollow, noarchive";
const PRIVATE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${NO_INDEX}"><title>Wraith - under construction</title><style>html,body{height:100%;margin:0;background:#050506;color:#ededee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}body{display:grid;place-items:center;text-align:center;padding:24px;background:radial-gradient(60% 45% at 50% 42%,rgba(255,122,48,.12),transparent 70%),#050506}img{width:64px;height:auto;filter:drop-shadow(0 0 18px rgba(255,122,48,.7));animation:f 2.4s ease-in-out infinite}h1{font-size:22px;margin:18px 0 8px;letter-spacing:.02em}p{margin:0;color:#a1a1a6;font-size:14px;line-height:1.6;max-width:320px}.t{display:inline-block;margin-top:18px;padding:6px 12px;border:1px solid rgba(255,122,48,.4);border-radius:999px;color:#ffb48a;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em}@keyframes f{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}@media(prefers-reduced-motion:reduce){img{animation:none}}</style></head><body><main><img src="/logo.svg" alt=""><h1>Wraith is under construction</h1><p>We are building something big. The scanner is running and working hard in the background. Come back soon.</p><span class="t">COMING SOON</span></main></body></html>`;

async function privateGate(request: NextRequest): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/robots.txt") return new NextResponse(["User-agent: *", "Disallow: /", ""].join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": NO_INDEX } });
  if (PRIVATE_OPEN_PATHS.has(pathname) || PRIVATE_OPEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  const info = await sessionInfo(request.cookies.get(PRIVY_SESSION_COOKIE)?.value);
  const claims = info ? { userId: info.userId } : null;
  if (info && (info.owner || allowedIds().has(info.userId))) return null; // the owner (admin email), or someone you listed
  const headers = { "x-robots-tag": NO_INDEX, "cache-control": "no-store" };
  const isApi = pathname.startsWith("/api/");
  if (!claims) {
    // Not signed in, or the sign-in cookie has run out. Answer exactly as the normal app does, so the APK and the
    // browser can sign back in silently through the sign-in page; a stranger just lands on a sign-in page they cannot get past.
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl, { headers });
    }
  }
  // signed in but not on the list, or a page nobody without a login should see
  if (isApi) return NextResponse.json({ error: "Private" }, { status: 403, headers });
  return new NextResponse(PRIVATE_PAGE, { status: 403, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

export async function proxy(request: NextRequest) {
  if (!(await privateOn())) return route(request);
  // Private mode and a session that is not marked as the owner (for example one made before this mark existed): do NOT bounce /login to
  // /app (that would show the construction page forever). Let the sign-in page load, so signing in again refreshes the session and marks it.
  if (request.nextUrl.pathname === "/login") {
    const info = await sessionInfo(request.cookies.get(PRIVY_SESSION_COOKIE)?.value);
    if (info && !info.owner && !allowedIds().has(info.userId)) {
      const res = NextResponse.next();
      res.headers.set("x-robots-tag", NO_INDEX);
      return res;
    }
  }
  const blocked = await privateGate(request);
  if (blocked) return blocked;
  const res = await route(request);
  res.headers.set("x-robots-tag", NO_INDEX);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*)",
  ],
};
