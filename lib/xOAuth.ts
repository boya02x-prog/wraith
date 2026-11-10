import { createHash, randomBytes } from "node:crypto";

export const X_LINK_STATE_COOKIE = "wraith_x_link_state";
export const X_LINK_VERIFIER_COOKIE = "wraith_x_link_verifier";

export function getXOAuthConfig() {
  const clientId = process.env.X_OAUTH_CLIENT_ID;
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  if (!clientId) return null;
  return {
    clientId,
    clientSecret: process.env.X_OAUTH_CLIENT_SECRET,
    redirectUri:
      process.env.X_OAUTH_CALLBACK_URL ||
      new URL("/api/user/x-account/callback", configuredBaseUrl).toString(),
  };
}

export function createOAuthValue(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url") as string;
}
