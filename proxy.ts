import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyAccessToken } from "@/lib/privyServer";
import { isOwnSessionFormat, readSession } from "@/lib/appSession";

const PUBLIC_PATHS = new Set(["/login", "/", "/privacy", "/terms"]);
const PUBLIC_API_PATHS = new Set(["/api/native-prices", "/api/landing", "/api/banner", "/api/settings"]);
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
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
  if (!token) return null;
  const own = await readSession(token);
  if (own) return own.userId;
  if (isOwnSessionFormat(token)) return null; // ours, but edited or expired
  return (await verifyPrivyAccessToken(token))?.userId ?? null;
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

  const hasSession = Boolean(await sessionUser(request.cookies.get(PRIVY_SESSION_COOKIE)?.value));
  if (PUBLIC_PATHS.has(pathname)) {
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
const privateOn = () => process.env.WRAITH_PRIVATE === "1";
const allowedIds = () => new Set((process.env.WRAITH_ALLOWED_USERS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
const PRIVATE_OPEN_PREFIXES = ["/api/auth/", "/api/cron/", "/api/telegram/bot", "/api/telegram/setup", "/_next/", "/.well-known/"];
const PRIVATE_OPEN_PATHS = new Set(["/login", "/privacy", "/terms", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/offline.html"]);
const NO_INDEX = "noindex, nofollow, noarchive";
const PRIVATE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${NO_INDEX}"><title>Private</title><style>html,body{height:100%;margin:0;background:#0c0c0d;color:#ededee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}body{display:grid;place-items:center;text-align:center;padding:24px}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#a1a1a6;font-size:14px;line-height:1.5}</style></head><body><main><h1>This site is private right now</h1><p>Check back soon.</p></main></body></html>`;

async function privateGate(request: NextRequest): Promise<NextResponse | null> {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/robots.txt") return new NextResponse(["User-agent: *", "Disallow: /", ""].join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": NO_INDEX } });
  if (PRIVATE_OPEN_PATHS.has(pathname) || PRIVATE_OPEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  const userId = await sessionUser(request.cookies.get(PRIVY_SESSION_COOKIE)?.value);
  const claims = userId ? { userId } : null;
  if (claims && allowedIds().has(claims.userId)) return null; // you, or someone you listed
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
  if (!privateOn()) return route(request);
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
