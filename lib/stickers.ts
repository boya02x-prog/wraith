"use client";

// Built-in animated Wraith stickers: the Wraith ghost with props and a lettered banner, drawn frame by frame on a canvas and
// packed into a looping APNG (see lib/apng.ts). Works with no external service or API key. The result is a small PNG data URL,
// the same format photo and GIF attachments already use, and it animates in a plain <img>.
import { framesToApng } from "@/lib/apng";

export type Prop =
  | "sparkles" | "tears" | "flames" | "crack" | "sun" | "sleep" | "rocket" | "diamond" | "paper" | "broom"
  | "moon" | "candles" | "clock" | "shades" | "clown" | "gym";
export type Mood = "happy" | "grin" | "sad" | "wow" | "smirk" | "sleepy";

export interface StickerDef { id: string; text: string; bg: string; prop: Prop; mood: Mood; tilt?: number }

export const STICKERS: StickerDef[] = [
  { id: "wagmi", mood: "happy", text: "WAGMI", bg: "#22c55e", prop: "sparkles", tilt: -4 },
  { id: "ngmi", mood: "sad", text: "NGMI", bg: "#ef4444", prop: "tears", tilt: 4 },
  { id: "lfg", mood: "grin", text: "LFG", bg: "#ff7b3d", prop: "flames", tilt: -3 },
  { id: "rekt", mood: "sad", text: "REKT", bg: "#991b1b", prop: "crack", tilt: 4 },
  { id: "gm", mood: "happy", text: "GM", bg: "#f59e0b", prop: "sun", tilt: -3 },
  { id: "gn", mood: "sleepy", text: "GN", bg: "#4f46e5", prop: "sleep", tilt: 3 },
  { id: "sendit", mood: "grin", text: "SEND IT", bg: "#f97316", prop: "rocket", tilt: -4 },
  { id: "diamond", mood: "smirk", text: "DIAMOND HANDS", bg: "#0891b2", prop: "diamond", tilt: 3 },
  { id: "paper", mood: "sad", text: "PAPER HANDS", bg: "#64748b", prop: "paper", tilt: -3 },
  { id: "rugged", mood: "sad", text: "RUGGED", bg: "#7c2d12", prop: "broom", tilt: 4 },
  { id: "moon", mood: "happy", text: "TO THE MOON", bg: "#7c3aed", prop: "moon", tilt: -3 },
  { id: "dip", mood: "grin", text: "BUY THE DIP", bg: "#059669", prop: "candles", tilt: 3 },
  { id: "early", mood: "wow", text: "SO EARLY", bg: "#db2777", prop: "clock", tilt: -4 },
  { id: "based", mood: "smirk", text: "BASED", bg: "#0284c7", prop: "shades", tilt: 3 },
  { id: "cope", mood: "sad", text: "COPE", bg: "#78716c", prop: "clown", tilt: -3 },
  { id: "hodl", mood: "grin", text: "HODL", bg: "#ca8a04", prop: "gym", tilt: 3 },
];

const SIZE = 256; // drawing space
const OUT = 144; // pixels per frame (keeps the animated file well under the 450k-character post limit)
const FRAMES = 10;
const FRAME_MS = 90;
const GW = 108;
const GH = 170;
const GX = (SIZE - GW) / 2;
const GY = 14;
const CX = SIZE / 2;
const EYE_Y = GY + GH * 0.378;
const TAU = Math.PI * 2;
/** smooth loop value in -1..1; k = cycles per loop, o = phase offset */
const S = (t: number, k = 1, o = 0) => Math.sin(TAU * (t * k + o));

let ghostImg: Promise<HTMLImageElement> | null = null;
function loadGhost(): Promise<HTMLImageElement> {
  if (!ghostImg) {
    ghostImg = new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("ghost"));
      i.src = "/ghost.png";
    });
  }
  return ghostImg;
}

function family(): string {
  try {
    const f = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
    return f ? `${f}, Impact, "Arial Narrow", sans-serif` : 'Impact, "Arial Narrow", sans-serif';
  } catch {
    return "Impact, sans-serif";
  }
}

const hex = (h: string): [number, number, number] => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function shade(h: string, amt: number): string {
  const [r, g, b] = hex(h);
  const t = amt < 0 ? 0 : 255, k = Math.abs(amt);
  return `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
}

// the ghost silhouette is the same every frame, so build the white outline once
let outlineCache: HTMLCanvasElement | null = null;
function outline(img: HTMLImageElement): HTMLCanvasElement {
  if (outlineCache) return outlineCache;
  const sil = document.createElement("canvas");
  sil.width = SIZE; sil.height = SIZE;
  const s = sil.getContext("2d")!;
  s.drawImage(img, GX, GY, GW, GH);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "#fff"; s.fillRect(0, 0, SIZE, SIZE);
  const ring = document.createElement("canvas");
  ring.width = SIZE; ring.height = SIZE;
  const r = ring.getContext("2d")!;
  r.shadowColor = "rgba(0,0,0,.4)"; r.shadowBlur = 12; r.shadowOffsetY = 5;
  for (let a = 0; a < TAU; a += Math.PI / 12) r.drawImage(sil, Math.cos(a) * 7, Math.sin(a) * 7);
  outlineCache = ring;
  return ring;
}

// ── small drawing helpers ─────────────────────────────────────────────────────
const star = (c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rot = 0) => {
  c.fillStyle = color; c.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + rot, rr = i % 2 ? r * 0.32 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fill();
};
const drop = (c: CanvasRenderingContext2D, x: number, y: number, s: number) => {
  c.fillStyle = "#60a5fa"; c.strokeStyle = "#fff"; c.lineWidth = 3;
  c.beginPath(); c.moveTo(x, y - s); c.quadraticCurveTo(x + s * 0.9, y + s * 0.2, x, y + s); c.quadraticCurveTo(x - s * 0.9, y + s * 0.2, x, y - s); c.closePath(); c.stroke(); c.fill();
};
const flame = (c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) => {
  c.fillStyle = color; c.beginPath();
  c.moveTo(x, y - s); c.quadraticCurveTo(x + s * 0.9, y - s * 0.2, x + s * 0.5, y + s * 0.7);
  c.quadraticCurveTo(x, y + s * 1.05, x - s * 0.5, y + s * 0.7); c.quadraticCurveTo(x - s * 0.9, y - s * 0.2, x, y - s); c.fill();
};
const outlineText = (c: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, fill: string, stroke: string) => {
  c.font = `${size}px ${family()}`; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  c.lineWidth = Math.max(5, size / 5); c.strokeStyle = stroke; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y);
};

function face(c: CanvasRenderingContext2D, mood: Mood, t: number) {
  const y = EYE_Y + 28;
  c.save();
  c.fillStyle = "rgba(255, 105, 140, .55)";
  const pulse = 1 + 0.12 * S(t, 2);
  c.beginPath(); c.ellipse(CX - 30, y - 4, 9 * pulse, 6 * pulse, 0, 0, TAU); c.ellipse(CX + 30, y - 4, 9 * pulse, 6 * pulse, 0, 0, TAU); c.fill();
  c.strokeStyle = "#5a2208"; c.fillStyle = "#5a2208"; c.lineWidth = 3.5; c.lineCap = "round"; c.lineJoin = "round";
  c.beginPath();
  if (mood === "happy") { c.arc(CX, y - 2, 11, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
  else if (mood === "grin") { c.moveTo(CX - 13, y - 3); c.quadraticCurveTo(CX, y + 18, CX + 13, y - 3); c.closePath(); c.fill(); c.fillStyle = "#fff"; c.fillRect(CX - 9, y - 3, 18, 4); }
  else if (mood === "sad") { c.arc(CX, y + 12, 10, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke(); }
  else if (mood === "wow") { c.ellipse(CX, y + 4, 6, 8 + 2 * S(t, 2), 0, 0, TAU); c.fill(); }
  else if (mood === "smirk") { c.moveTo(CX - 10, y + 2); c.quadraticCurveTo(CX + 2, y + 10, CX + 13, y - 3); c.stroke(); }
  else { c.moveTo(CX - 7, y + 4); c.lineTo(CX + 7, y + 4); c.stroke(); }
  c.restore();
}

/** Props behind the ghost. */
function propBehind(c: CanvasRenderingContext2D, p: Prop, t: number) {
  if (p === "sun") {
    c.lineCap = "round"; c.strokeStyle = "#fde047"; c.lineWidth = 9;
    const spin = (t * Math.PI) / 6; // 12 rays: a 1/12 turn loops seamlessly
    for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6 + spin; c.beginPath(); c.moveTo(CX + Math.cos(a) * 64, 90 + Math.sin(a) * 64); c.lineTo(CX + Math.cos(a) * 100, 90 + Math.sin(a) * 100); c.stroke(); }
    c.fillStyle = "#fef08a"; c.beginPath(); c.arc(CX, 90, 70 + 2 * S(t), 0, TAU); c.fill();
  } else if (p === "moon") {
    const dy = 4 * S(t);
    c.fillStyle = "#fef3c7"; c.beginPath(); c.arc(CX + 44, 74 + dy, 62, 0, TAU); c.fill();
    c.fillStyle = "rgba(0,0,0,.08)"; for (const [x, y, r] of [[CX + 66, 56, 11], [CX + 40, 100, 8], [CX + 78, 96, 6]]) { c.beginPath(); c.arc(x, y + dy, r, 0, TAU); c.fill(); }
    for (const [x, y, r, o] of [[CX - 76, 60, 18, 0], [CX - 60, 120, 11, 0.3], [CX + 20, 24, 10, 0.6]] as const) star(c, x, y, r * (0.7 + 0.3 * S(t, 1, o)), o ? "#fff" : "#fde047");
  } else if (p === "flames") {
    const f = (x: number, y: number, s: number, col: string, o: number) => flame(c, x + 2 * S(t, 2, o), y, s * (1 + 0.14 * S(t, 2, o)), col);
    f(CX - 62, 128, 40, "#fbbf24", 0.1); f(CX + 62, 128, 40, "#fbbf24", 0.6);
    f(CX - 40, 108, 52, "#ef4444", 0.3); f(CX + 40, 108, 52, "#ef4444", 0.8);
    f(CX, 92, 62, "#fb923c", 0);
  } else if (p === "candles") {
    const bars = [[CX - 80, 130, 24, "#ef4444", 0], [CX - 50, 112, 24, "#ef4444", 0.25], [CX + 24, 118, 26, "#22c55e", 0.5], [CX + 56, 82, 34, "#22c55e", 0.75]] as const;
    for (const [x, y, h, col, o] of bars) {
      const k = 0.78 + 0.22 * S(t, 1, o); // each candle breathes
      const top = y + h * 2 * (1 - k);
      c.fillStyle = col; c.strokeStyle = "#fff"; c.lineWidth = 3; c.fillRect(x, top, 22, h * 2 * k); c.strokeRect(x, top, 22, h * 2 * k); c.fillRect(x + 9, top - 14, 4, 14);
    }
  } else if (p === "sparkles") {
    for (const [x, y, r, o] of [[CX - 78, 54, 22, 0], [CX + 80, 64, 26, 0.35], [CX + 66, 128, 14, 0.6], [CX - 66, 120, 12, 0.85]] as const) {
      star(c, x, y, r * (0.55 + 0.45 * Math.abs(S(t, 1, o))), o > 0.5 ? "#fff" : "#fde047", t * 0.6);
    }
  }
}

/** Props that ride with the ghost. */
function propFront(c: CanvasRenderingContext2D, p: Prop, t: number) {
  switch (p) {
    case "tears":
      for (const [x, o] of [[CX - 22, 0], [CX + 22, 0.5]] as const) {
        const ph = (t + o) % 1;
        c.globalAlpha = Math.sin(Math.PI * Math.min(1, ph * 1.05));
        drop(c, x, EYE_Y + 18 + ph * 50, 10);
      }
      c.globalAlpha = 1;
      break;
    case "crack": {
      c.strokeStyle = "#fff"; c.lineWidth = 6; c.lineJoin = "round"; c.beginPath();
      c.moveTo(CX - 8, GY + 8); c.lineTo(CX + 6, GY + 44); c.lineTo(CX - 10, GY + 70); c.lineTo(CX + 8, GY + 110); c.stroke();
      c.strokeStyle = "#111"; c.lineWidth = 3; c.stroke();
      const ph = t % 1; c.globalAlpha = Math.sin(Math.PI * ph); drop(c, CX - 22, EYE_Y + 18 + ph * 40, 9); c.globalAlpha = 1;
      const dy = 6 * Math.abs(S(t, 1)); // arrow keeps sinking
      c.fillStyle = "#ef4444"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.moveTo(CX + 40, 150 + dy); c.lineTo(CX + 80, 150 + dy); c.lineTo(CX + 80, 178 + dy); c.lineTo(CX + 96, 178 + dy); c.lineTo(CX + 60, 206 + dy); c.lineTo(CX + 24, 178 + dy); c.lineTo(CX + 40, 178 + dy); c.closePath(); c.stroke(); c.fill();
      break;
    }
    case "sleep":
      c.fillStyle = "#6366f1"; c.strokeStyle = "#fff"; c.lineWidth = 4;
      c.beginPath(); c.moveTo(CX - 40, GY + 36); c.quadraticCurveTo(CX, GY - 22, CX + 60, GY - 4); c.lineTo(CX + 54, GY + 40); c.quadraticCurveTo(CX + 10, GY + 14, CX - 40, GY + 36); c.closePath(); c.stroke(); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(CX + 62 + 3 * S(t), GY - 4 + 2 * S(t, 2), 9, 0, TAU); c.fill();
      for (let k = 0; k < 3; k++) {
        const ph = (t + k / 3) % 1;
        c.globalAlpha = Math.sin(Math.PI * ph);
        outlineText(c, k % 2 ? "z" : "Z", CX + 66 + ph * 26, 96 - ph * 56, 22 + ph * 18, "#fff", "#312e81");
      }
      c.globalAlpha = 1;
      break;
    case "rocket": {
      const dx = 2 * S(t, 6), dy = 3 * S(t, 3);
      c.save(); c.translate(CX + 56 + dx, 140 + dy); c.rotate(-0.6);
      c.fillStyle = "#f8fafc"; c.strokeStyle = "#fff"; c.lineWidth = 5; c.beginPath(); c.moveTo(0, -44); c.quadraticCurveTo(26, -10, 18, 30); c.lineTo(-18, 30); c.quadraticCurveTo(-26, -10, 0, -44); c.closePath(); c.stroke(); c.fill();
      c.fillStyle = "#ef4444"; c.beginPath(); c.moveTo(0, -44); c.quadraticCurveTo(14, -30, 14, -20); c.lineTo(-14, -20); c.quadraticCurveTo(-14, -30, 0, -44); c.fill();
      c.fillStyle = "#38bdf8"; c.beginPath(); c.arc(0, -2, 8, 0, TAU); c.fill();
      flame(c, 0, 48 + 4 * S(t, 4), 16 + 6 * Math.abs(S(t, 4)), "#fbbf24");
      flame(c, 0, 46 + 3 * S(t, 4, 0.3), 9 + 4 * Math.abs(S(t, 4, 0.3)), "#ef4444");
      c.restore();
      break;
    }
    case "diamond": {
      const k = 1 + 0.06 * S(t);
      c.save(); c.translate(CX, 150); c.scale(k, k);
      c.fillStyle = "#67e8f9"; c.strokeStyle = "#fff"; c.lineWidth = 5; c.lineJoin = "round";
      c.beginPath(); c.moveTo(-34, -14); c.lineTo(-18, -34); c.lineTo(18, -34); c.lineTo(34, -14); c.lineTo(0, 34); c.closePath(); c.stroke(); c.fill();
      c.strokeStyle = "rgba(255,255,255,.8)"; c.lineWidth = 2; c.beginPath(); c.moveTo(-34, -14); c.lineTo(34, -14); c.moveTo(-18, -34); c.lineTo(-8, -14); c.lineTo(0, 34); c.moveTo(18, -34); c.lineTo(8, -14); c.lineTo(0, 34); c.stroke();
      c.restore();
      star(c, CX + 44, 118, 6 + 8 * Math.abs(S(t, 1, 0.2)), "#fff", t);
      star(c, CX - 40, 132, 4 + 6 * Math.abs(S(t, 1, 0.7)), "#fff", -t);
      break;
    }
    case "paper":
      c.save(); c.translate(CX + 58, 120); c.rotate(0.22 * S(t)); c.translate(0, 28);
      c.fillStyle = "#f8fafc"; c.strokeStyle = "#cbd5e1"; c.lineWidth = 3; c.beginPath(); c.ellipse(0, 0, 26, 30, 0, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = "#94a3b8"; c.beginPath(); c.ellipse(0, 0, 9, 11, 0, 0, TAU); c.fill();
      c.strokeStyle = "#f8fafc"; c.lineWidth = 9; c.beginPath(); c.moveTo(-4, 28); c.quadraticCurveTo(-20 + 6 * S(t, 2), 44, -6, 56); c.stroke();
      c.restore();
      { const ph = t % 1; c.globalAlpha = Math.sin(Math.PI * ph); drop(c, CX - 22, EYE_Y + 18 + ph * 40, 8); c.globalAlpha = 1; }
      break;
    case "broom":
      c.save(); c.translate(CX - 56, 118); c.rotate(0.5 + 0.38 * S(t)); c.translate(0, 32);
      c.strokeStyle = "#a16207"; c.lineWidth = 8; c.lineCap = "round"; c.beginPath(); c.moveTo(0, -50); c.lineTo(0, 22); c.stroke();
      c.fillStyle = "#facc15"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.moveTo(-14, 22); c.lineTo(14, 22); c.lineTo(24, 58); c.lineTo(-24, 58); c.closePath(); c.stroke(); c.fill();
      c.restore();
      { const dx = 6 * S(t, 1, 0.25); c.fillStyle = "#dc2626"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.moveTo(CX + 20 + dx, 176); c.lineTo(CX + 96 + dx, 168); c.lineTo(CX + 100 + dx, 186); c.lineTo(CX + 22 + dx, 196); c.closePath(); c.stroke(); c.fill(); }
      break;
    case "clock":
      c.save(); c.translate(CX + 58, 150);
      c.fillStyle = "#fff"; c.strokeStyle = "#111"; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 28, 0, TAU); c.fill(); c.stroke();
      c.lineCap = "round"; c.lineWidth = 4;
      c.save(); c.rotate(TAU * t); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -19); c.stroke(); c.restore();
      c.save(); c.rotate(TAU * t / 12); c.lineWidth = 5; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -12); c.stroke(); c.restore();
      c.fillStyle = "#ef4444"; c.save(); c.rotate(0.12 * S(t, 6));
      c.beginPath(); c.arc(-26, -22, 8, 0, TAU); c.arc(26, -22, 8, 0, TAU); c.fill(); c.restore();
      c.restore();
      break;
    case "shades": {
      c.fillStyle = "#0b0b0d"; c.strokeStyle = "#fff"; c.lineWidth = 3;
      for (const x of [CX - 30, CX + 6]) { c.beginPath(); c.roundRect?.(x, EYE_Y - 14, 26, 24, 7); c.fill(); c.stroke(); }
      c.fillRect(CX - 6, EYE_Y - 8, 12, 5);
      // a glint sweeping across both lenses
      c.save(); c.beginPath(); c.roundRect?.(CX - 30, EYE_Y - 14, 26, 24, 7); c.roundRect?.(CX + 6, EYE_Y - 14, 26, 24, 7); c.clip();
      const gx = CX - 46 + t * 96;
      c.fillStyle = "rgba(255,255,255,.55)"; c.save(); c.translate(gx, EYE_Y); c.rotate(0.5); c.fillRect(-4, -26, 8, 52); c.restore();
      c.restore();
      break;
    }
    case "clown": {
      const k = 1 + 0.3 * Math.max(0, S(t, 2));
      c.fillStyle = "#ef4444"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(CX, EYE_Y + 24, 12 * k, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = "#22c55e"; c.beginPath(); c.arc(CX - 50, GY + 36 + 2 * S(t, 2), 16, 0, TAU); c.arc(CX + 50, GY + 36 + 2 * S(t, 2, 0.5), 16, 0, TAU); c.fill();
      c.fillStyle = "#3b82f6"; c.beginPath(); c.arc(CX - 56, GY + 56 + 2 * S(t, 2, 0.25), 12, 0, TAU); c.arc(CX + 56, GY + 56 + 2 * S(t, 2, 0.75), 12, 0, TAU); c.fill();
      { const ph = t % 1; c.globalAlpha = Math.sin(Math.PI * ph); drop(c, CX - 22, EYE_Y + 22 + ph * 36, 8); c.globalAlpha = 1; }
      break;
    }
    case "gym": {
      const lift = -14 * Math.abs(S(t, 1)) ;
      c.strokeStyle = "#111"; c.lineWidth = 7; c.lineCap = "round"; c.beginPath(); c.moveTo(CX - 62, 150 + lift); c.lineTo(CX + 62, 150 + lift); c.stroke();
      c.fillStyle = "#1f2937"; c.strokeStyle = "#fff"; c.lineWidth = 3;
      for (const [x, h] of [[CX - 70, 44], [CX - 52, 32], [CX + 52, 32], [CX + 64, 44]] as const) { c.beginPath(); c.roundRect?.(x - 7, 150 + lift - h / 2, 14, h, 4); c.fill(); c.stroke(); }
      break;
    }
    default:
      break;
  }
}

function drawFrame(c: CanvasRenderingContext2D, img: HTMLImageElement, def: StickerDef, t: number) {
  c.setTransform(OUT / SIZE, 0, 0, OUT / SIZE, 0, 0);
  c.clearRect(0, 0, SIZE, SIZE);
  c.save();
  c.translate(CX, SIZE / 2); c.rotate(((def.tilt ?? 0) * Math.PI) / 180); c.translate(-CX, -SIZE / 2);

  propBehind(c, def.prop, t);

  // the ghost and everything attached to it bob and wobble together
  let dy = 4 * S(t), dx = 0, rot = 0.05 * S(t, 1, 0.25);
  if (def.prop === "crack") { dx = 3 * S(t, 4); dy = 1.5 * S(t, 2); rot = 0.03 * S(t, 4); }
  else if (def.prop === "rocket") { dx = 1.5 * S(t, 6); dy = 3 * S(t, 3); }
  else if (def.prop === "gym") { dy = 10 * Math.abs(S(t, 1)); rot = 0.02 * S(t, 2); }
  else if (def.prop === "tears" || def.prop === "paper" || def.prop === "clown") { dy = 2 * S(t); rot = 0.035 * S(t, 2); }
  c.save();
  c.translate(CX + dx, GY + GH + dy); c.rotate(rot); c.translate(-CX, -(GY + GH));
  c.drawImage(outline(img), 0, 0);
  c.drawImage(img, GX, GY, GW, GH);
  face(c, def.mood, t);
  propFront(c, def.prop, t);
  c.restore();

  // banner with the word, on a die-cut white edge
  const pulse = 1 + 0.018 * Math.max(0, S(t, 2));
  const bw = SIZE - 28, bh = 54, bx = 14, by = SIZE - bh - 12;
  c.translate(CX, by + bh / 2); c.scale(pulse, pulse); c.translate(-CX, -(by + bh / 2));
  const rr = (x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  c.save();
  c.shadowColor = "rgba(0,0,0,.4)"; c.shadowBlur = 10; c.shadowOffsetY = 4;
  c.fillStyle = "#fff"; rr(bx - 5, by - 5, bw + 10, bh + 10, 22); c.fill();
  c.restore();
  const g = c.createLinearGradient(0, by, 0, by + bh);
  g.addColorStop(0, shade(def.bg, 0.2)); g.addColorStop(1, shade(def.bg, -0.18));
  c.fillStyle = g; rr(bx, by, bw, bh, 18); c.fill();
  c.save(); rr(bx, by, bw, bh, 18); c.clip();
  const gl = c.createLinearGradient(0, by, 0, by + bh * 0.5); gl.addColorStop(0, "rgba(255,255,255,.35)"); gl.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gl; c.fillRect(bx, by, bw, bh * 0.5);
  // a shine that slides across the banner once per loop
  const sx = bx - 40 + t * (bw + 80);
  c.fillStyle = "rgba(255,255,255,.28)"; c.save(); c.translate(sx, by + bh / 2); c.rotate(0.35); c.fillRect(-9, -bh, 18, bh * 2); c.restore();
  c.restore();

  let size = 40;
  c.font = `${size}px ${family()}`;
  while (size > 20 && c.measureText(def.text).width > bw - 26) { size -= 2; c.font = `${size}px ${family()}`; }
  outlineText(c, def.text, CX, by + bh / 2 + 2, size, "#fff", shade(def.bg, -0.6));
  c.restore();
}

/** One animated sticker as an APNG data URL (falls back to fewer frames if the file would be too large to post). */
export async function renderSticker(def: StickerDef): Promise<string> {
  const img = await loadGhost();
  const cv = document.createElement("canvas");
  cv.width = OUT; cv.height = OUT;
  const c = cv.getContext("2d");
  if (!c) return "";
  const grab = (n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) { drawFrame(c, img, def, i / n); out.push(cv.toDataURL("image/png")); }
    return out;
  };
  let url = framesToApng(grab(FRAMES), FRAME_MS);
  if (url.length > 380_000) url = framesToApng(grab(6), Math.round((FRAME_MS * FRAMES) / 6)); // last resort, keeps it postable
  return url;
}

/** Renders every sticker, handing each one over as soon as it is ready so the sheet fills in progressively. */
export async function renderAllStickers(onItem: (s: { id: string; text: string; src: string }) => void): Promise<void> {
  try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }
  for (const s of STICKERS) {
    try { onItem({ id: s.id, text: s.text, src: await renderSticker(s) }); } catch { /* skip a sticker that failed */ }
    await new Promise((r) => setTimeout(r, 0)); // let the page breathe between stickers
  }
}
