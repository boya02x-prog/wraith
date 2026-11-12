import { NextRequest, NextResponse } from "next/server";
import { getPrivySession, PRIVY_SESSION_COOKIE } from "@/lib/privyAuth";
import { verifyPrivyAccessToken } from "@/lib/privyServer";
import { SESSION_DAYS, signSession } from "@/lib/appSession";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Private mode (see proxy.ts): this endpoint stays reachable so the sign-in page can work, but a stranger who signs in with Google
  // must not get a Wraith account created for them, so only the listed accounts go any further.
  if (process.env.WRAITH_PRIVATE === "1") {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const claims = bearer ? await verifyPrivyAccessToken(bearer) : null;
    const allowed = (process.env.WRAITH_ALLOWED_USERS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    if (!claims || !allowed.includes(claims.userId)) {
      // the id comes from the caller's own signed token, so showing it back to them reveals nothing; it lets the sign-in screen
      // display it, so you can copy exactly that account's id into the allowed list
      return NextResponse.json({ error: "Private", ...(claims ? { yourId: claims.userId } : {}) }, { status: 403 });
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
  const own = claims ? await signSession(claims.userId) : null;
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
