import { NextRequest, NextResponse } from "next/server";
import { getPrivySession, PRIVY_SESSION_COOKIE } from "@/lib/privyAuth";
import { getPrivyClient } from "@/lib/privyServer";
import { isSitePrivate } from "@/lib/siteAccess";
import { verifyPrivyAccessToken } from "@/lib/privyServer";
import { SESSION_DAYS, signSession } from "@/lib/appSession";

export const dynamic = "force-dynamic";

const ownerCache = new Map<string, { at: number; v: boolean }>();
async function isOwnerAccount(userId: string): Promise<boolean> {
  const hit = ownerCache.get(userId);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const owners = `${process.env.QUESTS_ADMIN_EMAILS ?? ""},${process.env.WRAITH_ALLOWED_EMAILS ?? ""}`.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  let v = false;
  if (owners.length) {
    try {
      const pu = await getPrivyClient()?.getUser(userId);
      const mail = (pu?.email?.address ?? pu?.google?.email ?? "").toLowerCase();
      v = !!mail && owners.includes(mail);
    } catch { return false; /* do not cache a failed lookup */ }
  }
  ownerCache.set(userId, { at: Date.now(), v });
  return v;
}

export async function POST(request: NextRequest) {
  // Private mode (see proxy.ts): this endpoint stays reachable so the sign-in page can work, but a stranger who signs in with Google
  // must not get a Wraith account created for them, so only the listed accounts go any further.
  const bearer0 = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const claims0 = bearer0 ? await verifyPrivyAccessToken(bearer0) : null;
  const allowed = (process.env.WRAITH_ALLOWED_USERS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  // Is this the owner? Decided by the sign-in email (Privy verified it): QUESTS_ADMIN_EMAILS or WRAITH_ALLOWED_EMAILS. It is worked out on
  // EVERY sign-in, not only while the site is private, so a session made while the site was open already carries the owner mark and
  // switching to private later cannot lock the owner out. The answer is remembered for 10 minutes per account.
  let ownerLogin = false;
  if (claims0) ownerLogin = await isOwnerAccount(claims0.userId);
  if (await isSitePrivate()) {
    if (!claims0 || (!ownerLogin && !allowed.includes(claims0.userId))) {
      // the id comes from the caller's own signed token, so showing it back to them reveals nothing; it lets the sign-in screen
      // display it, so you can copy exactly that account's id into the allowed list
      return NextResponse.json({ error: "Private", ...(claims0 ? { yourId: claims0.userId } : {}) }, { status: 403 });
    }
  }
  const session = await getPrivySession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The fresh Privy token above proved who this is. From here the browser carries Wraith's own signed session (30 days, renewed on
  // every visit) instead of the raw one-hour Privy token, so opening the app later does not bounce through the sign-in page.
  // See lib/appSession.ts for what that session can and cannot do.
  const bearer = getBearerToken(request);
  const claims = await verifyPrivyAccessToken(bearer);
  const own = claims ? await signSession(claims.userId, Date.now(), ownerLogin) : null;
  const response = NextResponse.json({ ok: true, user: session.user });
  response.cookies.set(PRIVY_SESSION_COOKIE, own ?? bearer, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: own ? SESSION_DAYS * 86_400 : 60 * 60,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PRIVY_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function getBearerToken(request: NextRequest): string {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    throw new Error("The Privy access token was not provided.");
  }
  return token;
}
