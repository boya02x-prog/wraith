import { NextRequest, NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";
import { checkLimit, clipSearchLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

// Movie scenes, anime and memes for the Share studio's "Clips" tab, searched on GIPHY. They are GIPHY's own licensed library (Wraith does not
// host or copy any film footage), shown with "Powered by GIPHY" as their terms ask. The key stays on the server: set GIPHY_API_KEY (a free
// key from developers.giphy.com) in the environment. Without it this answers { configured: false } and the tab says it is not switched on.
// Content is limited to GIPHY rating "pg-13".
const PAGE = 24;

type GiphyImage = { mp4?: string; url?: string };
type GiphyItem = { id?: string; title?: string; images?: Record<string, GiphyImage | undefined> };

export async function GET(request: NextRequest) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return NextResponse.json({ configured: false, items: [] });

  const session = await getPrivySession().catch(() => null);
  const rl = await checkLimit(clipSearchLimiter, `clips:${session?.user?.id ?? clientIp(request)}`);
  if (!rl.success) return NextResponse.json({ error: "Too many searches. Wait a moment." }, { status: 429 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const offset = Math.min(200, Math.max(0, Math.floor(Number(request.nextUrl.searchParams.get("offset")) || 0)));
  const url = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("rating", "pg-13");
  url.searchParams.set("bundle", "messaging_non_clips");
  if (q) { url.searchParams.set("q", q); url.searchParams.set("lang", "en"); }

  try {
    const r = await fetch(url, { next: { revalidate: 300 } }); // the same search by anyone is reused for five minutes
    if (!r.ok) return NextResponse.json({ configured: true, error: "The clip service did not answer." }, { status: 502 });
    const d = (await r.json()) as { data?: GiphyItem[] };
    const items = (d.data ?? [])
      .map((g) => {
        const im = g.images ?? {};
        const mp4 = im.original_mp4?.mp4 ?? im.fixed_height?.mp4 ?? im.fixed_width?.mp4;
        const thumb = im.fixed_width_still?.url ?? im.fixed_height_still?.url ?? im.fixed_width?.url ?? "";
        return g.id && mp4 && thumb ? { id: g.id, title: (g.title ?? "").slice(0, 80), thumb, mp4 } : null;
      })
      .filter((x): x is { id: string; title: string; thumb: string; mp4: string } => x !== null);
    return NextResponse.json({ configured: true, items, next: offset + PAGE }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (error) {
    console.error("[clips GET]", error);
    return NextResponse.json({ configured: true, error: "The clip service is unreachable." }, { status: 502 });
  }
}
