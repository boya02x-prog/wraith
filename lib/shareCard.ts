// Share card renderer: ONE canvas drawing used for the live preview, the PNG and the video clip.
// 6 layouts x 5 backgrounds x 4 ranks (+ mirrored ghost) so every share looks different.
// Currency-agnostic: `unit` is the chain's native token (SOL, ETH, BNB, MON...).

export interface ShareRank { name: string; sub: string; accent: string; glow: string; img: string; grey?: boolean }
export const SHARE_RANKS: ShareRank[] = [
  { name: "SHADE", sub: "FIRST BLOOD", accent: "#2fe0c0", glow: "rgba(47,224,192,.30)", img: "/shade.png" },
  { name: "SPECTER", sub: "2X CLUB", accent: "#b98cff", glow: "rgba(185,140,255,.32)", img: "/specter.png" },
  { name: "WRAITH", sub: "5X & UP", accent: "#ff7b3d", glow: "rgba(255,123,61,.36)", img: "/tier-wraith.png" },
  { name: "HAUNTED", sub: "TOOK THE L", accent: "#ff4d5a", glow: "rgba(255,77,90,.24)", img: "/shade.png", grey: true },
];
export function autoRankIdx(pnl: number, entry: number, exit?: number): number {
  if (pnl < 0) return 3;
  const x = exit && entry ? exit / entry : 1 + pnl / 100;
  return x >= 5 ? 2 : x >= 2 ? 1 : 0;
}
export const SHARE_LAYOUTS = 6;
export const SHARE_MOTIFS = 5;
/** variant = layout + motif*6 + (mirror ? 30 : 0)  ->  60 combos per rank */
export const SHARE_CHARS = 9; // classic, crown, degen shades, halo, horns, laser eyes, top hat, money eyes, gold chain
const SHARE_BASE = SHARE_LAYOUTS * SHARE_MOTIFS * 2;
export const SHARE_VARIANTS = SHARE_BASE * SHARE_CHARS;
// most shuffles stay clean (no accessory); ~1 in 4 gets one
export const randomVariant = () => Math.floor(Math.random() * SHARE_BASE);

export interface ShareParams {
  symbol: string;
  amountSol: number; // amount invested, in `unit`
  unit?: string; // native currency label, default SOL
  chainName?: string;
  entryMcap: number;
  exitMcap?: number;
  pnl: number; // percent
  solPnl: number; // profit in `unit`
  mult: number | null;
  usdRate?: number; // USD per 1 native unit; when set the card leads with dollars
  ago: string;
  tag?: string;
  rank: ShareRank;
  variant?: number;
  call?: boolean; // a scanner call / signal banner (no trade amounts)
  bigText?: string; // overrides the big % headline
  resText?: string; // overrides the result line
  subText?: string; // overrides the 'x -> y UNIT' line
  chipText?: string; // overrides '0.5 SOL in · TP'
  hue?: number; // degrees; recolours the ghost art (used by banners)
  label?: string; // overrides REALIZED / FROM THE CALL
  sealText?: string; // overrides the multiplier inside the seal
  sealLabel?: string;
  char?: number; // accessory index (derived from variant)
  tokenImg?: CanvasImageSource | null;
  rankImg?: HTMLImageElement | null;
  bg?: { src: CanvasImageSource; w: number; h: number; isVideo: boolean } | null;
}

export const SHARE_W = 960;
export const SHARE_H = 540;
export const SHARE_DUR = 5;

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const back = (x: number) => { const c = 1.9; const t = Math.min(1, Math.max(0, x)) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const HEAVY = "Impact, 'Arial Black', system-ui, sans-serif";
const W = SHARE_W, H = SHARE_H;

const fmtMcap = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const bigTxt = (p: ShareParams, t: number) => p.bigText ?? pctText(p.pnl * t);
const subOf = (p: ShareParams, u: string) => p.subText ?? `${p.amountSol} › ${(p.amountSol * (1 + p.pnl / 100)).toFixed(3)} ${u}`;
const pctText = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v) >= 1000 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)}%`;
const amt = (v: number, dec: number, unit: string) => `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(dec)} ${unit}`;

const fmtUsd = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString("en-US") : Math.abs(v).toFixed(2)}`;
/** Headline result: dollars when we know the rate, otherwise the native amount. */
const res = (p: ShareParams, v: number) => p.resText ?? (p.usdRate ? fmtUsd(v * p.usdRate) : `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(Math.abs(p.solPnl) >= 10 ? 2 : Math.abs(p.solPnl) >= 1 ? 3 : 4)} ${p.unit ?? "SOL"}`);

type C = CanvasRenderingContext2D;

// ── shared pieces ─────────────────────────────────────────────────────────
function background(ctx: C, k: number, p: ShareParams, motif: number) {
  const A = p.rank.accent;
  ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
  if (p.bg) {
    const sc = Math.max(W / p.bg.w, H / p.bg.h) * (p.bg.isVideo ? 1 : 1 + 0.05 * Math.min(1, k / SHARE_DUR));
    ctx.drawImage(p.bg.src, (W - p.bg.w * sc) / 2, (H - p.bg.h * sc) / 2, p.bg.w * sc, p.bg.h * sc);
    ctx.fillStyle = "rgba(6,6,8,.62)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "color"; ctx.fillStyle = A + "55"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  ctx.save();
  if (motif === 0) { // fog bands
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) ctx.lineTo(x, H - 46 - i * 20 + Math.sin(x / 130 + k * (0.7 + i * 0.3) + i) * 12);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = A; ctx.globalAlpha = 0.07 + i * 0.02; ctx.fill();
    }
  } else if (motif === 1) { // moving grid floor
    ctx.strokeStyle = A; ctx.globalAlpha = 0.12; ctx.lineWidth = 1;
    const hz = H * 0.62;
    for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 12, hz); ctx.lineTo(W / 2 + i * 120, H); ctx.stroke(); }
    for (let j = 0; j < 9; j++) { const f = ((j + (k * 0.5) % 1) / 9); const y = hz + (H - hz) * f * f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (motif === 2) { // falling rune rain
    ctx.fillStyle = A;
    for (let i = 0; i < 46; i++) { const x = (i * 83) % W, sp = 120 + ((i * 37) % 160), len = 18 + ((i * 11) % 30); const y = ((k * sp + i * 53) % (H + 80)) - 40; ctx.globalAlpha = 0.16; ctx.fillRect(x, y, 2, len); }
  } else if (motif === 3) { // diagonal slashes
    ctx.strokeStyle = "#fff"; ctx.globalAlpha = 0.035; ctx.lineWidth = 2;
    const off = (k * 14) % 22;
    for (let x = -H; x < W + H; x += 22) { ctx.beginPath(); ctx.moveTo(x + off, H); ctx.lineTo(x + off + H * 0.47, 0); ctx.stroke(); }
  } else { // star dust
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 70; i++) { const x = (i * 131) % W, y = (i * 71) % H; ctx.globalAlpha = 0.1 + 0.3 * Math.abs(Math.sin(k * 1.4 + i)); ctx.fillRect(x, y, 2, 2); }
  }
  ctx.restore();
}

function aurora(ctx: C, k: number, p: ShareParams, x: number, y: number, r: number) {
  const pulse = 0.88 + 0.12 * Math.sin(k * 2);
  const g = ctx.createRadialGradient(x, y, 10, x, y, r * pulse);
  g.addColorStop(0, p.rank.glow); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// image-px geometry (794x930 art): tip of hood, eye line, half eye spread
const GEO: Record<string, { tip: number; eye: number; sp: number; fw: number }> = {
  "/shade.png": { tip: 104, eye: 390, sp: 47, fw: 87 },
  "/specter.png": { tip: 56, eye: 376, sp: 44, fw: 99 },
  "/tier-wraith.png": { tip: 28, eye: 350, sp: 39, fw: 83 },
};
const GOLD = "#ffc94a";
export function accessory(ctx: C, k: number, p: ShareParams, ch: number, flip: boolean) {
  if (!ch) return;
  const g = GEO[p.rank.img] ?? GEO["/shade.png"], cx = 397, ex = g.sp, ey = g.eye, tip = g.tip;
  ctx.save(); ctx.globalAlpha = ease((k - 0.5) / 0.5) * (p.rank.grey ? 0.9 : 1);
  const txt = (t: string, x: number, y: number, size: number, col: string) => { ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1); ctx.fillStyle = col; ctx.font = `900 ${size}px ${HEAVY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, 0, 0); ctx.restore(); };
  if (ch === 1) { // crown
    const y = tip + 100, w = 150, h = 120; const gr = ctx.createLinearGradient(0, y - h, 0, y); gr.addColorStop(0, "#fff0a8"); gr.addColorStop(1, "#e49b1a");
    ctx.shadowColor = "#ffc94a"; ctx.shadowBlur = 40; ctx.fillStyle = gr; ctx.beginPath();
    ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx - w / 2 - 12, y - h); ctx.lineTo(cx - w / 4, y - h * 0.55); ctx.lineTo(cx, y - h * 1.12); ctx.lineTo(cx + w / 4, y - h * 0.55); ctx.lineTo(cx + w / 2 + 12, y - h); ctx.lineTo(cx + w / 2, y); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "#b8741a"; ctx.fillRect(cx - w / 2, y - 14, w, 14);
    [[cx, y - h * 1.12 - 10, "#ff4d5a"], [cx - w / 2 - 12, y - h - 10, "#2fe0c0"], [cx + w / 2 + 12, y - h - 10, "#2fe0c0"]].forEach(([x, yy, c]) => { ctx.fillStyle = c as string; ctx.beginPath(); ctx.arc(x as number, yy as number, 9, 0, 7); ctx.fill(); });
  } else if (ch === 2) { // degen shades: glossy rimmed lenses that stay visible against the dark hood opening
    const lw = g.fw * 0.94, lh = 64, y = ey - lh / 2;
    ctx.shadowColor = p.rank.accent; ctx.shadowBlur = 22;
    const lens = (x: number) => {
      ctx.beginPath(); ctx.roundRect(x, y, lw, lh, [8, 8, 26, 26]);
      const gr = ctx.createLinearGradient(0, y, 0, y + lh); gr.addColorStop(0, "#2a2a3a"); gr.addColorStop(1, "#050508");
      ctx.fillStyle = gr; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = "#f4f4ff"; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.beginPath(); ctx.moveTo(x + lw * 0.18, y); ctx.lineTo(x + lw * 0.42, y); ctx.lineTo(x + lw * 0.2, y + lh); ctx.lineTo(x - 6, y + lh); ctx.closePath(); ctx.fill(); ctx.restore();
    };
    lens(cx - lw - 4); lens(cx + 4);
    ctx.shadowBlur = 0; ctx.fillStyle = "#f4f4ff"; ctx.fillRect(cx - 8, y + 12, 16, 8);
  } else if (ch === 3) { // halo
    const y = tip - 26 + Math.sin(k * 2) * 6; ctx.shadowColor = GOLD; ctx.shadowBlur = 38; ctx.strokeStyle = GOLD; ctx.lineWidth = 16; ctx.beginPath(); ctx.ellipse(cx, y, 88, 24, 0, 0, 7); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = "#fff5c4"; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(cx, y - 3, 88, 24, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  } else if (ch === 4) { // horns
    const hy = tip + 150; ctx.shadowColor = "#ff2d3d"; ctx.shadowBlur = 24;
    [-1, 1].forEach((sd) => { const gr = ctx.createLinearGradient(0, hy - 120, 0, hy); gr.addColorStop(0, "#ff9a9a"); gr.addColorStop(1, "#a50f23"); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(cx + sd * 58, hy + 10); ctx.quadraticCurveTo(cx + sd * 100, hy - 10, cx + sd * 98, hy - 120); ctx.quadraticCurveTo(cx + sd * 130, hy - 30, cx + sd * 112, hy + 40); ctx.closePath(); ctx.fill(); });
  } else if (ch === 5) { // laser eyes
    const pulse = 0.75 + 0.25 * Math.sin(k * 14); ctx.globalCompositeOperation = "lighter";
    [-1, 1].forEach((sd) => { const x = cx + sd * ex, len = 1400; const lg = ctx.createLinearGradient(x, 0, x + (flip ? -1 : 1) * len * 0 + len, 0); void lg;
      ctx.save(); ctx.translate(x, ey); ctx.rotate(sd * 0.04 - 0.05); ctx.fillStyle = `rgba(255,40,60,${0.55 * pulse})`; ctx.shadowColor = "#ff2040"; ctx.shadowBlur = 40; ctx.fillRect(0, -9, len, 18); ctx.fillStyle = `rgba(255,220,220,${0.9 * pulse})`; ctx.fillRect(0, -3, len, 6); ctx.restore();
      const rg = ctx.createRadialGradient(x, ey, 0, x, ey, 52); rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.35, "rgba(255,50,70,.9)"); rg.addColorStop(1, "rgba(255,0,40,0)"); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, ey, 52, 0, 7); ctx.fill(); });
  } else if (ch === 6) { // top hat
    const y = tip + 104; ctx.shadowColor = "#000"; ctx.shadowBlur = 20; const gr = ctx.createLinearGradient(cx - 80, 0, cx + 80, 0); gr.addColorStop(0, "#111"); gr.addColorStop(0.5, "#2a2a30"); gr.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = gr; ctx.fillRect(cx - 70, y - 170, 140, 170); ctx.beginPath(); ctx.ellipse(cx, y, 130, 22, 0, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = p.rank.accent; ctx.fillRect(cx - 70, y - 46, 140, 20);
  } else if (ch === 7) { // money eyes
    [-1, 1].forEach((sd) => { const x = cx + sd * ex; ctx.shadowColor = "#2cff7a"; ctx.shadowBlur = 30; ctx.fillStyle = "#0b2a14"; ctx.beginPath(); ctx.arc(x, ey, 44, 0, 7); ctx.fill(); ctx.strokeStyle = "#2cff7a"; ctx.lineWidth = 5; ctx.stroke(); ctx.shadowBlur = 0; txt("$", x, ey + 2, 58, "#6dff9f"); });
  } else if (ch === 8) { // gold chain + $ pendant
    const y = ey + 150; ctx.strokeStyle = GOLD; ctx.lineWidth = 12; ctx.shadowColor = GOLD; ctx.shadowBlur = 24; ctx.setLineDash([16, 5]); ctx.beginPath(); ctx.moveTo(cx - 105, y - 30); ctx.quadraticCurveTo(cx, y + 130, cx + 105, y - 30); ctx.stroke(); ctx.setLineDash([]);
    const py = y + 70 + Math.sin(k * 2) * 4; const gr = ctx.createRadialGradient(cx - 10, py - 10, 4, cx, py, 52); gr.addColorStop(0, "#fff3b0"); gr.addColorStop(1, "#d98a10"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, py, 50, 0, 7); ctx.fill(); ctx.shadowBlur = 0; txt("$", cx, py + 2, 60, "#8a5200");
  }
  ctx.restore();
}

function ghost(ctx: C, k: number, p: ShareParams, cx: number, bottom: number, h: number, flip: boolean, rise = 170, glitch = false) {
  const im = p.rankImg; if (!im) return;
  const w = (im.width / im.height) * h;
  const dy = (1 - ease((k - 0.1) / 1.1)) * rise + Math.sin(k * 1.5) * 9;
  const draw = (ox: number, tint?: string) => {
    ctx.save(); ctx.translate(cx + ox, 0);
    if (flip) ctx.scale(-1, 1);
    ctx.globalAlpha = ease((k - 0.05) / 0.6) * (tint ? 0.55 : 1);
    if (p.rank.grey && !tint) ctx.filter = "grayscale(1) brightness(.6) contrast(1.1)";
    else if (p.hue && !tint) ctx.filter = `hue-rotate(${p.hue}deg)`;
    if (!tint) { ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 60; }
    if (tint) ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(im, -w / 2, bottom - h + dy, w, h);
    if (!tint && (p.char ?? 0)) { ctx.shadowBlur = 0; ctx.filter = "none"; ctx.translate(-w / 2, bottom - h + dy); ctx.scale(h / 930, h / 930); accessory(ctx, k, p, p.char ?? 0, flip); }
    ctx.restore();
  };
  if (glitch && (k % 1.6) < 0.14) { draw(-7, "r"); draw(7, "c"); }
  draw(0);
}

function embers(ctx: C, k: number, p: ShareParams, n = 22) {
  ctx.fillStyle = p.rank.accent;
  for (let i = 0; i < n; i++) {
    const sp = 24 + ((i * 53) % 60), ph = (i * 31) % 100, x0 = (i * 97) % W;
    const y = H - ((k * sp + ph * 7) % (H + 30));
    ctx.globalAlpha = 0.5 * Math.max(0, y / H);
    ctx.beginPath(); ctx.arc(x0 + Math.sin(k + ph) * 14, y, 1.2 + (i % 3), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tokenChip(ctx: C, k: number, p: ShareParams, x: number, y: number, size = 30, delay = 0) {
  const A = p.rank.accent, unit = p.unit ?? "SOL";
  ctx.save(); ctx.globalAlpha = ease((k - delay) / 0.45); ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const cx = x + size, cy = y;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, size, 0, 7); ctx.clip();
  if (p.tokenImg) ctx.drawImage(p.tokenImg, cx - size, cy - size, size * 2, size * 2);
  else { ctx.fillStyle = A + "33"; ctx.fillRect(cx - size, cy - size, size * 2, size * 2); ctx.fillStyle = A; ctx.font = `900 ${size * 0.9}px ${MONO}`; ctx.textAlign = "center"; ctx.fillText((p.symbol || "?")[0].toUpperCase(), cx, cy + 1); ctx.textAlign = "left"; }
  ctx.restore();
  ctx.lineWidth = 4; ctx.strokeStyle = A; ctx.beginPath(); ctx.arc(cx, cy, size, 0, 7); ctx.stroke();
  let nameSize = size * 1.12;
  ctx.font = `800 ${nameSize}px ${MONO}`;
  while (ctx.measureText(p.symbol).width > 230 && nameSize > 16) { nameSize -= 1; ctx.font = `800 ${nameSize}px ${MONO}`; }
  ctx.fillStyle = "#fff";
  ctx.fillText(p.symbol, cx + size + 14, cy - size * 0.2);
  ctx.fillStyle = "#ffffff77"; ctx.font = `600 15px ${MONO}`;
  ctx.fillText(p.chipText ?? `${p.amountSol} ${unit} in${p.tag ? "  ·  " + p.tag : ""}`, cx + size + 14, cy + size * 0.72);
  ctx.restore();
}

function stamp(ctx: C, k: number, p: ShareParams, x: number, y: number, rot = 0.05) {
  const sp = back((k - 0.7) / 0.5); if (sp <= 0) return;
  const A = p.rank.accent;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sp, sp);
  ctx.font = `800 17px ${MONO}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const label = p.rank.name.split("").join(" ");
  const w = ctx.measureText(label).width + 30;
  ctx.lineWidth = 2; ctx.strokeStyle = A; ctx.strokeRect(-w + 8, -20, w, 40);
  ctx.fillStyle = A; ctx.fillText(label, -14, 1);
  ctx.restore();
}

function seal(ctx: C, k: number, p: ShareParams, cx: number, cy: number, r: number) {
  const sp = back((k - 0.55) / 0.6); if (sp <= 0) return;
  const A = p.rank.accent;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sp, sp);
  ctx.fillStyle = "rgba(8,8,10,.72)"; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, 7); ctx.fill();
  ctx.save(); ctx.rotate(k * 0.35); ctx.strokeStyle = A; ctx.lineWidth = 2; ctx.setLineDash([3, 9]);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2, l = i % 3 === 0 ? 12 : 6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r - 14), Math.sin(a) * (r - 14)); ctx.lineTo(Math.cos(a) * (r - 14 - l), Math.sin(a) * (r - 14 - l)); ctx.stroke(); }
  ctx.restore();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r - 26, 0, 7); ctx.stroke();
  const m = p.mult ?? 1 + p.pnl / 100, mv = 1 + (m - 1) * ease((k - 0.5) / 1.8);
  const s = r / 92;
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `900 ${(m >= 100 ? 30 : m >= 10 ? 36 : 44) * s}px ${HEAVY}`; ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 24;
  ctx.fillText(p.sealText ?? `${mv >= 100 ? mv.toFixed(0) : mv.toFixed(2)}×`, 0, -2 * s);
  ctx.shadowBlur = 0; ctx.fillStyle = A; ctx.font = `700 ${11 * s}px ${MONO}`; ctx.fillText(p.sealLabel ?? "FROM CALL", 0, 28 * s);
  ctx.restore();
}

function footer(ctx: C, k: number, p: ShareParams, left = 40, right = W - 40) {
  ctx.save(); ctx.globalAlpha = ease((k - 1.7) / 0.5); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff88"; ctx.font = `600 15px ${MONO}`;
  ctx.fillText(`${p.chainName ? p.chainName.toUpperCase() + "  ·  " : ""}${fmtMcap(p.entryMcap)} › ${fmtMcap(p.exitMcap ?? 0)}${p.ago ? "  ·  " + p.ago : ""}`, left, H - 30);
  ctx.textAlign = "right"; ctx.fillStyle = "#ff7b3d"; ctx.font = `900 18px ${MONO}`;
  ctx.fillText("W R A I T H . F A R M", right, H - 30);
  ctx.restore();
}

function fitFont(ctx: C, text: string, maxW: number, size: number, weight = 900, family = HEAVY): number {
  let sz = size;
  while (sz > 30) { ctx.font = `${weight} ${sz}px ${family}`; if (ctx.measureText(text).width <= maxW) break; sz -= 4; }
  ctx.font = `${weight} ${sz}px ${family}`;
  return sz;
}
const decOf = (p: ShareParams) => (Math.abs(p.solPnl) >= 10 ? 2 : Math.abs(p.solPnl) >= 1 ? 3 : 4);

// ── layouts ───────────────────────────────────────────────────────────────
function layoutPoster(ctx: C, k: number, p: ShareParams, flip: boolean) {
  const A = p.rank.accent, u = p.unit ?? "SOL";
  aurora(ctx, k, p, flip ? 260 : 700, 240, 420);
  ctx.save(); ctx.globalAlpha = 0.34 * ease((k - 0.15) / 0.8);
  fitFont(ctx, bigTxt(p, 1), W - 40, 250); ctx.lineWidth = 3; ctx.strokeStyle = A; ctx.lineJoin = "round"; ctx.textAlign = flip ? "right" : "left";
  ctx.strokeText(bigTxt(p, ease((k - 0.3) / 1.8)), flip ? W - 20 : 20, 372); ctx.restore();
  ghost(ctx, k, p, flip ? 220 : W - 190, H + 56, 560, flip);
  embers(ctx, k, p);
  const L = flip ? 560 : 0; // content shifts right when ghost is mirrored to the left
  tokenChip(ctx, k, p, 32 + L * 0.5, 62);
  stamp(ctx, k, p, W - 58, 50);
  seal(ctx, k, p, flip ? W - 168 : 168, 344, 92);
  const a2 = ease((k - 1.1) / 0.5); ctx.save(); ctx.globalAlpha = a2; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const x0 = (flip ? 760 : 290) - (flip ? 0 : 0);
  ctx.fillStyle = "#ffffff88"; ctx.font = `700 15px ${MONO}`; ctx.fillText(p.label ?? (p.call ? "FROM THE CALL" : p.pnl >= 0 ? "REALIZED" : "LOST"), flip ? 440 : 290, 322);
  ctx.fillStyle = A; ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 26; ctx.font = `900 44px ${HEAVY}`;
  ctx.fillText(res(p, p.solPnl * ease((k - 0.6) / 1.8)), flip ? 438 : 286, 372);
  ctx.shadowBlur = 0; ctx.fillStyle = "#ffffffaa"; ctx.font = `600 16px ${MONO}`;
  ctx.fillText(subOf(p, u), flip ? 440 : 290, 404);
  void x0; ctx.restore();
  footer(ctx, k, p);
}

function layoutBigNumber(ctx: C, k: number, p: ShareParams, flip: boolean) {
  const A = p.rank.accent, u = p.unit ?? "SOL";
  aurora(ctx, k, p, flip ? 740 : 220, 280, 420);
  ghost(ctx, k, p, flip ? W - 190 : 190, H + 70, 520, !flip);
  embers(ctx, k, p, 16);
  const rx = flip ? 44 : W - 44, al: CanvasTextAlign = flip ? "left" : "right";
  tokenChip(ctx, k, p, 32, 62);
  stamp(ctx, k, p, W - 58, 50);
  ctx.save(); ctx.textAlign = al; ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = ease((k - 0.3) / 0.5);
  ctx.fillStyle = "#ffffff77"; ctx.font = `700 16px ${MONO}`; ctx.fillText(p.pnl >= 0 ? "TOTAL RETURN" : "TOTAL LOSS", rx, 178);
  ctx.fillStyle = A; ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 40; fitFont(ctx, bigTxt(p, 1), flip ? 520 : 480, 190);
  ctx.fillText(bigTxt(p, ease((k - 0.35) / 1.8)), rx, 330); ctx.shadowBlur = 0;
  ctx.globalAlpha = ease((k - 1.1) / 0.5);
  ctx.fillStyle = "#fff"; ctx.font = `800 40px ${MONO}`; ctx.fillText(res(p, p.solPnl * ease((k - 0.6) / 1.8)), rx, 392);
  if (p.usdRate) { ctx.fillStyle = "#ffffff88"; ctx.font = `600 14px ${MONO}`; ctx.fillText(amt(p.solPnl, decOf(p), u), rx, 414); }
  // entry -> exit bar that "grows"
  const bw = 380, bx = flip ? rx : rx - bw, by = 430, g = ease((k - 1.3) / 1.2);
  ctx.fillStyle = "#ffffff18"; ctx.fillRect(bx, by, bw, 6);
  ctx.fillStyle = A; ctx.fillRect(bx, by, bw * g, 6);
  ctx.beginPath(); ctx.arc(bx + bw * g, by + 3, 8, 0, 7); ctx.fill();
  ctx.fillStyle = "#ffffff99"; ctx.font = `600 14px ${MONO}`; ctx.textAlign = "left"; ctx.fillText(fmtMcap(p.entryMcap), bx, by + 28);
  ctx.textAlign = "right"; ctx.fillText(fmtMcap(p.exitMcap ?? 0), bx + bw, by + 28);
  ctx.restore();
  footer(ctx, k, p, flip ? 40 : 40, W - 40);
}

function layoutTomb(ctx: C, k: number, p: ShareParams, flip: boolean) {
  const A = p.rank.accent, u = p.unit ?? "SOL";
  const ax = flip ? W - 70 - 300 : 70, ay = 36, aw = 300, ah = 450; // arch
  aurora(ctx, k, p, ax + aw / 2, 260, 360);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(ax, ay + ah); ctx.lineTo(ax, ay + aw / 2); ctx.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(ax + aw, ay + ah); ctx.closePath();
  const g = ctx.createLinearGradient(0, ay, 0, ay + ah); g.addColorStop(0, "rgba(255,255,255,.07)"); g.addColorStop(1, "rgba(255,255,255,.015)");
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = A; ctx.globalAlpha = 0.9; ctx.stroke();
  ctx.clip();
  ghost(ctx, k, p, ax + aw / 2, ay + ah + 40, 440, false, 120);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = A; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ax - 16, ay + ah); ctx.lineTo(ax - 16, ay + aw / 2); ctx.arc(ax + aw / 2, ay + aw / 2, aw / 2 + 16, Math.PI, 0); ctx.lineTo(ax + aw + 16, ay + ah); ctx.stroke(); ctx.restore();
  embers(ctx, k, p, 14);
  const cx = flip ? 60 : 440;
  tokenChip(ctx, k, p, cx, 80);
  stamp(ctx, k, p, flip ? 545 : W - 58, 50);
  ctx.save(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.globalAlpha = ease((k - 0.35) / 0.5); ctx.fillStyle = A; ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 36; fitFont(ctx, bigTxt(p, 1), (flip ? 330 : W - 440 - 30), 140);
  ctx.fillText(bigTxt(p, ease((k - 0.35) / 1.8)), cx, 270); ctx.shadowBlur = 0;
  ctx.globalAlpha = ease((k - 1) / 0.5); ctx.fillStyle = "#fff"; ctx.font = `800 36px ${MONO}`;
  ctx.fillText(res(p, p.solPnl * ease((k - 0.6) / 1.8)), cx, 326);
  const rows: [string, string][] = p.call ? [["CALLED", fmtMcap(p.entryMcap)], ["NOW", fmtMcap(p.exitMcap ?? 0)], ["RANK", p.rank.name]] : [["INVESTED", `${p.amountSol} ${u}`], ["POSITION", `${(p.amountSol * (1 + p.pnl / 100)).toFixed(3)} ${u}`], ["MULTIPLE", `${(p.mult ?? 1 + p.pnl / 100).toFixed(2)}×`]];
  rows.forEach(([a, b], i) => { ctx.globalAlpha = ease((k - 1.3 - i * 0.15) / 0.4); ctx.fillStyle = "#ffffff77"; ctx.font = `700 14px ${MONO}`; ctx.fillText(a, cx, 376 + i * 30); ctx.fillStyle = "#fff"; ctx.font = `800 18px ${MONO}`; ctx.fillText(b, cx + 130, 376 + i * 30); });
  ctx.restore();
  footer(ctx, k, p, flip ? 40 : 40, W - 40);
}

function layoutTerminal(ctx: C, k: number, p: ShareParams, flip: boolean) {
  const A = p.rank.accent, u = p.unit ?? "SOL";
  aurora(ctx, k, p, flip ? 220 : 720, 260, 380);
  ghost(ctx, k, p, flip ? 220 : W - 200, H + 40, 500, flip, 140, true);
  const x0 = flip ? 470 : 44;
  const lines: [string, string, string, number][] = [
    ["token", `$${p.symbol}`, "#fff", 26],
    ["called", fmtMcap(p.entryMcap), "#ffffffcc", 26],
    ["exited", fmtMcap(p.exitMcap ?? 0), "#ffffffcc", 26],
    ["pnl", bigTxt(p, 1), A, 70],
    ["result", res(p, p.solPnl), A, 34],
    ["rank", p.rank.name.toLowerCase(), "#ffffffaa", 24],
  ];
  let y = 120, chars = Math.floor(Math.max(0, k - 0.2) * 38);
  ctx.save(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  for (const [lab, val, col, size] of lines) {
    if (size > 40) y += 14;
    const full = `> ${lab.padEnd(7, " ")}`;
    const shownLab = full.slice(0, Math.max(0, chars)); chars -= full.length;
    ctx.fillStyle = "#ffffff55"; ctx.font = `600 22px ${MONO}`; ctx.fillText(shownLab, x0, y);
    if (chars > 0) {
      const vs = val.slice(0, Math.max(0, chars)); chars -= val.length;
      ctx.fillStyle = col; ctx.font = `800 ${size}px ${MONO}`;
      if (col === A) { ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 24; }
      ctx.fillText(vs, x0 + 24 + 7 * 22 * 0.6 + 40, y);
      ctx.shadowBlur = 0;
    }
    y += size > 40 ? 78 : 52;
  }
  if (Math.floor(k * 2) % 2 === 0) { ctx.fillStyle = A; ctx.fillRect(x0, y - 20, 14, 26); }
  ctx.restore();
  // scanlines
  ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = "#000"; for (let yy = 0; yy < H; yy += 4) ctx.fillRect(0, yy, W, 2); ctx.restore();
  stamp(ctx, k, p, W - 58, 50);
  footer(ctx, k, p);
}

function layoutSpot(ctx: C, k: number, p: ShareParams, flip: boolean) {
  const A = p.rank.accent, u = p.unit ?? "SOL";
  // spotlight cone
  ctx.save(); const a = ease(k / 0.9);
  const cg = ctx.createLinearGradient(0, 0, 0, H); cg.addColorStop(0, A + "55"); cg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.42 * a; ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(W / 2 - 40, 0); ctx.lineTo(W / 2 + 40, 0); ctx.lineTo(W / 2 + 330, H); ctx.lineTo(W / 2 - 330, H); ctx.closePath(); ctx.fill(); ctx.restore();
  ghost(ctx, k, p, W / 2, 360, 360, flip, 120);
  embers(ctx, k, p, 18);
  tokenChip(ctx, k, p, 32, 62); stamp(ctx, k, p, W - 58, 50);
  seal(ctx, k, p, 150, 280, 82);
  ctx.save(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
  ctx.globalAlpha = ease((k - 1) / 0.5); ctx.fillStyle = "#ffffff88"; ctx.font = `700 15px ${MONO}`; ctx.fillText(p.label ?? (p.call ? "FROM THE CALL" : p.pnl >= 0 ? "REALIZED" : "LOST"), W - 44, 250);
  ctx.fillStyle = "#fff"; ctx.font = `800 36px ${MONO}`; ctx.fillText(res(p, p.solPnl * ease((k - 0.6) / 1.8)), W - 44, 292);
  ctx.fillStyle = "#ffffffaa"; ctx.font = `600 16px ${MONO}`; ctx.fillText(subOf(p, u), W - 44, 322);
  ctx.textAlign = "center"; ctx.globalAlpha = ease((k - 0.35) / 0.5);
  ctx.fillStyle = A; ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 40; fitFont(ctx, bigTxt(p, 1), 560, 130);
  ctx.fillText(bigTxt(p, ease((k - 0.35) / 1.8)), W / 2, 470);
  ctx.restore();
  footer(ctx, k, p);
}

function layoutRing(ctx: C, k: number, p: ShareParams, flip: boolean) {
  const A = p.rank.accent, u = p.unit ?? "SOL";
  const gx = flip ? 250 : W - 250, gy = 280;
  aurora(ctx, k, p, gx, gy, 400);
  // giant rotating ring + orbiting dots
  ctx.save(); ctx.translate(gx, gy); ctx.strokeStyle = A; ctx.lineWidth = 2;
  ctx.save(); ctx.rotate(k * 0.25); ctx.globalAlpha = 0.5; ctx.setLineDash([2, 12]); ctx.beginPath(); ctx.arc(0, 0, 260, 0, 7); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.rotate(-k * 0.4); ctx.globalAlpha = 0.9; ctx.setLineDash([60, 40]); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 215, 0, 7); ctx.stroke(); ctx.restore();
  ctx.fillStyle = A; for (let i = 0; i < 3; i++) { const a = k * 0.8 + (i * Math.PI * 2) / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 260, Math.sin(a) * 260, 6, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(gx, gy, 262, 0, 7); ctx.clip();
  ghost(ctx, k, p, gx, gy + 270, 520, flip, 140);
  ctx.restore();
  embers(ctx, k, p, 14);
  const x0 = flip ? 520 : 44;
  tokenChip(ctx, k, p, x0 - 12, 62); stamp(ctx, k, p, x0 + 100, 124);
  ctx.save(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  ctx.globalAlpha = ease((k - 0.35) / 0.5); ctx.fillStyle = A; ctx.shadowColor = p.rank.glow; ctx.shadowBlur = 36; fitFont(ctx, bigTxt(p, 1), flip ? W - x0 - 30 : 390, 118);
  ctx.fillText(bigTxt(p, ease((k - 0.35) / 1.8)), x0, 270); ctx.shadowBlur = 0;
  ctx.globalAlpha = ease((k - 1) / 0.5); ctx.fillStyle = "#fff"; ctx.font = `800 34px ${MONO}`; ctx.fillText(res(p, p.solPnl * ease((k - 0.6) / 1.8)), x0, 326);
  ctx.fillStyle = "#ffffffaa"; ctx.font = `600 16px ${MONO}`; ctx.fillText(subOf(p, u), x0, 356);
  ctx.restore();
  seal(ctx, k, p, x0 + 70, 440, 60);
  footer(ctx, k, p, flip ? 40 : 40, W - 40);
}

const LAYOUTS = [layoutPoster, layoutBigNumber, layoutTomb, layoutTerminal, layoutSpot, layoutRing];

export function drawShareCard(ctx: C, k: number, p: ShareParams) {
  const vv = Math.abs(p.variant ?? 0) % SHARE_VARIANTS, v = vv % SHARE_BASE;
  p = { ...p, char: Math.floor(vv / SHARE_BASE) % SHARE_CHARS };
  const layout = v % SHARE_LAYOUTS, motif = Math.floor(v / SHARE_LAYOUTS) % SHARE_MOTIFS, flip = v >= SHARE_LAYOUTS * SHARE_MOTIFS;
  ctx.save(); ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.fillStyle = "#08080a"; ctx.fillRect(0, 0, W, H);
  background(ctx, k, p, motif);
  LAYOUTS[layout](ctx, k, p, flip);
  ctx.restore();
}

export function loadShareImage(src?: string | null): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    if (!src) return res(null);
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
  });
}

export async function recordShareClip(p: ShareParams): Promise<{ blob: Blob; ext: string } | null> {
  if (typeof MediaRecorder === "undefined") return null;
  const mime = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => { const k = (performance.now() - t0) / 1000; drawShareCard(ctx, Math.min(k, SHARE_DUR), p); if (k < SHARE_DUR) requestAnimationFrame(tick); else resolve(); };
    tick();
  });
  rec.stop(); await done;
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
}

export function renderSharePng(p: ShareParams): Promise<Blob | null> {
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); if (!ctx) return Promise.resolve(null);
  drawShareCard(ctx, 3.4, p);
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}
