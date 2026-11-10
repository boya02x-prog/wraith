import { getPrivySession } from "@/lib/privyAuth";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import {
  getXOAuthConfig,
  X_LINK_STATE_COOKIE,
  X_LINK_VERIFIER_COOKIE,
} from "@/lib/xOAuth";

type XTokenResponse = {
  access_token?: string;
};

type XUserResponse = {
  data?: {
    id?: string;
    username?: string;
    name?: string;
    profile_image_url?: string;
  };
};

function profileRedirect(request: NextRequest, result: string, why?: string) {
  const url = new URL("/app/profile", request.nextUrl.origin);
  url.searchParams.set("x", result);
  if (why) url.searchParams.set("why", why);
  url.hash = "profile-social";
  return NextResponse.redirect(url);
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(X_LINK_STATE_COOKIE);
  response.cookies.delete(X_LINK_VERIFIER_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return clearOAuthCookies(
      NextResponse.redirect(new URL("/login", request.nextUrl.origin)),
    );
  }
  const config = getXOAuthConfig();
  if (!config) {
    return clearOAuthCookies(profileRedirect(request, "not-configured"));
  }

  const search = request.nextUrl.searchParams;
  const code = search.get("code");
  const state = search.get("state");
  const expectedState = request.cookies.get(X_LINK_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(X_LINK_VERIFIER_COOKIE)?.value;
  if (
    search.has("error") ||
    !code ||
    !state ||
    !expectedState ||
    !verifier ||
    state.length !== expectedState.length ||
    !createHash("sha256").update(state).digest().equals(
      createHash("sha256").update(expectedState).digest(),
    )
  ) {
    // "state" cookie missing usually means the redirect came back on a different host than the one that started the link
    return clearOAuthCookies(profileRedirect(request, "failed", search.has("error") ? "denied" : !expectedState || !verifier ? "cookie" : "state"));
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    if (!config.clientSecret) body.set("client_id", config.clientId);
    const headers = new Headers({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    if (config.clientSecret) {
      headers.set("Authorization", `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`);
    }

    const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });
    if (!tokenResponse.ok) {
      console.error("[X OAuth token]", tokenResponse.status, (await tokenResponse.text().catch(() => "")).slice(0, 300));
      return clearOAuthCookies(profileRedirect(request, "failed", `token-${tokenResponse.status}`));
    }
    const tokenPayload = (await tokenResponse.json()) as XTokenResponse;
    if (!tokenPayload.access_token) {
      return clearOAuthCookies(profileRedirect(request, "failed"));
    }

    const accountResponse = await fetch(
      "https://api.x.com/2/users/me?user.fields=profile_image_url",
      {
        headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
        cache: "no-store",
      },
    );
    if (!accountResponse.ok) {
      console.error("[X OAuth account lookup]", accountResponse.status, (await accountResponse.text().catch(() => "")).slice(0, 300));
      return clearOAuthCookies(profileRedirect(request, "failed", `account-${accountResponse.status}`));
    }
    const accountPayload = (await accountResponse.json()) as XUserResponse;
    const xUser = accountPayload.data;
    if (!xUser?.id || !xUser.username || !/^[A-Za-z0-9_]{1,15}$/.test(xUser.username)) {
      return clearOAuthCookies(profileRedirect(request, "failed"));
    }

    const db = await getDb();
    const links = db.collection("x_links");
    await Promise.all([
      links.createIndex({ userId: 1 }, { unique: true }),
      links.createIndex({ usernameLower: 1 }, { unique: true }),
      links.createIndex({ xUserId: 1 }, { unique: true }),
    ]);
    const usernameLower = xUser.username.toLowerCase();
    await links.updateOne(
      { userId: session.user.id },
      {
        $set: {
          userId: session.user.id,
          xUserId: xUser.id,
          username: xUser.username,
          usernameLower,
          profileImageUrl: (xUser.profile_image_url ?? "").replace("_normal.", "_400x400."),
          verifiedAt: new Date(),
        },
      },
      { upsert: true },
    );
    await db.collection("profiles").updateOne(
      { userId: session.user.id },
      { $set: { xHandle: xUser.username, xUserId: xUser.id } },
      { upsert: true },
    );
    // Use the X photo as the avatar for anyone who has not uploaded one.
    const xPhoto = (xUser.profile_image_url ?? "").replace("_normal.", "_400x400.");
    if (xPhoto) {
      await db.collection("profiles").updateOne(
        { userId: session.user.id, $or: [{ avatarDataUrl: { $exists: false } }, { avatarDataUrl: "" }, { avatarDataUrl: null }] },
        { $set: { avatarUrl: xPhoto } },
      );
    }
    return clearOAuthCookies(profileRedirect(request, "connected"));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return clearOAuthCookies(profileRedirect(request, "taken"));
    }
    console.error("[X OAuth callback]", error);
    return clearOAuthCookies(profileRedirect(request, "failed"));
  }
}
