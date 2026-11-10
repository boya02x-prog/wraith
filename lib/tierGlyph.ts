// Tier ghosts: the Wraith logo silhouette, recoloured and decorated per tier.
// Single source of truth: used by <TierGlyph/> in the app and by the exported SVG/PNG files.
export type GlyphTier = "GHOST" | "SHADE" | "SPECTER" | "WRAITH";

interface Pal { hi: string; mid: string; lo: string; eye0: string; eye1: string; glow: string; }

export const GLYPH_PALETTE: Record<GlyphTier, Pal> = {
  GHOST:   { hi: "#c9c9d4", mid: "#9a9aa8", lo: "#6a6a78", eye0: "#f2f2f7", eye1: "#b9b9c6", glow: "#9a9aa8" },
  SHADE:   { hi: "#8fdcff", mid: "#38bdf8", lo: "#0c8bc4", eye0: "#effaff", eye1: "#7dd3fc", glow: "#38bdf8" },
  SPECTER: { hi: "#e0c3ff", mid: "#b06cff", lo: "#7a2bd6", eye0: "#fbf3ff", eye1: "#d8b4fe", glow: "#b06cff" },
  WRAITH:  { hi: "#ff9556", mid: "#ff7b3d", lo: "#f0601f", eye0: "#fff3df", eye1: "#ffb877", glow: "#ff7b3d" },
};

export const GLYPH_VIEWBOX = "40 14 152 186";

const BODY =
  "M72.0 99.5 C72.0 69.1 91.9 44.5 116.5 44.5 C141.1 44.5 161.0 69.1 161.0 99.5 L161 151.5 L148 164.5 L140 172.5 L127 159.5 L106 180.5 L93 167.5 L72 188.5 Z";

const star = (x: number, y: number, r: number, fill: string) =>
  `<path d="M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z" fill="${fill}"/>`;

/** Inner SVG markup (defs + shapes). `uid` must be unique per rendered instance. */
export function tierGlyphInner(tier: GlyphTier, uid: string): string {
  const p = GLYPH_PALETTE[tier];
  const id = (n: string) => `${uid}-${n}`;
  const ghost = tier === "GHOST";
  const defs = `<defs>
<linearGradient id="${id("g")}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.hi}"/><stop offset=".55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.lo}"/></linearGradient>
<radialGradient id="${id("eye")}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${p.eye0}"/><stop offset=".6" stop-color="${p.eye1}"/><stop offset="1" stop-color="${p.mid}"/></radialGradient>
<radialGradient id="${id("halo")}" cx=".5" cy=".6" r=".6"><stop offset="0" stop-color="${p.glow}" stop-opacity="${tier === "WRAITH" ? ".42" : tier === "SPECTER" ? ".30" : ".20"}"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="${id("sh")}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/></linearGradient>
<linearGradient id="${id("fl")}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a1f"/><stop offset=".6" stop-color="#ffb347"/><stop offset="1" stop-color="#fff0b3"/></linearGradient>
<filter id="${id("bl")}" x="-80%" y="-120%" width="260%" height="340%"><feGaussianBlur stdDeviation="3.2"/></filter>
</defs>`;

  let back = "";
  if (!ghost) back += `<ellipse cx="116.5" cy="112" rx="74" ry="88" fill="url(#${id("halo")})"/>`;
  if (tier === "SPECTER" || tier === "WRAITH") {
    back += `<ellipse cx="116.5" cy="112" rx="64" ry="80" fill="none" stroke="${p.mid}" stroke-opacity="${tier === "WRAITH" ? ".55" : ".38"}" stroke-width="1.6" stroke-dasharray="${tier === "WRAITH" ? "0" : "3 5"}"/>`;
  }
  if (tier === "WRAITH") {
    back += `<ellipse cx="116.5" cy="112" rx="72" ry="90" fill="none" stroke="${p.mid}" stroke-opacity=".25" stroke-width="1.2"/>`;
  }

  const body = ghost
    ? `<path d="${BODY}" fill="${p.mid}" fill-opacity=".30" stroke="${p.hi}" stroke-opacity=".85" stroke-width="3" stroke-dasharray="7 5" stroke-linejoin="round"/>`
    : `<path d="${BODY}" fill="url(#${id("g")})" stroke="url(#${id("g")})" stroke-width="6" stroke-linejoin="round"/><path d="${BODY}" fill="url(#${id("sh")})"/>`;

  const eyeOp = ghost ? ".62" : "1";
  const eyes = `<g opacity="${eyeOp}"><g transform="rotate(13 99.5 99.5)"><rect x="86.5" y="93" width="26" height="13" rx="6.5" fill="#0a0504"/>${ghost ? "" : `<rect x="89" y="95.5" width="21" height="8" rx="4" fill="${p.glow}" filter="url(#${id("bl")})" opacity=".9"/>`}<rect x="90.5" y="96.5" width="18" height="6" rx="3" fill="url(#${id("eye")})"/></g><g transform="rotate(-13 133.5 99.5)"><rect x="120.5" y="93" width="26" height="13" rx="6.5" fill="#0a0504"/>${ghost ? "" : `<rect x="123" y="95.5" width="21" height="8" rx="4" fill="${p.glow}" filter="url(#${id("bl")})" opacity=".9"/>`}<rect x="124.5" y="96.5" width="18" height="6" rx="3" fill="url(#${id("eye")})"/></g></g>`;

  let front = "";
  if (tier === "SPECTER") {
    front += star(58, 70, 7, p.hi) + star(176, 132, 5.5, p.hi) + star(170, 52, 3.4, p.mid);
  }
  if (tier === "WRAITH") {
    front +=
      `<path d="M116.5 47 C107 38 111 30 116.5 19 C122 30 126 38 116.5 47 Z" fill="url(#${id("fl")})"/>` +
      `<path d="M99 53 C93 46 95 41 99 33 C103 41 105 46 99 53 Z" fill="url(#${id("fl")})" opacity=".92"/>` +
      `<path d="M134 53 C128 46 130 41 134 33 C138 41 140 46 134 53 Z" fill="url(#${id("fl")})" opacity=".92"/>` +
      star(56, 78, 6.5, "#ffd3b0") + star(178, 138, 5, "#ffd3b0") + star(172, 50, 3.2, "#ffb877");
  }
  return defs + back + body + eyes + front;
}

/** Standalone SVG document string (for exported files). */
export function tierGlyphSvgFile(tier: GlyphTier): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GLYPH_VIEWBOX}" width="512" height="624">${tierGlyphInner(tier, "wt")}</svg>`;
}
