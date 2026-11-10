import { NextResponse } from "next/server";
import { getPrivyConfiguration } from "@/lib/privyServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = getPrivyConfiguration();
  const missing = [
    !configuration.appId ? "NEXT_PUBLIC_PRIVY_APP_ID" : null,
    !configuration.appSecret ? "PRIVY_APP_SECRET" : null,
  ].filter((key): key is string => key !== null);
  return NextResponse.json({
    configured: missing.length === 0,
    appIdConfigured: configuration.appId,
    appSecretConfigured: configuration.appSecret,
    missing,
  });
}
