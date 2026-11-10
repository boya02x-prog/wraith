// GET /api/gifs?q=<search>   Trending or searched GIFs for the intel composer (GIPHY).
// Needs GIPHY_API_KEY (free at developers.giphy.com). Without it the route reports enabled:false and the GIF button stays hidden.
// Only small renditions are returned, because intel posts carry the image inline (about 400 KB max).
import { NextRequest, NextResponse } from "next/server";
import { getPrivySession } from "@/lib/privyAuth";

export const dynamic = "force-dynamic";
const MAX_BYTES = 380_000;

interface Rendition { url?: string; size?: string; width?: string; height?: string }
interface GiphyItem { id: string; title?: string; images?: Record<string, Rendition> }

export async function GET(req: NextRequest) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return NextResponse.json({ enabled: false, gifs: [] });
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const url = q
    ? `https://api.giphy.com/v1/gifs/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=en`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${key}&limit=24&rating=pg-13`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return NextResponse.json({ enabled: true, gifs: [], error: "GIF search is unavailable right now" }, { status: 502 });
    const data = (await res.json()) as { data?: GiphyItem[] };
    const gifs = (data.data ?? []).flatMap((g) => {
      const imgs = g.images ?? {};
      const pick = ["fixed_width", "fixed_width_small", "downsized_small"].map((k) => imgs[k]).find((r) => r?.url && Number(r.size) > 0 && Number(r.size) <= MAX_BYTES);
      const thumb = imgs.fixed_width_small_still?.url ?? imgs.fixed_width_still?.url ?? pick?.url;
      return pick?.url && thumb ? [{ id: g.id, title: g.title ?? "", url: pick.url, thumb }] : [];
    });
    return NextResponse.json({ enabled: true, gifs });
  } catch {
    return NextResponse.json({ enabled: true, gifs: [], error: "GIF search is unavailable right now" }, { status: 502 });
  }
}
