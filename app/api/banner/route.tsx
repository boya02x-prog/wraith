import { createCanvas, loadImage, GlobalFonts, type Image } from "@napi-rs/canvas";
import path from "path";
import type { NextRequest } from "next/server";
import { drawBanner, type BannerData, type BannerStat } from "@/lib/telegramBanner";
import { SHARE_RANKS } from "@/lib/shareCard";
import { safeFetchImage } from "@/lib/safeFetch";
import { verifyQuery } from "@/lib/signedUrl";
import { bannerLimiter, checkLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

// Telegram banner (signals + wins), drawn on the server and returned as a PNG.
// /api/banner?kind=win&sym=FOO&x=3.5&called=13000&now=45500&peak=45500&chain=solana&img=<token image url>
// /api/banner?kind=signal&sym=FOO&now=13000&score=73&tier=HOT&chain=solana&liq=9000&h1=12.5&vol=40000&img=<token image url>
export const runtime = "nodejs";

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  try {
    GlobalFonts.registerFromPath(path.join(dir, "anton-latin-400-normal.woff"), "Impact");
    GlobalFonts.registerFromPath(path.join(dir, "ibm-plex-mono-latin-600-normal.woff"), "IBM Plex Mono");
    GlobalFonts.registerFromPath(path.join(dir, "ibm-plex-mono-latin-700-normal.woff"), "IBM Plex Mono");
  } catch (e) {
    console.error("[banner] font registration failed", e);
  }
  fontsReady = true;
}

const clean = (v: string | null, max: number) => (v ?? "").replace(/[^\p{L}\p{N} ._$-]/gu, "").slice(0, max);
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Rotate a #rrggbb colour's hue by `deg` (keeps the accent in step with the recoloured character). */
function rotate(hex: string, deg: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, sat = 0;
  if (d) { sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  h = (h + deg) % 360;
  const f = (n: number) => { const k = (n + h / 30) % 12, a = sat * Math.min(l, 1 - l); return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const CHAINS: Record<string, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", bsc: "BNB Chain", monad: "Monad", arc: "Arc", robinhood: "Robinhood" };

async function img(url: string | null, same: string | null): Promise<Image | null> {
  if (!url) return null;
  try {
    if (same) {
      // our own static art: trusted origin, fixed paths
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return await loadImage(Buffer.from(await r.arrayBuffer()));
    }
    // token image comes from the query string: public hosts only, size capped, image types only
    const got = await safeFetchImage(url, { headers: { "user-agent": "wraith-banner" } });
    return got ? await loadImage(got.buf) : null;
  } catch { return null; }
}

/** an optional number from the query string: missing or blank means "not provided" */
function num(sp: URLSearchParams, key: string): number | null {
  const v = sp.get(key);
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams, origin = req.nextUrl.origin;
  // only banners the server itself signed (alert cron) are drawn: no forged "WIN" images on our domain, no free CPU for strangers
  if (!verifyQuery(sp)) return new Response("Forbidden", { status: 403 });
  const rl = await checkLimit(bannerLimiter, clientIp(req));
  if (!rl.success) return new Response("Too many requests", { status: 429 });
  fonts();
  const kind = sp.get("kind") === "signal" ? "signal" : "win";
  const sym = clean(sp.get("sym"), 12) || "TOKEN";
  const x = Math.max(1, num(sp, "x") ?? 1);
  const called = num(sp, "called") ?? 0, now = num(sp, "now") ?? 0, peak = num(sp, "peak") ?? 0;
  const score = Math.round(num(sp, "score") ?? 0);
  const chain = CHAINS[(sp.get("chain") ?? "solana").toLowerCase()] ?? clean(sp.get("chain"), 14);
  const tier = sp.get("tier") === "HOT" ? "HOT" : "WATCH";
  // rank decides which character stands on the banner: Shade (teal) < Specter (purple) < Wraith (orange)
  const rank: 0 | 1 | 2 = kind === "win" ? (x >= 5 ? 2 : x >= 2 ? 1 : 0) : tier === "HOT" ? 2 : 1;
  const art = ["/shade.png", "/specter.png", "/tier-wraith.png"][rank];
  const [logo, token, artImg] = await Promise.all([img(`${origin}/app-icon-v3.png`, "1"), img(sp.get("img"), null), img(`${origin}${art}`, "1")]);

  const stats: BannerStat[] = [];
  if (kind === "win") {
    stats.push({ label: "Called", value: usd(called) }, { label: "Now", value: usd(now), tone: "up" });
    if (peak > 0) stats.push({ label: "Peak", value: usd(Math.max(peak, now)) });
  } else {
    const liq = num(sp, "liq"), h1 = num(sp, "h1"), vol = num(sp, "vol");
    stats.push({ label: "MCap", value: usd(now) });
    if (liq !== null) stats.push({ label: "Liquidity", value: usd(liq) });
    if (h1 !== null) stats.push({ label: "1h", value: `${h1 >= 0 ? "+" : ""}${h1.toFixed(1)}%`, tone: h1 >= 0 ? "up" : "down" });
    if (vol !== null) stats.push({ label: "Vol 1h", value: usd(vol) });
  }

  // every token gets its own character: a colourway (hue) plus its own eyes (look + glow colour)
  const hv = hash(sym + kind);
  const hue = [0, 0, 165, 205, 262, 330][hv % 6];
  const baseRank = SHARE_RANKS[rank];
  const accent = hue ? rotate(baseRank.accent, hue) : baseRank.accent;
  const eyeStyle = (hv >>> 8) % 12; // 0 keeps the original angry eyes
  const eyeColor = ["#ffffff", "#ffd34a", "#ff3b4d", "#46f0ff", "#6dff9f", "#ff7bd5", "#b58cff", "#ff9a3d"][(hv >>> 16) % 8];
  const eyes = { style: eyeStyle, color: eyeColor };

  const data: BannerData = { kind, symbol: sym, chain, tier, score, mult: x, stats, rank, logo, token, art: artImg, accent, hue, eyes };
  const S = 1.5;
  const canvas = createCanvas(960 * S, 540 * S);
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  drawBanner(ctx as unknown as CanvasRenderingContext2D, data);
  const png = canvas.toBuffer("image/png");
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600, s-maxage=3600" } });
}
