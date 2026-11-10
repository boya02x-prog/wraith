import { getPrivySession } from "@/lib/privyAuth";
import { NextRequest, NextResponse } from "next/server";
import {
  createCodeChallenge,
  createOAuthValue,
  getXOAuthConfig,
  X_LINK_STATE_COOKIE,
  X_LINK_VERIFIER_COOKIE,
} from "@/lib/xOAuth";

export async function GET(request: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = getXOAuthConfig();
  if (!config) {
    return NextResponse.json(
      { error: "X account linking is not configured on this server." },
      { status: 503 },
    );
  }

  const state = createOAuthValue();
  const verifier = createOAuthValue(48);
  const authorizeUrl = new URL("https://x.com/i/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", "tweet.read users.read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", createCodeChallenge(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizeUrl);
  const secure = config.redirectUri.startsWith("https://");
  for (const [name, value] of [
    [X_LINK_STATE_COOKIE, state],
    [X_LINK_VERIFIER_COOKIE, verifier],
  ]) {
    response.cookies.set(name, value, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/api/user/x-account",
      maxAge: 600,
    });
  }
  return response;
}
