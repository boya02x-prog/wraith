import { PrivyClient, type AuthTokenClaims } from "@privy-io/server-auth";

let client: PrivyClient | null = null;

export function getPrivyConfiguration() {
  return {
    appId: Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
    appSecret: Boolean(process.env.PRIVY_APP_SECRET),
  };
}

export function getPrivyClient(): PrivyClient | null {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return null;
  client ??= new PrivyClient(appId, appSecret);
  return client;
}

export async function verifyPrivyAccessToken(
  accessToken: string,
): Promise<AuthTokenClaims | null> {
  const privyClient = getPrivyClient();
  if (!privyClient) return null;
  try {
    return await privyClient.verifyAuthToken(accessToken);
  } catch (error) {
    console.warn("[Privy auth] Rejected invalid access token:", error);
    return null;
  }
}
