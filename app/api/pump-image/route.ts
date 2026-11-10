// GET /api/pump-image?mint=<mint>  ->  { image: string | null }
// pump.fun's API sends no CORS headers, so the browser cannot call it directly; we ask it from the server instead.
import { NextRequest, NextResponse } from "next/server";
import { SOLANA_MINT_RE } from "@/lib/market";

export const dynamic = "force-dynamic";
const cache = new Map<string, { image: string | null; ts: number }>();

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) return NextResponse.json({ image: null }, { status: 400 });
  const hit = cache.get(mint);
  const headers = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
  if (hit && Date.now() - hit.ts < 3600_000) return NextResponse.json({ image: hit.image }, { headers });
  let image: string | null = null;
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      image = typeof data?.image_uri === "string" ? data.image_uri : null;
    }
  } catch { /* leave null */ }
  cache.set(mint, { image, ts: Date.now() });
  if (cache.size > 2000) cache.clear();
  return NextResponse.json({ image }, { headers: image ? headers : { "Cache-Control": "public, s-maxage=60" } });
}
