import { NextResponse } from "next/server";
import { getSolUsd } from "@/lib/marketProviders";

export const dynamic = "force-dynamic";

export async function GET() {
  const solUsd = await getSolUsd();
  return NextResponse.json({ solUsd }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" } });
}
