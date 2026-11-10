import { NextRequest, NextResponse } from "next/server";
import { safeFetchImage } from "@/lib/safeFetch";

/**
 * GET /api/proxy-img?url=<encoded-url>
 *
 * Proxies an external image through the Next.js server so html2canvas can capture it without CORS problems.
 * Hardened: public hosts only (no localhost / private / cloud-metadata addresses), redirects re-checked,
 * 4 MB cap, real image types only (SVG refused).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url || url.length > 2048) return new NextResponse("Missing url param", { status: 400 });

  const got = await safeFetchImage(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; WraithBot/1.0; +https://wraith.farm)", Accept: "image/*,*/*;q=0.8" },
    timeoutMs: 5000,
  });
  if (!got) return new NextResponse("Unavailable", { status: 502 });

  return new NextResponse(new Uint8Array(got.buf), {
    status: 200,
    headers: {
      "Content-Type": got.type,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
