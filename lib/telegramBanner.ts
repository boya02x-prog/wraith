// Telegram banner artwork (signals + wins). Pure canvas drawing, no app imports, so it runs inside the /api/banner route.
// Logical size 960 x 540; the route scales the canvas for sharpness.

export interface BannerStat { label: string; value: string; tone?: "up" | "down" }
export interface BannerData {
  kind: "signal" | "win";
  symbol: string;
  chain: string;
  /** signal: "HOT" | "WATCH" */
  tier: string;
  score: number;
  /** win multiplier (1 = flat) */
  mult: number;
  stats: BannerStat[];
  /** 0 = Shade (teal), 1 = Specter (purple), 2 = Wraith (orange) */
  rank: 0 | 1 | 2;
  logo: unknown | null;
  token: unknown | null;
  art: unknown | null;
  /** per-token colourway: overrides the rank accent and hue-rotates the character art */
  accent?: string;
  hue?: number;
  /** per-token eyes: style 1-11 repaints the eyes (0/absent keeps the original angry eyes), colour is the eye glow */
  eyes?: { style: number; color: string } | null;
}

const W = 960, H = 540, PAD = 48;
const MONO = "IBM Plex Mono", DISPLAY = "Impact";
const BG = "#0a0a0d", INK = "#f4f5f7", MUTED = "#8b909c", UP = "#3ddc97", DOWN = "#ff5c6c";

type Ctx = CanvasRenderingContext2D;
type Img = CanvasImageSource;

const rr = (c: Ctx, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
const alpha = (hex: string, a: number) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;

/** letter-spaced text (drawn glyph by glyph so it does not depend on canvas letterSpacing support) */
function spaced(c: Ctx, text: string, x: number, y: number, gap: number, align: "left" | "right" | "center" = "left") {
  let total = 0;
  for (const ch of text) total += c.measureText(ch).width + gap;
  total -= gap;
  let cx = align === "right" ? x - total : align === "center" ? x - total / 2 : x;
  const prev = c.textAlign;
  c.textAlign = "left";
  for (const ch of text) { c.fillText(ch, cx, y); cx += c.measureText(ch).width + gap; }
  c.textAlign = prev;
}

function fit(c: Ctx, text: string, font: (px: number) => string, start: number, min: number, maxW: number) {
  let px = start;
  c.font = font(px);
  while (px > min && c.measureText(text).width > maxW) { px -= 2; c.font = font(px); }
  return px;
}

const RANKS = [
  { name: "SHADE", accent: "#2fd9c0" },
  { name: "SPECTER", accent: "#b27cff" },
  { name: "WRAITH", accent: "#ff7b3d" },
];


// Eye line of each ghost in art pixels (794 x 930): eye height, half spread, half width of the dark hood opening to repaint.
const EYE_GEO = [
  { ey: 390, sp: 47, rx: 79 },
  { ey: 376, sp: 44, rx: 92 },
  { ey: 350, sp: 39, rx: 75 },
];

/** Repaints the eyes in art space (origin = art top-left). style 1-11, each a different personality. */
function paintEyes(c: Ctx, rank: number, style: number, col: string) {
  const g = EYE_GEO[rank], cx = 397, ey = g.ey, u = g.sp, sp = g.sp;
  // wipe the original eyes with the hood's own dark
  c.fillStyle = "#0a0605"; c.beginPath(); c.ellipse(cx, ey, g.rx, 68, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = col; c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 38; c.lineCap = "round"; c.lineJoin = "round";
  const pair = (fn: (x: number) => void) => { fn(cx - sp); fn(cx + sp); };
    if (style === 1) { // glowing orbs
    pair((x) => { c.beginPath(); c.arc(x, ey, u * 0.62, 0, Math.PI * 2); c.fill(); });
  } else if (style === 2) { // sleepy half-closed
    pair((x) => { c.beginPath(); c.arc(x, ey - 4, u * 0.78, 0, Math.PI); c.closePath(); c.fill(); });
    c.lineWidth = u * 0.14; pair((x) => { c.beginPath(); c.moveTo(x - u * 0.9, ey - 4); c.lineTo(x + u * 0.9, ey - 4); c.stroke(); });
  } else if (style === 3) { // wide awake
    pair((x) => { c.beginPath(); c.ellipse(x, ey, u * 0.5, u * 0.8, 0, 0, Math.PI * 2); c.fill(); });
  } else if (style === 4) { // cyclops
    c.beginPath(); c.arc(cx, ey, u * 1.15, 0, Math.PI * 2); c.fill();
  } else if (style === 5) { // three eyes
    pair((x) => { c.beginPath(); c.arc(x, ey + u * 0.15, u * 0.46, 0, Math.PI * 2); c.fill(); });
    c.beginPath(); c.arc(cx, ey - u * 1.0, u * 0.4, 0, Math.PI * 2); c.fill();
  } else if (style === 6) { // dead X eyes
    c.lineWidth = u * 0.24; pair((x) => { const k = u * 0.5; c.beginPath(); c.moveTo(x - k, ey - k); c.lineTo(x + k, ey + k); c.moveTo(x + k, ey - k); c.lineTo(x - k, ey + k); c.stroke(); });
  } else if (style === 7) { // tall slits
    pair((x) => { c.beginPath(); c.roundRect(x - u * 0.2, ey - u * 0.95, u * 0.4, u * 1.9, u * 0.2); c.fill(); });
  } else if (style === 8) { // visor bar
    const hw = sp + u * 0.95, h = u * 0.42; c.beginPath(); c.roundRect(cx - hw, ey - h / 2, hw * 2, h, h / 2); c.fill();
  } else if (style === 9) { // diamonds
    pair((x) => { c.beginPath(); c.moveTo(x, ey - u * 0.9); c.lineTo(x + u * 0.62, ey); c.lineTo(x, ey + u * 0.9); c.lineTo(x - u * 0.62, ey); c.closePath(); c.fill(); });
  } else if (style === 10) { // happy arcs
    c.lineWidth = u * 0.26; pair((x) => { c.beginPath(); c.arc(x, ey + u * 0.35, u * 0.62, Math.PI * 1.12, Math.PI * 1.88); c.stroke(); });
  } else { // rings
    c.lineWidth = u * 0.2; pair((x) => { c.beginPath(); c.arc(x, ey, u * 0.58, 0, Math.PI * 2); c.stroke(); });
  }
  c.shadowBlur = 0; c.lineCap = "butt";
}

export function drawBanner(c: Ctx, d: BannerData) {
  const win = d.kind === "win";
  const accent = d.accent ?? RANKS[d.rank].accent;
  const label = win ? "WRAITH WIN" : d.tier === "HOT" ? "HOT SIGNAL" : "WATCH SIGNAL";
  const LW = 540; // content column width (the character lives to the right of it)

  // ── base: near-black with accent glows and a faint dot grid
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  const g1 = c.createRadialGradient(W - 200, H - 120, 10, W - 200, H - 120, 520);
  g1.addColorStop(0, alpha(accent, 0.3)); g1.addColorStop(1, alpha(accent, 0));
  c.fillStyle = g1; c.fillRect(0, 0, W, H);
  const g2 = c.createRadialGradient(0, 0, 10, 0, 0, 420);
  g2.addColorStop(0, alpha(accent, 0.1)); g2.addColorStop(1, alpha(accent, 0));
  c.fillStyle = g2; c.fillRect(0, 0, W, H);
  c.fillStyle = "rgba(255,255,255,0.05)";
  for (let x = 24; x < W; x += 24) for (let y = 24; y < H; y += 24) c.fillRect(x, y, 1.5, 1.5);

  // ── the character: big, bleeding off the bottom-right, sitting in its own glow
  c.save();
  rr(c, 1, 1, W - 2, H - 2, 30); c.clip();
  const ah = 470, aw = ah * (794 / 930), ax = W - aw + 4, ay0 = H - ah + 34;
  const halo = c.createRadialGradient(ax + aw / 2, ay0 + ah * 0.42, 20, ax + aw / 2, ay0 + ah * 0.42, 330);
  halo.addColorStop(0, alpha(accent, 0.38)); halo.addColorStop(0.55, alpha(accent, 0.1)); halo.addColorStop(1, alpha(accent, 0));
  c.fillStyle = halo; c.fillRect(ax - 200, 0, aw + 260, H);
  if (d.art) {
    c.shadowColor = alpha(accent, 0.55); c.shadowBlur = 40;
    if (d.hue) c.filter = `hue-rotate(${d.hue}deg)`;
    c.drawImage(d.art as Img, ax, ay0, aw, ah);
    c.filter = "none"; c.shadowBlur = 0;
    if (d.eyes && d.eyes.style > 0) { c.save(); c.translate(ax, ay0); c.scale(ah / 930, ah / 930); paintEyes(c, d.rank, d.eyes.style, d.eyes.color); c.restore(); }
  }
  c.restore();
  rr(c, 1, 1, W - 2, H - 2, 30); c.strokeStyle = "rgba(255,255,255,0.09)"; c.lineWidth = 2; c.stroke();

  // ── top bar: logo + wordmark, status pill
  if (d.logo) { c.save(); rr(c, PAD, 38, 42, 42, 11); c.clip(); c.drawImage(d.logo as Img, PAD, 38, 42, 42); c.restore(); }
  c.fillStyle = INK; c.textBaseline = "alphabetic"; c.font = `700 21px "${MONO}"`;
  spaced(c, "WRAITH", PAD + 56, 66, 5);

  c.font = `700 17px "${MONO}"`;
  let tw = 0; for (const ch of label) tw += c.measureText(ch).width + 3; tw -= 3;
  const pw = tw + 62, px = W - PAD - pw;
  rr(c, px, 38, pw, 42, 21); c.fillStyle = alpha(accent, 0.16); c.fill(); c.strokeStyle = alpha(accent, 0.6); c.lineWidth = 1.5; c.stroke();
  c.beginPath(); c.arc(px + 24, 59, 5.5, 0, Math.PI * 2); c.fillStyle = accent; c.shadowColor = accent; c.shadowBlur = 12; c.fill(); c.shadowBlur = 0;
  c.fillStyle = accent; spaced(c, label, px + 40, 65, 3);

  // ── token: avatar + symbol
  const ay = 102, as = 96;
  c.save(); rr(c, PAD, ay, as, as, 26); c.clip();
  if (d.token) c.drawImage(d.token as Img, PAD, ay, as, as);
  else {
    const ag = c.createLinearGradient(PAD, ay, PAD + as, ay + as);
    ag.addColorStop(0, alpha(accent, 0.55)); ag.addColorStop(1, alpha(accent, 0.15));
    c.fillStyle = ag; c.fillRect(PAD, ay, as, as);
    c.fillStyle = INK; c.font = `400 56px "${DISPLAY}"`; c.textAlign = "center"; c.fillText(d.symbol.slice(0, 1).toUpperCase(), PAD + as / 2, ay + as / 2 + 20); c.textAlign = "left";
  }
  c.restore();
  rr(c, PAD, ay, as, as, 26); c.strokeStyle = alpha(accent, 0.65); c.lineWidth = 3; c.stroke();

  const tx = PAD + as + 24;
  const sym = `$${d.symbol.toUpperCase()}`;
  const spx = fit(c, sym, (p) => `400 ${p}px "${DISPLAY}"`, 72, 36, LW - as - 24);
  c.fillStyle = INK; c.fillText(sym, tx, ay + 58 + Math.round((spx - 60) * 0.12));
  c.fillStyle = MUTED; c.font = `600 18px "${MONO}"`;
  spaced(c, `${d.chain.toUpperCase()}  ·  ${RANKS[d.rank].name}`, tx, ay + as - 6, 2);

  // ── focal number
  const fy = 316;
  if (win) {
    const big = `${d.mult.toFixed(d.mult >= 10 ? 1 : 2)}x`;
    c.fillStyle = accent; c.shadowColor = alpha(accent, 0.55); c.shadowBlur = 30;
    const bpx = fit(c, big, (p) => `400 ${p}px "${DISPLAY}"`, 100, 64, 300);
    c.fillText(big, PAD, fy); c.shadowBlur = 0;
    const bw = c.measureText(big).width;
    c.fillStyle = MUTED; c.font = `600 15px "${MONO}"`; spaced(c, "SINCE THE CALL", PAD + bw + 22, fy - Math.round(bpx * 0.45), 2.5);
    c.fillStyle = accent; c.font = `700 30px "${MONO}"`;
    c.fillText(`+${((d.mult - 1) * 100).toFixed(d.mult >= 10 ? 0 : 1)}%`, PAD + bw + 22, fy - Math.round(bpx * 0.45) + 36);
  } else {
    c.fillStyle = INK; c.font = `400 100px "${DISPLAY}"`; c.fillText(String(d.score), PAD, fy);
    const sw = c.measureText(String(d.score)).width;
    c.fillStyle = MUTED; c.font = `600 15px "${MONO}"`; spaced(c, "WRAITH SCORE / 100", PAD + sw + 22, fy - 52, 2.5);
    const bx = PAD + sw + 22, bw = LW - (sw + 22) - 10, by = fy - 30;
    rr(c, bx, by, bw, 12, 6); c.fillStyle = "rgba(255,255,255,0.1)"; c.fill();
    rr(c, bx, by, Math.max(12, bw * Math.max(0, Math.min(100, d.score)) / 100), 12, 6);
    c.fillStyle = accent; c.shadowColor = accent; c.shadowBlur = 14; c.fill(); c.shadowBlur = 0;
  }

  // ── stat cards (left column only, the character owns the right)
  const n = Math.max(1, d.stats.length), gap = 12;
  const two = n === 4;
  const cols = two ? 2 : n, rows = two ? 2 : 1;
  const top = 346, ch = two ? 72 : 120, cw = (LW - gap * (cols - 1)) / cols;
  d.stats.forEach((s, i) => {
    const col = two ? i % 2 : i, row = two ? Math.floor(i / 2) : 0;
    const x = PAD + col * (cw + gap), y = top + row * (ch + gap);
    rr(c, x, y, cw, ch, 18); c.fillStyle = "rgba(10,10,13,0.62)"; c.fill(); c.strokeStyle = "rgba(255,255,255,0.1)"; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = MUTED; c.font = `600 14px "${MONO}"`; spaced(c, s.label.toUpperCase(), x + 20, y + (two ? 27 : 38), 2.2);
    c.fillStyle = s.tone === "up" ? UP : s.tone === "down" ? DOWN : INK;
    fit(c, s.value, (p) => `700 ${p}px "${MONO}"`, two ? 26 : 36, 18, cw - 40);
    c.fillText(s.value, x + 20, y + (two ? 58 : 94));
  });
  void rows;

  // ── footer
  c.fillStyle = alpha(accent, 0.95); c.font = `700 16px "${MONO}"`; spaced(c, "WRAITH.FARM", PAD, 523, 3);
  c.fillStyle = "rgba(139,144,156,0.8)"; c.font = `600 14px "${MONO}"`; c.fillText("Research, not financial advice", PAD + 190, 523);
}

export const BANNER_SIZE = { W, H };
