"use client";
// Share studio, like Fomo's: swipe between a Bio card and a Profit card, pick the period, hide the avatar or the stats, choose a background
// (art drawn in code, your avatar, or your own photo with framing and a darken slider) and share the picture.
// It opens from the Share button on the profile, and by itself right after a screenshot: the Android app tells the page with a
// "wraith-screenshot" event (see MainActivity.java and app/app/profile/page.tsx).
// Every card is drawn on a canvas, so what you see is exactly the picture that gets shared. Numbers come from the profile page; nothing is made up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Crop, Download, ImagePlus, Search, SlidersHorizontal, X } from "lucide-react";
import { drawScene } from "@/lib/shareScenes";

export type ShareTrade = { ts: number; usd: number }; // realized profit (+) or loss (-) of one closed trade, or the size of one trade, in display currency
type Range = "24h" | "7d" | "30d";
type Frame = { z: number; x: number; y: number }; // photo framing: zoom (1 = just covers the card) and offset in card pixels
type Mascots = { king: HTMLImageElement | null; wave: HTMLImageElement | null; oops: HTMLImageElement | null; sleep: HTMLImageElement | null };
type Imgs = { av: HTMLImageElement | null; ghost: HTMLImageElement | null; mascot: Mascots };
const NO_MASCOTS: Mascots = { king: null, wave: null, oops: null, sleep: null };
type Photo = { id: string; src: string };

const RANGES: { id: Range; label: string; ms: number }[] = [
  { id: "24h", label: "Past 24 Hours", ms: 86400e3 },
  { id: "7d", label: "Past 7 Days", ms: 7 * 86400e3 },
  { id: "30d", label: "Past 30 Days", ms: 30 * 86400e3 },
];
const PRESETS: { id: string; label: string }[] = [
  { id: "wraith", label: "Wraith" }, { id: "avatar", label: "Your avatar" }, { id: "synthwave", label: "Synthwave" }, { id: "citynight", label: "Neon city" },
  { id: "inferno", label: "Inferno" }, { id: "aurora", label: "Aurora" }, { id: "moneyrain", label: "Money rain" }, { id: "coins", label: "Gold rush" },
  { id: "candles", label: "Candles" }, { id: "matrix", label: "Matrix" }, { id: "ember", label: "Ember" }, { id: "graphite", label: "Graphite" },
];
/** Quick searches for the Clips tab (movie scenes, anime and memes from GIPHY). */
const CLIP_CHIPS = ["Money", "Wolf of Wall Street", "Scarface", "Anime laugh", "Peaky Blinders", "Breaking Bad", "Lambo", "To the moon", "Rich", "Diamond hands", "Pump it", "Rug pull"];
type GifItem = { id: string; title: string; thumb: string; mp4: string };
/** The backgrounds that move (the card preview plays them; the picture you save or share is the frame on screen at that moment). */
const MOVING = new Set(["moneyrain", "coins", "candles", "matrix", "synthwave", "citynight", "inferno", "aurora"]);
type Clip = { id: string; url: string }; // a video the person added: kept for as long as the studio is open (a phone cannot keep videos in the page's storage)
const W = 1080, H = 1620;
const FONT = `"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
const PREFS_KEY = "wraith_share_studio_v1";
const PHOTOS_KEY = "wraith_share_photos_v1";
const MAX_PHOTOS = 6;
const FRESH: Frame = { z: 1, x: 0, y: 0 };

type Prefs = { range?: Range; bg?: string; showAvatar?: boolean; showStats?: boolean; showMascot?: boolean; darken?: number };
const readPrefs = (): Prefs => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Prefs; } catch { return {}; } };
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return `p${h.toString(36)}${s.length.toString(36)}`; };
const readPhotos = (): Photo[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PHOTOS_KEY) || "[]") as unknown;
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, MAX_PHOTOS).map((src) => ({ id: hash(src), src })) : [];
  } catch { return []; }
};
const savePhotos = (list: Photo[]) => {
  let l = list.slice(0, MAX_PHOTOS);
  while (l.length) { try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(l.map((p) => p.src))); return; } catch { l = l.slice(0, -1); } } // storage full: keep the newest that fit
  try { localStorage.removeItem(PHOTOS_KEY); } catch { /* blocked */ }
};

// The Android app hands the page two native functions (see MainActivity.java): one puts the picture in the phone's gallery, one opens the phone's share sheet.
// The app's web view cannot download files by itself, so before this the Share button only PRETENDED to save (and said it had).
type NativeShare = { saveImage?: (b64: string, name: string) => boolean; shareImage?: (b64: string, name: string, text: string) => boolean };
const nativeBridge = (): NativeShare | null => { try { const n = (window as unknown as { WraithShare?: NativeShare }).WraithShare; return n && typeof n.shareImage === "function" ? n : null; } catch { return null; } };
const inOldApp = () => /WraithApp/.test(navigator.userAgent) && !nativeBridge(); // the app, but a version from before native save and share
const blobToBase64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(new Error("read")); r.readAsDataURL(b); });
const downloadBlob = (blob: Blob, name: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  if (!src) return res(null);
  const i = new Image();
  if (!src.startsWith("data:")) i.crossOrigin = "anonymous";
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

// ───────────────────────── backgrounds ─────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const grad = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const l = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) l.addColorStop(o, c);
  return l;
};
const glow = (g: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) => {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
};
const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

/** One piece of background art. Everything is relative to the size, so the small tile and the full card look the same. `t` is in seconds, for the moving ones. */
function drawPreset(g: CanvasRenderingContext2D, w: number, h: number, id: string, im: Imgs, t = 0) {
  const u = w / W;
  const R = rng(id.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const ghostLogo = (x: number, y: number, size: number, a: number, rot = 0) => {
    if (!im.ghost) return;
    g.save(); g.globalAlpha = a; g.translate(x, y); g.rotate(rot);
    g.drawImage(im.ghost, -size / 2, -size / 2, size, size * (im.ghost.height / im.ghost.width));
    g.restore();
  };
  // fine film grain on top of the soft colour fields: it is what makes a gradient look printed instead of flat
  const grain = (n: number, a: number) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(255,255,255,${R() * a})`; const s = 1.6 * u + 0.6; g.fillRect(R() * w, R() * h, s, s); } };
  const blob = (x: number, y: number, r: number, rgb: string, a: number) => glow(g, x * w, y * h, r * w, rgb, a);
  if (drawScene(g, w, h, id, t, R)) return; // the code-made moving scenes (lib/shareScenes.ts)
  switch (id) {
    case "ember": { // warm colour fields
      g.fillStyle = "#0a0504"; g.fillRect(0, 0, w, h);
      blob(0.2, 0.1, 0.95, "255,120,50", 0.55); blob(0.95, 0.38, 0.85, "225,45,30", 0.42); blob(0.35, 0.92, 1.0, "255,170,60", 0.4); blob(1, 1, 0.8, "160,30,90", 0.38);
      grain(2600, 0.05);
      break;
    }
    case "violet": {
      g.fillStyle = "#07050f"; g.fillRect(0, 0, w, h);
      blob(0.15, 0.1, 1.0, "120,80,255", 0.5); blob(0.95, 0.32, 0.85, "255,70,180", 0.38); blob(0.4, 0.96, 1.0, "60,120,255", 0.42); blob(0, 0.72, 0.6, "170,60,255", 0.26);
      grain(2600, 0.05);
      break;
    }
    case "mint": {
      g.fillStyle = "#03100d"; g.fillRect(0, 0, w, h);
      blob(0.2, 0.14, 0.95, "40,230,170", 0.46); blob(0.95, 0.4, 0.9, "40,150,255", 0.36); blob(0.3, 1, 1.0, "60,255,150", 0.3); blob(0.9, 0.95, 0.7, "20,120,120", 0.36);
      grain(2600, 0.05);
      break;
    }
    case "moneyrain": { // animated: green bills falling at different depths
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#03140a"], [1, "#0a3a1f"]]); g.fillRect(0, 0, w, h);
      blob(0.5, 0.35, 0.95, "61,220,151", 0.16);
      for (let i = 0; i < 46; i++) {
        const depth = 0.35 + R() * 0.65, bw = (110 + R() * 70) * depth * u, bh = bw * 0.5;
        const x0 = R() * w, y0 = R() * (h + 400 * u), sp = (90 + R() * 160) * depth * u, ph = R() * 6.28, rot0 = (R() - 0.5) * 1.6;
        const y = ((y0 + t * sp) % (h + 300 * u)) - 150 * u;
        const x = x0 + Math.sin(t * 0.7 * depth + ph) * 40 * u;
        g.save(); g.translate(x, y); g.rotate(rot0 + Math.sin(t * 0.9 + ph) * 0.5); g.globalAlpha = 0.25 + depth * 0.6;
        g.fillStyle = grad(g, -bw / 2, 0, bw / 2, 0, [[0, "#2f9e63"], [1, "#6fe0a2"]]);
        g.beginPath(); g.roundRect(-bw / 2, -bh / 2, bw, bh, bh * 0.12); g.fill();
        g.strokeStyle = "rgba(5,40,20,.55)"; g.lineWidth = Math.max(1, 3 * u * depth);
        g.beginPath(); g.roundRect(-bw / 2 + bh * 0.1, -bh / 2 + bh * 0.1, bw - bh * 0.2, bh - bh * 0.2, bh * 0.08); g.stroke();
        g.fillStyle = "rgba(5,50,25,.6)"; g.beginPath(); g.arc(0, 0, bh * 0.26, 0, 6.28); g.fill();
        g.fillStyle = "rgba(200,255,225,.85)"; g.font = `800 ${Math.max(6, bh * 0.34)}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", 0, bh * 0.02);
        g.restore();
      }
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      break;
    }
    case "coins": { // animated: gold coins turning as they fall
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#0c0903"], [1, "#1c1405"]]); g.fillRect(0, 0, w, h);
      blob(0.5, 0.3, 1.0, "255,190,70", 0.22);
      for (let i = 0; i < 40; i++) {
        const depth = 0.4 + R() * 0.6, r = (46 + R() * 40) * depth * u, x0 = R() * w, y0 = R() * (h + 300 * u), sp = (110 + R() * 170) * depth * u, ph = R() * 6.28;
        const y = ((y0 + t * sp) % (h + 300 * u)) - 150 * u, x = x0 + Math.sin(t * 0.8 + ph) * 30 * u;
        const sx = Math.abs(Math.cos(t * (1.2 + depth) + ph)); // the coin turning: its width squeezes to a line and back
        g.save(); g.translate(x, y); g.globalAlpha = 0.35 + depth * 0.65; g.scale(Math.max(0.12, sx), 1);
        g.fillStyle = grad(g, -r, -r, r, r, [[0, "#fff0b0"], [0.5, "#ffc83d"], [1, "#c98410"]]); g.beginPath(); g.arc(0, 0, r, 0, 6.28); g.fill();
        g.strokeStyle = "rgba(122,67,0,.6)"; g.lineWidth = Math.max(1, r * 0.12); g.beginPath(); g.arc(0, 0, r * 0.72, 0, 6.28); g.stroke();
        g.fillStyle = "rgba(122,67,0,.85)"; g.font = `800 ${Math.max(6, r)}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("O", 0, r * 0.04);
        g.restore();
      }
      for (let i = 0; i < 26; i++) { // sparkles
        const x = R() * w, y = R() * h, s = (6 + R() * 10) * u, a = 0.5 + 0.5 * Math.sin(t * 3 + R() * 6.28);
        g.fillStyle = `rgba(255,236,170,${0.25 + a * 0.6})`; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.25, y - s * 0.25); g.lineTo(x + s, y); g.lineTo(x + s * 0.25, y + s * 0.25); g.lineTo(x, y + s); g.lineTo(x - s * 0.25, y + s * 0.25); g.lineTo(x - s, y); g.lineTo(x - s * 0.25, y - s * 0.25); g.closePath(); g.fill();
      }
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      break;
    }
    case "candles": { // animated: a chart scrolling by, neon candles
      g.fillStyle = "#040806"; g.fillRect(0, 0, w, h);
      blob(0.85, 0.2, 0.9, "55,213,138", 0.16); blob(0.1, 0.9, 0.8, "255,93,77", 0.1);
      g.strokeStyle = "rgba(255,255,255,.04)"; g.lineWidth = Math.max(1, 2 * u);
      for (let y = 120 * u; y < h; y += 170 * u) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      const L = 260, open: number[] = [], close: number[] = [], hi: number[] = [], lo: number[] = [];
      let p = 0.62;
      for (let i = 0; i < L; i++) { const o = p, c2 = Math.min(0.88, Math.max(0.14, o + (R() - 0.46) * 0.09)); p = c2; open.push(o); close.push(c2); hi.push(Math.min(o, c2) - R() * 0.03); lo.push(Math.max(o, c2) + R() * 0.03); }
      const cw = w / 14, pos = t * 1.1, i0 = Math.floor(pos), fr = pos - i0;
      for (let k = 0; k < 16; k++) {
        const i = (i0 + k) % L, x = (k - fr) * cw + cw / 2, up = close[i] < open[i], col = up ? "55,213,138" : "255,93,77";
        g.save(); g.shadowColor = `rgba(${col},.55)`; g.shadowBlur = 26 * u;
        g.strokeStyle = `rgba(${col},.8)`; g.lineWidth = Math.max(1, 4 * u); g.beginPath(); g.moveTo(x, hi[i] * h); g.lineTo(x, lo[i] * h); g.stroke();
        g.fillStyle = `rgba(${col},.85)`; g.fillRect(x - cw * 0.3, Math.min(open[i], close[i]) * h, cw * 0.6, Math.max(8 * u, Math.abs(open[i] - close[i]) * h));
        g.restore();
      }
      break;
    }
    case "matrix": { // animated: falling code
      g.fillStyle = "#010a04"; g.fillRect(0, 0, w, h);
      blob(0.5, 0.5, 0.9, "30,200,100", 0.07);
      const cols = 22, cwid = w / cols, fs = Math.max(8, 34 * u), glyphs = "01アイウエオカキクケコサシスセソ$W₿Ξ";
      g.font = `700 ${fs}px monospace`; g.textAlign = "center"; g.textBaseline = "top";
      for (let c = 0; c < cols; c++) {
        const sp = 5 + R() * 9, len = 10 + ((R() * 14) | 0), off = R() * 100, x = (c + 0.5) * cwid, head = (t * sp + off) % (h / fs + len);
        for (let k = 0; k < len; k++) {
          const row = head - k;
          if (row < 0 || row * fs > h) continue;
          const ch = glyphs[Math.abs(Math.floor(c * 7 + row * 3 + k * 5 + Math.floor(t * 4))) % glyphs.length];
          g.fillStyle = k === 0 ? "rgba(220,255,235,.95)" : `rgba(60,255,140,${Math.max(0.05, 0.8 * (1 - k / len))})`;
          g.fillText(ch, x, Math.floor(row) * fs);
        }
      }
      g.textAlign = "left"; g.textBaseline = "alphabetic";
      break;
    }
    case "glitch": {
      g.fillStyle = "#07070a"; g.fillRect(0, 0, w, h);
      blob(0.5, 0.4, 1.0, "255,60,90", 0.12); blob(0.2, 0.85, 0.8, "60,200,255", 0.12);
      if (im.ghost) { for (const dx of [-16, 0, 16]) { g.save(); g.globalCompositeOperation = "lighter"; ghostLogo(w * 0.5 + dx * u, h * 0.46, w * 0.85, dx === 0 ? 0.16 : 0.1, 0.08); g.restore(); } }
      for (let y = 0; y < h; y += 6 * u) { g.fillStyle = "rgba(255,255,255,.025)"; g.fillRect(0, y, w, 2 * u); }
      for (let i = 0; i < 14; i++) { const y = R() * h, hh = (6 + R() * 40) * u, dx = (R() - 0.5) * 120 * u; g.fillStyle = `rgba(${R() < 0.5 ? "255,60,90" : "60,200,255"},${0.05 + R() * 0.12})`; g.fillRect(dx, y, w, hh); }
      break;
    }
    case "ghosts": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#06120a"], [1, "#0c2214"]]); g.fillRect(0, 0, w, h);
      blob(0.5, 0.4, 0.9, "55,213,138", 0.1);
      for (let r = 0; r < 8; r++) for (let c = 0; c < 5; c++) {
        const x = (c + (r % 2 ? 0.5 : 0)) * 240 * u + 40 * u, y = r * 250 * u + 110 * u;
        if (im.ghost) ghostLogo(x, y, 130 * u, 0.1, -0.2); else { g.fillStyle = "rgba(255,255,255,.06)"; dot(g, x, y, 20 * u); }
      }
      break;
    }
    case "graphite": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#101012"], [1, "#1c1c22"]]); g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(255,255,255,.045)"; g.lineWidth = Math.max(1, 2 * u);
      for (let y = 90 * u; y < h; y += 130 * u) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let i = 0; i < 18; i++) {
        const x = (i + 0.5) * (w / 18), top = h * (0.45 + R() * 0.4), bh = h * (0.04 + R() * 0.16);
        g.fillStyle = R() < 0.6 ? "rgba(55,213,138,.07)" : "rgba(255,93,77,.06)";
        g.fillRect(x - 16 * u, top, 32 * u, bh); g.fillRect(x - 2 * u, top - 30 * u, 4 * u, bh + 60 * u);
      }
      break;
    }
    case "avatar": {
      if (!im.av) { drawPreset(g, w, h, "wraith", im); break; }
      g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
      const s = Math.max(w / im.av.width, h / im.av.height) * 1.5, dw = im.av.width * s, dh = im.av.height * s;
      g.save();
      try { g.filter = `blur(${44 * u}px)`; } catch { /* this browser draws it sharp */ }
      g.drawImage(im.av, (w - dw) / 2, (h - dh) / 2, dw, dh);
      g.restore();
      g.fillStyle = "rgba(0,0,0,.42)"; g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, 0, w, "255,123,61", 0.18);
      break;
    }
    default: { // wraith
      g.fillStyle = "#09090c"; g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, 0, w * 1.15, "255,123,61", 0.3);
      glow(g, w * 0.05, h * 0.96, w * 0.85, "255,90,40", 0.12);
      g.fillStyle = "rgba(255,255,255,.04)";
      for (let y = 26 * u, row = 0; y < h; y += 52 * u, row++) for (let x = (row % 2 ? 26 : 52) * u; x < w; x += 52 * u) dot(g, x, y, 2.2 * u);
      ghostLogo(w * 0.86, h * 0.52, w * 0.95, 0.06, 0.12);
    }
  }
}

function clampFrame(f: Frame, photo: { width: number; height: number } | null): Frame {
  const z = Math.min(4, Math.max(1, Number.isFinite(f.z) ? f.z : 1));
  if (!photo) return { z, x: 0, y: 0 };
  const s = Math.max(W / photo.width, H / photo.height) * z;
  const mx = Math.max(0, (photo.width * s - W) / 2), my = Math.max(0, (photo.height * s - H) / 2);
  return { z, x: Math.min(mx, Math.max(-mx, f.x)), y: Math.min(my, Math.max(-my, f.y)) };
}

/** The whole background: preset art or the framed photo, a soft dark band top and bottom so text stays readable, then the person's own darken amount. */
function paintBg(g: CanvasRenderingContext2D, w: number, h: number, bg: string, im: Imgs, photo: HTMLImageElement | null, frame: Frame, darken: number, t = 0, video: HTMLVideoElement | null = null) {
  if (bg.startsWith("video:")) {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    if (video && video.videoWidth > 0 && video.readyState >= 2) {
      const vw = video.videoWidth, vh = video.videoHeight, z = Math.min(4, Math.max(1, frame.z)), k = w / W;
      const s = Math.max(w / vw, h / vh) * z, dw = vw * s, dh = vh * s;
      const mx = Math.max(0, (dw - w) / 2), my = Math.max(0, (dh - h) / 2);
      try { g.drawImage(video, (w - dw) / 2 + Math.min(mx, Math.max(-mx, frame.x * k)), (h - dh) / 2 + Math.min(my, Math.max(-my, frame.y * k)), dw, dh); } catch { /* not ready yet */ }
    }
  } else if (bg.startsWith("photo:") && photo) {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const f = clampFrame(frame, photo), k = w / W;
    const s = Math.max(w / photo.width, h / photo.height) * f.z, dw = photo.width * s, dh = photo.height * s;
    g.drawImage(photo, (w - dw) / 2 + f.x * k, (h - dh) / 2 + f.y * k, dw, dh);
  } else drawPreset(g, w, h, bg.startsWith("photo:") ? "wraith" : bg, im, t);
  g.fillStyle = grad(g, 0, 0, 0, h, [[0, "rgba(0,0,0,.28)"], [0.22, "rgba(0,0,0,0)"], [0.55, "rgba(0,0,0,.12)"], [1, "rgba(0,0,0,.62)"]]);
  g.fillRect(0, 0, w, h);
  if (darken > 0) { g.fillStyle = `rgba(0,0,0,${darken})`; g.fillRect(0, 0, w, h); }
}

// ───────────────────────── the cards ─────────────────────────
type CardData = {
  name: string; username: string | null; bio: string; value: number | null; bigText?: string; bigCaption?: string; followers: number; following: number;
  total: number; realized: number; un: number; volume: number; pct: number | null; period: string;
  showAvatar: boolean; showStats: boolean; showMascot: boolean; ref: string; im: Imgs; fmt: (n: number) => string; sym: string;
  /** the background is a clip, a video or a photo (not a drawn preset): the card then keeps its middle free */
  media: boolean;
};
const tidy = (s: string) => s.replace(/([.,])00(?=\D*$)/, "");
/** Big figures read cleaner without cents ("$7,855" not "$7,854.46"); small ones keep them. */
const whole = (n: number, f: (n: number) => string) => tidy(f(Math.abs(n) >= 100 ? Math.round(n) : n));
const signed = (n: number, f: (n: number) => string) => `${n >= 0 ? "+" : "−"}${f(Math.abs(n))}`;
const fitFont = (g: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 800) => {
  let s = size; g.font = `${weight} ${s}px ${FONT}`;
  while (g.measureText(text).width > max && s > 22) { s -= 3; g.font = `${weight} ${s}px ${FONT}`; }
};
function wrapLines(g: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || g.measureText(t).width <= max) cur = t;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) return lines; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}


/**
 * The card on a clip or a photo: the picture is the point, so nothing sits over its middle. A small avatar and the handle go top-left, everything
 * else is a block at the bottom-left (headline, caption, three numbers, then the brand), and the mascot has the bottom-right to itself. The normal
 * layout puts the avatar big in the centre, which covered the subject of the clip.
 */
function drawMediaCard(g: CanvasRenderingContext2D, kind: "bio" | "profit", d: CardData) {
  const L = 64;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  const compact = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${d.sym}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${d.sym}${(a / 1e3).toFixed(2)}K`;
    return tidy(d.fmt(a));
  };
  // top-left: avatar and handle
  const ar = 62, ay = 150;
  let tx = L;
  if (d.showAvatar) {
    g.save(); g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 24; g.fillStyle = "#1b1410"; g.beginPath(); g.arc(L + ar, ay, ar, 0, Math.PI * 2); g.fill(); g.restore();
    g.save(); g.beginPath(); g.arc(L + ar, ay, ar, 0, Math.PI * 2); g.clip();
    if (d.im.av) {
      const s = Math.max((ar * 2) / d.im.av.width, (ar * 2) / d.im.av.height), dw = d.im.av.width * s, dh = d.im.av.height * s;
      g.drawImage(d.im.av, L + ar - dw / 2, ay - dh / 2, dw, dh);
    } else { g.fillStyle = "#241711"; g.fillRect(L, ay - ar, ar * 2, ar * 2); g.fillStyle = "#ff7b3d"; g.font = `800 70px ${FONT}`; g.textBaseline = "middle"; g.textAlign = "center"; g.fillText((d.name[0] ?? "W").toUpperCase(), L + ar, ay + 4); g.textAlign = "left"; g.textBaseline = "alphabetic"; }
    g.restore();
    g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 5; g.beginPath(); g.arc(L + ar, ay, ar + 2, 0, Math.PI * 2); g.stroke();
    tx = L + ar * 2 + 22;
  }
  const label = `@ ${(d.username || d.name).slice(0, 20)}`;
  g.font = `800 44px ${FONT}`;
  const pw = g.measureText(label).width + 56;
  g.fillStyle = "rgba(10,10,12,.62)"; g.beginPath(); g.roundRect(tx, ay - 38, pw, 76, 38); g.fill();
  g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(label, tx + 28, ay + 3); g.textBaseline = "alphabetic";

  // bottom-left block
  const colW = 640; // the mascot has everything to the right of this
  const cols = (items: [string, string, string?][], baseY: number) => {
    const gap = colW / items.length;
    items.forEach(([val, name, tint], i) => {
      const x = L + gap * i;
      g.save(); g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 14;
      g.fillStyle = tint ?? "#fff"; fitFont(g, val, gap - 22, 52); g.fillText(val, x, baseY);
      g.restore();
      g.fillStyle = "rgba(255,255,255,.68)"; g.font = `700 24px ${FONT}`;
      try { (g as unknown as { letterSpacing: string }).letterSpacing = "3px"; } catch { /* older browsers */ }
      g.fillText(name, x, baseY + 38);
      try { (g as unknown as { letterSpacing: string }).letterSpacing = "0px"; } catch { /* older browsers */ }
    });
  };
  const shade = (y0: number) => { const gr = g.createLinearGradient(0, y0, 0, H); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.72)"); g.fillStyle = gr; g.fillRect(0, y0, W, H - y0); };
  shade(900); // a soft dark fade at the bottom so the numbers read on any picture
  if (kind === "bio") {
    g.save(); g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 26; g.fillStyle = "#fff";
    const txt = d.bigText ?? (d.value !== null ? whole(d.value, d.fmt) : "—");
    fitFont(g, txt, colW, 190); g.fillText(txt, L, 1130);
    g.restore(); g.save();
    g.fillStyle = "rgba(255,255,255,.74)"; g.font = `600 40px ${FONT}`;
    let y = 1202;
    if (d.bigCaption) { g.fillStyle = "rgba(255,255,255,.66)"; g.font = `700 36px ${FONT}`; g.fillText(d.bigCaption, L, y, colW); y += 58; g.fillStyle = "rgba(255,255,255,.74)"; g.font = `600 40px ${FONT}`; }
    wrapLines(g, d.bio || "Trading on Wraith", colW, 2).forEach((l, i) => g.fillText(l, L, y + i * 54, colW));
    g.restore();
    if (d.showStats) cols([[d.following.toLocaleString("en-US"), "FOLLOWING"], [d.followers.toLocaleString("en-US"), "FOLLOWERS"]], 1370);
  } else {
    const mood = d.total > 0 ? "up" : d.total < 0 ? "down" : "flat";
    const rgb = mood === "up" ? "55,213,138" : mood === "down" ? "255,93,77" : "255,255,255";
    const badge = mood === "flat" ? "READY WHEN YOU ARE" : mood === "up" ? (d.pct !== null && d.pct >= 50 ? "UP BIG" : "IN THE GREEN") : (d.pct !== null && d.pct <= -25 ? "ROUGH DAY" : "DOWN A BIT");
    g.save(); g.font = `800 28px ${FONT}`;
    const bw = g.measureText(badge).width + 56;
    g.fillStyle = `rgba(${rgb},.18)`; g.beginPath(); g.roundRect(L, 950, bw, 58, 29); g.fill();
    g.fillStyle = `rgb(${rgb})`; g.textBaseline = "middle"; g.fillText(badge, L + 28, 980); g.restore();
    g.save(); g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 26;
    g.fillStyle = mood === "down" ? "#ff6a5a" : mood === "up" ? "#37d58a" : "#fff";
    const big = signed(d.total, (n) => whole(n, d.fmt));
    fitFont(g, big, colW, 200); g.fillText(big, L, 1190);
    g.restore(); g.save();
    g.fillStyle = "rgba(255,255,255,.7)"; g.font = `700 40px ${FONT}`; g.fillText(`Profit · ${d.period}`, L, 1256);
    g.restore();
    if (d.showStats) cols([
      [signed(d.realized, compact), "REALIZED", d.realized >= 0 ? "#37d58a" : "#ff6a5a"],
      [signed(d.un, compact), "UNREALIZED", d.un >= 0 ? "#37d58a" : "#ff6a5a"],
      [compact(d.volume), "VOLUME"],
    ], 1370);
  }
  // the mascot, bottom-right
  if (d.showMascot) {
    const tone = d.total > 0 ? "up" : d.total < 0 ? "down" : "flat";
    const m = kind === "bio" ? d.im.mascot.king : tone === "up" ? d.im.mascot.wave : tone === "down" ? d.im.mascot.oops : d.im.mascot.sleep;
    if (m) { const mh = 400, mw = mh * (m.width / m.height); g.drawImage(m, W - mw - 10, H - mh - 6, mw, mh); }
  }
  // footer, left: ghost + WRAITH, then the invite code or the address
  const fy = 1528;
  g.save(); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 14; g.textAlign = "left";
  g.font = `400 62px Impact, 'Arial Narrow', sans-serif`;
  let x0 = L;
  if (d.im.ghost) { const lh = 66, lw = lh * (d.im.ghost.width / d.im.ghost.height); g.drawImage(d.im.ghost, L, fy - 56, lw, lh); x0 = L + lw + 16; }
  g.fillStyle = "#fff"; g.fillText("WRAITH", x0, fy);
  g.restore();
  g.fillStyle = "rgba(255,255,255,.7)"; g.font = `700 30px ${FONT}`; g.textAlign = "left";
  g.fillText(d.ref ? `Join with my code ${d.ref}` : "wraith.farm", L, fy + 54);
}

function drawCard(c: HTMLCanvasElement, kind: "bio" | "profit", d: CardData, bg: HTMLCanvasElement) {
  const g = c.getContext("2d");
  if (!g) return;
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  g.clearRect(0, 0, W, H);
  g.drawImage(bg, 0, 0);
  if (d.media) { drawMediaCard(g, kind, d); return; }
  const cx = W / 2;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  const compact = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${d.sym}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${d.sym}${(a / 1e3).toFixed(2)}K`;
    return tidy(d.fmt(a));
  };

  // avatar with a ring, and the handle pill straddling its lower edge
  const ar = 170, ay = 360;
  if (d.showAvatar) {
    g.save(); g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 40; g.fillStyle = "#1b1410"; g.beginPath(); g.arc(cx, ay, ar, 0, Math.PI * 2); g.fill(); g.restore();
    g.save(); g.beginPath(); g.arc(cx, ay, ar, 0, Math.PI * 2); g.clip();
    if (d.im.av) {
      const s = Math.max((ar * 2) / d.im.av.width, (ar * 2) / d.im.av.height), dw = d.im.av.width * s, dh = d.im.av.height * s;
      g.drawImage(d.im.av, cx - dw / 2, ay - dh / 2, dw, dh);
    } else {
      g.fillStyle = "#241711"; g.fillRect(cx - ar, ay - ar, ar * 2, ar * 2);
      g.fillStyle = "#ff7b3d"; g.font = `800 150px ${FONT}`; g.textBaseline = "middle"; g.fillText((d.name[0] ?? "W").toUpperCase(), cx, ay + 8); g.textBaseline = "alphabetic";
    }
    g.restore();
    g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 7; g.beginPath(); g.arc(cx, ay, ar + 3, 0, Math.PI * 2); g.stroke();
  }
  const py = ay + ar + 6 + (d.showAvatar ? 0 : -210);
  const label = `@ ${(d.username || d.name).slice(0, 22)}`;
  g.font = `800 54px ${FONT}`;
  const pw = g.measureText(label).width + 96, ph = 92;
  g.fillStyle = "rgba(10,10,12,.64)"; g.beginPath(); g.roundRect(cx - pw / 2, py - ph / 2, pw, ph, ph / 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,.2)"; g.lineWidth = 3; g.stroke();
  g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(label, cx, py + 3); g.textBaseline = "alphabetic";

  const cols = (items: [string, string, string?][], baseY: number) => {
    const gap = (W - 160) / items.length;
    items.forEach(([val, name, tint], i) => {
      const x = 80 + gap * (i + 0.5);
      g.save(); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 14;
      g.fillStyle = tint ?? "#fff"; fitFont(g, val, gap - 28, 58); g.fillText(val, x, baseY);
      g.restore();
      g.fillStyle = "rgba(255,255,255,.58)"; g.font = `700 27px ${FONT}`;
      try { (g as unknown as { letterSpacing: string }).letterSpacing = "4px"; } catch { /* older browsers */ }
      g.fillText(name, x, baseY + 48);
      try { (g as unknown as { letterSpacing: string }).letterSpacing = "0px"; } catch { /* older browsers */ }
      if (i > 0) { g.fillStyle = "rgba(255,255,255,.2)"; g.fillRect(80 + gap * i - 1, baseY - 44, 2, 100); }
    });
  };

  g.save(); g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 26;
  if (kind === "bio") {
    g.fillStyle = "#fff";
    const txt = d.bigText ?? (d.value !== null ? whole(d.value, d.fmt) : "—");
    fitFont(g, txt, W - 140, 250); g.fillText(txt, cx, py + 330);
    g.restore(); g.save();
    let bioY = py + 440;
    if (d.bigCaption) { // someone else's card: the headline is a stat (win rate), so say what it is
      g.fillStyle = "rgba(255,255,255,.6)"; g.font = `700 44px ${FONT}`; g.fillText(d.bigCaption, cx, py + 410, W - 160);
      bioY = py + 520;
    }
    g.fillStyle = "rgba(255,255,255,.68)"; g.font = `600 50px ${FONT}`;
    const lines = wrapLines(g, d.bio || "Trading on Wraith", W - 200, 2);
    lines.forEach((l, i) => g.fillText(l, cx, bioY + i * 68, W - 160));
    g.restore();
    if (d.showStats) cols([[d.following.toLocaleString("en-US"), "FOLLOWING"], [d.followers.toLocaleString("en-US"), "FOLLOWERS"]], py + 660);
  } else {
    const mood = d.total > 0 ? "up" : d.total < 0 ? "down" : "flat";
    const rgb = mood === "up" ? "55,213,138" : mood === "down" ? "255,93,77" : "255,255,255";
    const badge = mood === "flat" ? "READY WHEN YOU ARE" : mood === "up" ? (d.pct !== null && d.pct >= 50 ? "UP BIG" : "IN THE GREEN") : (d.pct !== null && d.pct <= -25 ? "ROUGH DAY" : "DOWN A BIT");
    g.restore(); g.save();
    g.font = `800 34px ${FONT}`;
    const bw = g.measureText(badge).width + 118, by = py + 170;
    g.fillStyle = `rgba(${rgb},.16)`; g.beginPath(); g.roundRect(cx - bw / 2, by - 36, bw, 72, 36); g.fill();
    g.strokeStyle = `rgba(${rgb},.7)`; g.lineWidth = 3; g.stroke();
    g.fillStyle = `rgb(${rgb})`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(badge, cx - bw / 2 + 82, by + 3);
    const ix = cx - bw / 2 + 46, s = 15;
    g.beginPath();
    if (mood === "up") { g.moveTo(ix, by - s); g.bezierCurveTo(ix + s * 1.1, by - s * 0.2, ix + s * 0.9, by + s, ix, by + s); g.bezierCurveTo(ix - s * 0.9, by + s, ix - s * 1.1, by, ix - s * 0.2, by - s * 0.6); g.bezierCurveTo(ix - s * 0.1, by - s * 0.3, ix + s * 0.1, by - s * 0.3, ix, by - s); }
    else if (mood === "down") { g.moveTo(ix - s, by - s * 0.6); g.lineTo(ix + s, by - s * 0.6); g.lineTo(ix, by + s * 0.8); }
    else g.arc(ix, by, s * 0.7, 0, Math.PI * 2);
    g.fill();
    g.textAlign = "center"; g.textBaseline = "alphabetic"; g.restore();
    g.save(); g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 26;
    g.fillStyle = mood === "down" ? "#ff6a5a" : mood === "up" ? "#37d58a" : "#fff";
    const big = signed(d.total, (n) => whole(n, d.fmt));
    fitFont(g, big, W - 140, 236); g.fillText(big, cx, py + 420);
    g.restore(); g.save();
    g.fillStyle = "rgba(255,255,255,.64)"; g.font = `700 46px ${FONT}`; g.fillText(`Profit · ${d.period}`, cx, py + 510);
    g.restore();
    if (d.showStats) cols([
      [signed(d.realized, compact), "REALIZED", d.realized >= 0 ? "#37d58a" : "#ff6a5a"],
      [signed(d.un, compact), "UNREALIZED", d.un >= 0 ? "#37d58a" : "#ff6a5a"],
      [compact(d.volume), "VOLUME"],
    ], py + 660);
  }

  // the Wraith mascot in the lower right: crowned on the Bio card, then waving, shocked or asleep depending on how the period went
  if (d.showMascot) {
    const tone = d.total > 0 ? "up" : d.total < 0 ? "down" : "flat";
    const m = kind === "bio" ? d.im.mascot.king : tone === "up" ? d.im.mascot.wave : tone === "down" ? d.im.mascot.oops : d.im.mascot.sleep;
    if (m) { const mh = 430, mw = mh * (m.width / m.height); g.drawImage(m, W - mw - 14, H - mh - 6, mw, mh); }
  }

  // footer: ghost + WRAITH, then the invite code or the address
  // (with the mascot in the lower right the footer is left-aligned, so the two never run into each other)
  const fy = H - 120;
  const left = d.showMascot;
  g.save(); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 14;
  g.font = `400 70px Impact, 'Arial Narrow', sans-serif`;
  const tw = g.measureText("WRAITH").width;
  if (d.im.ghost) {
    const lh = 74, lw = lh * (d.im.ghost.width / d.im.ghost.height), x0 = left ? 64 : cx - (lw + 18 + tw) / 2;
    g.drawImage(d.im.ghost, x0, fy - 62, lw, lh);
    g.textAlign = "left"; g.fillStyle = "#fff"; g.fillText("WRAITH", x0 + lw + 18, fy); g.textAlign = "center";
  } else { g.fillStyle = "#fff"; g.textAlign = left ? "left" : "center"; g.fillText("WRAITH", left ? 64 : cx, fy); g.textAlign = "center"; }
  g.restore();
  g.fillStyle = "rgba(255,255,255,.64)"; g.font = `700 34px ${FONT}`;
  g.textAlign = left ? "left" : "center";
  g.fillText(d.ref ? `Join with my code ${d.ref}` : "wraith.farm", left ? 64 : cx, fy + 62);
  g.textAlign = "center";
}

function Thumb({ id, im }: { id: string; im: Imgs }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext("2d");
    if (!c || !g) return;
    c.width = 220; c.height = 330;
    paintBg(g, 220, 330, id, im, null, FRESH, 0, 1.4);
  }, [id, im]);
  return <canvas ref={ref} aria-hidden="true" />;
}

// ───────────────────────── the studio ─────────────────────────
export default function ShareStudio({
  name, username, avatar, bio, value, bioBig, shareText, trades, fmt, followers, following, unrealized, volumeItems, onClose,
}: {
  name: string;
  username: string | null;
  avatar: string;
  bio?: string;
  /** Someone else's card: their wallet is private, so the Bio card's headline is this stat (e.g. win rate) instead of a portfolio value. */
  bioBig?: { text: string; caption?: string };
  /** What goes with the picture when it is shared; your invite code is added. Default is the "my card" wording. */
  shareText?: string;
  value: number | null; // portfolio value now, display currency
  trades: ShareTrade[]; // realized profit or loss of each closed trade
  fmt: (n: number) => string; // money formatter (already in the display currency)
  followers?: number;
  following?: number;
  unrealized?: number | null; // profit or loss on positions still open right now
  volumeItems?: ShareTrade[]; // every trade's size with its time
  onClose: () => void;
}) {
  const [initial] = useState<Prefs>(() => (typeof window === "undefined" ? {} : readPrefs()));
  const [range, setRange] = useState<Range>(initial.range ?? "7d");
  const [bg, setBg] = useState<string>(initial.bg ?? "wraith");
  const [showAvatar, setShowAvatar] = useState(initial.showAvatar ?? true);
  const [showStats, setShowStats] = useState(initial.showStats ?? true);
  const [showMascot, setShowMascot] = useState(initial.showMascot ?? true);
  const [darken, setDarken] = useState(Math.min(0.8, Math.max(0, initial.darken ?? 0)));
  const [frame, setFrame] = useState<Frame>(FRESH);
  const [photos, setPhotos] = useState<Photo[]>(() => (typeof window === "undefined" ? [] : readPhotos()));
  const [idx, setIdx] = useState(0);
  const [menu, setMenu] = useState<null | "range" | "show">(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<"clips" | "yours" | "presets">("presets");
  const [gifQ, setGifQ] = useState("");
  const [gif, setGif] = useState<{ q: string; items: GifItem[]; busy: boolean; ok: boolean | null; next: number }>({ q: "", items: [], busy: false, ok: null, next: 0 });
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [im, setIm] = useState<Imgs>({ av: null, ghost: null, mascot: NO_MASCOTS });
  const [photoImg, setPhotoImg] = useState<HTMLImageElement | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoDims = useRef<{ width: number; height: number } | null>(null);
  // Android app only: some phones' own screenshot tool does not tell the app about screenshots; allowing photo access lets the app see them instead
  const [shotHint, setShotHint] = useState(false);
  useEffect(() => {
    try {
      const w = window as unknown as { WraithShot?: { status: () => string } };
      if (!w.WraithShot || localStorage.getItem("wraith_shot_ok") === "1") return; // not the app, or a screenshot already opened this by itself
      const s = JSON.parse(w.WraithShot.status()) as { media?: boolean };
      if (!s.media) setShotHint(true);
    } catch { /* not the app */ }
  }, []);

  const track = useRef<HTMLDivElement>(null);
  const bioRef = useRef<HTMLCanvasElement>(null);
  const profitRef = useRef<HTMLCanvasElement>(null);
  const adjRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const bgCanvas = useRef<HTMLCanvasElement | null>(null);
  const bgKey = useRef("");
  const snap = useRef<{ frame: Frame; darken: number } | null>(null);
  const photoRef = useRef<{ width: number; height: number } | null>(null);
  const noteTimer = useRef(0);

  const isPhoto = bg.startsWith("photo:");
  const isVideo = bg.startsWith("video:");
  const canFrame = isPhoto || isVideo; // photos and videos can be moved and zoomed; the drawn backgrounds cannot
  const moving = isVideo || MOVING.has(bg);
  photoRef.current = isVideo ? videoDims.current : photoImg;
  const flash = useCallback((m: string) => { setNote(m); window.clearTimeout(noteTimer.current); noteTimer.current = window.setTimeout(() => setNote(""), 2200); }, []);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  // lock the page behind, close on Escape
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { if (adjusting) setAdjusting(false); else if (sheet) setSheet(false); else if (menu) setMenu(null); else onClose(); } };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [onClose, adjusting, sheet, menu]);

  useEffect(() => {
    fetch("/api/quests").then((r) => r.json()).then((d: { me?: { refCode?: string } }) => setRef(d.me?.refCode ?? "")).catch(() => undefined);
  }, []);
  useEffect(() => {
    let on = true;
    void Promise.all([loadImg(avatar), loadImg("/logo.png"), loadImg("/mascot/wraith-king-solo.webp"), loadImg("/mascot/wraith-wave.webp"), loadImg("/mascot/wraith-oops.webp"), loadImg("/mascot/wraith-sleep.webp")])
      .then(([av, ghost, king, wave, oops, sleep]) => { if (on) setIm({ av, ghost, mascot: { king, wave, oops, sleep } }); });
    return () => { on = false; };
  }, [avatar]);
  // the chosen photo, decoded
  useEffect(() => {
    let on = true;
    const p = isPhoto ? photos.find((x) => `photo:${x.id}` === bg) : null;
    if (isPhoto && !p && photos.length >= 0) { setBg("wraith"); return; } // that photo is gone (storage was cleared)
    void (p ? loadImg(p.src) : Promise.resolve(null)).then((i) => { if (on) setPhotoImg(i); });
    return () => { on = false; };
  }, [bg, isPhoto, photos]);

  // a chosen video: a muted, looping <video> that the card draws a frame of; gone clips (the studio was closed) fall back to the default
  useEffect(() => {
    if (!isVideo) { videoRef.current = null; videoDims.current = null; return; }
    const clip = clips.find((c) => `video:${c.id}` === bg);
    if (!clip) { setBg("wraith"); return; }
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
    if (/^https?:/i.test(clip.url)) v.crossOrigin = "anonymous"; // a clip from the web: asked for with CORS so the picture drawn from it can still be saved
    v.src = clip.url;
    v.addEventListener("loadedmetadata", () => { videoDims.current = { width: v.videoWidth, height: v.videoHeight }; });
    void v.play().catch(() => undefined);
    videoRef.current = v;
    return () => { v.pause(); v.removeAttribute("src"); v.load(); if (videoRef.current === v) videoRef.current = null; videoDims.current = null; };
  }, [bg, isVideo, clips]);
  useEffect(() => () => { for (const c of clips) URL.revokeObjectURL(c.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ range, bg, showAvatar, showStats, showMascot, darken } satisfies Prefs)); } catch { /* storage blocked */ } }, 250);
    return () => window.clearTimeout(t);
  }, [range, bg, showAvatar, showStats, showMascot, darken]);

  const rangeInfo = RANGES.find((r) => r.id === range) ?? RANGES[1];
  const stats = useMemo(() => {
    const now = Date.now(), since = now - rangeInfo.ms;
    const realized = trades.filter((t) => t.ts >= since).reduce((a, t) => a + t.usd, 0);
    const volume = (volumeItems ?? []).filter((t) => t.ts >= since).reduce((a, t) => a + t.usd, 0);
    const un = unrealized ?? 0;
    // % of what the account was worth at the start of the period; with no wallet value (someone else's card) it is the return on what they traded
    const start = value !== null ? value - realized - un : volume;
    return { realized, un, volume, total: realized + un, pct: start && start > 0 ? ((realized + un) / start) * 100 : null };
  }, [trades, volumeItems, unrealized, value, rangeInfo]);
  const sym = useMemo(() => fmt(0).replace(/[0-9.,\s]/g, "") || "$", [fmt]);

  const data: CardData = useMemo(() => ({
    name, username, bio: bio ?? "", value, bigText: bioBig?.text, bigCaption: bioBig?.caption, followers: followers ?? 0, following: following ?? 0,
    total: stats.total, realized: stats.realized, un: stats.un, volume: stats.volume, pct: stats.pct, period: rangeInfo.label,
    showAvatar, showStats, showMascot, ref, im, fmt, sym, media: bg.startsWith("video:") || bg.startsWith("photo:"),
  }), [name, username, bio, value, bioBig, followers, following, stats, rangeInfo, showAvatar, showStats, showMascot, ref, im, fmt, sym, bg]);

  // build the background once per change, then draw the cards (and the adjust preview) on top of it
  useEffect(() => {
    const key = JSON.stringify([bg, frame, darken, !!im.av, !!im.ghost, photoImg?.src.length ?? 0]);
    const c = bgCanvas.current ?? (bgCanvas.current = document.createElement("canvas"));
    if (key !== bgKey.current) {
      c.width = W; c.height = H;
      const g = c.getContext("2d");
      if (!g) return;
      paintBg(g, W, H, bg, im, photoImg, frame, darken, 1.4, videoRef.current);
      bgKey.current = key;
      const t = thumbRef.current, tg = t?.getContext("2d");
      if (t && tg) { t.width = 88; t.height = 88; tg.drawImage(c, 0, H * 0.18, W, W, 0, 0, 88, 88); }
    }
    if (bioRef.current) drawCard(bioRef.current, "bio", data, c);
    if (profitRef.current) drawCard(profitRef.current, "profit", data, c);
    if (adjRef.current) drawCard(adjRef.current, idx === 0 ? "bio" : "profit", data, c);
  }, [bg, frame, darken, im, photoImg, data, idx, adjusting]);

  // moving backgrounds (drawn ones and videos): redraw the card on screen about 20 times a second; nothing else is redrawn
  useEffect(() => {
    if (!moving) return;
    let raf = 0, last = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 48 || document.hidden) return;
      last = now;
      const c = bgCanvas.current, g = c?.getContext("2d");
      if (!c || !g) return;
      paintBg(g, W, H, bg, im, photoImg, frame, darken, (now - t0) / 1000 + 1.4, videoRef.current);
      const target = adjusting ? adjRef.current : idx === 0 ? bioRef.current : profitRef.current;
      if (target) drawCard(target, idx === 0 ? "bio" : "profit", data, c);
      const th = thumbRef.current, tg = th?.getContext("2d");
      if (th && tg) tg.drawImage(c, 0, H * 0.18, W, W, 0, 0, 88, 88);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [moving, bg, im, photoImg, frame, darken, data, idx, adjusting]);

  const onScroll = () => {
    const t = track.current, first = t?.firstElementChild as HTMLElement | null;
    if (!t || !first) return;
    const i = Math.round(t.scrollLeft / (first.offsetWidth + 14));
    setIdx((p) => (p === i ? p : Math.min(1, Math.max(0, i))));
  };
  const goTo = (i: number) => {
    const t = track.current, first = t?.firstElementChild as HTMLElement | null;
    if (t && first) t.scrollTo({ left: i * (first.offsetWidth + 14), behavior: "smooth" });
    setIdx(i);
  };

  const selectBg = (id: string) => {
    setBg(id); setFrame(FRESH);
    if ((id.startsWith("photo:") || id.startsWith("video:")) && darken === 0) setDarken(0.2); // photos and clips are busy: a little darker keeps the numbers readable
  };
  // movie / anime clips from GIPHY, through our own route (the key stays on the server)
  const findClips = useCallback(async (q: string, more = false) => {
    setGif((g0) => ({ ...g0, busy: true, q: more ? g0.q : q }));
    try {
      const offset = more ? gif.next : 0;
      const r = await fetch(`/api/clips?q=${encodeURIComponent(q)}&offset=${offset}`);
      const d = (await r.json()) as { configured?: boolean; items?: GifItem[]; next?: number };
      if (!r.ok || d.configured === false) { setGif((g0) => ({ ...g0, busy: false, ok: false })); return; }
      setGif((g0) => ({ q: more ? g0.q : q, items: more ? [...g0.items, ...(d.items ?? []).filter((n) => !g0.items.some((o) => o.id === n.id))] : d.items ?? [], busy: false, ok: true, next: d.next ?? offset + 48 }));
    } catch { setGif((g0) => ({ ...g0, busy: false, ok: g0.ok ?? false })); }
  }, [gif.next]);
  const useClip = (it: GifItem) => {
    const id = `gif${it.id}`;
    setClips((cur) => { const next = [{ id, url: it.mp4 }, ...cur.filter((c) => c.id !== id)]; for (const gone of next.slice(6)) URL.revokeObjectURL(gone.url); return next.slice(0, 6); });
    selectBg(`video:${id}`); setSheet(false);
  };
  useEffect(() => { if (sheet && tab === "clips" && gif.ok === null && !gif.busy) void findClips(""); }, [sheet, tab, gif.ok, gif.busy, findClips]);
  const onFile = async (f?: File | null) => {
    if (!f) return;
    if (f.type.startsWith("video/")) { // a video: played from the phone's own file, not copied anywhere
      const id = hash(`${f.name}|${f.size}|${f.lastModified}`);
      const url = URL.createObjectURL(f);
      setClips((cur) => { const old = cur.find((c) => c.id === id); if (old) URL.revokeObjectURL(old.url); const next = [{ id, url }, ...cur.filter((c) => c.id !== id)]; for (const gone of next.slice(4)) URL.revokeObjectURL(gone.url); return next.slice(0, 4); });
      setTab("yours"); selectBg(`video:${id}`);
      return;
    }
    try {
      const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("read")); r.readAsDataURL(f); });
      const img = await loadImg(url);
      if (!img) { flash("Could not open that picture"); return; }
      const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
      cv.getContext("2d")?.drawImage(img, 0, 0, cv.width, cv.height);
      const src = cv.toDataURL("image/jpeg", 0.86);
      const p: Photo = { id: hash(src), src };
      const next = [p, ...photos.filter((x) => x.id !== p.id)].slice(0, MAX_PHOTOS);
      setPhotos(next); savePhotos(next); setTab("yours"); selectBg(`photo:${p.id}`);
    } catch { flash("Could not add that picture"); }
  };

  // adjust: drag to move, pinch (or wheel) to zoom, darken slider
  const startAdjust = () => { snap.current = { frame, darken }; setMenu(null); setSheet(false); setAdjusting(true); };
  const cancelAdjust = () => { if (snap.current) { setFrame(snap.current.frame); setDarken(snap.current.darken); } setAdjusting(false); };
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const toasted = useRef(false);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: frame.z }; }
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pts.current.get(e.pointerId);
    if (!p) return;
    if (!canFrame) { if (!toasted.current) { toasted.current = true; flash("Framing is available for photos and videos"); } p.x = e.clientX; p.y = e.clientY; return; }
    const k = W / e.currentTarget.getBoundingClientRect().width;
    const dx = (e.clientX - p.x) * k, dy = (e.clientY - p.y) * k;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.current.size === 1) setFrame((f) => clampFrame({ ...f, x: f.x + dx, y: f.y + dy }, photoRef.current));
    else if (pts.current.size === 2 && pinch.current) {
      const [a, b] = [...pts.current.values()], d = Math.hypot(a.x - b.x, a.y - b.y), z0 = pinch.current.z0, d0 = pinch.current.d0;
      setFrame((f) => clampFrame({ ...f, z: z0 * (d / d0) }, photoRef.current));
    }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => { if (canFrame) setFrame((f) => clampFrame({ ...f, z: f.z * (e.deltaY < 0 ? 1.08 : 0.92) }, photoRef.current)); };

  const cardBlob = async () => {
    const c = (idx === 0 ? bioRef : profitRef).current;
    if (!c) return null;
    return new Promise<Blob | null>((res) => { try { c.toBlob((bl) => res(bl), "image/png"); } catch { res(null); } });
  };
  const fileName = () => `wraith-${idx === 0 ? "bio" : "profit"}-${Date.now().toString(36)}.png`;
  const caption = () => (shareText ? (ref ? `${shareText} Join with my code ${ref}.` : shareText) : (ref ? `Trade with me on Wraith. Code ${ref}` : "My Wraith card"));
  // Share: the phone's own share sheet (the app: native; a browser on a phone: the web share sheet; a computer: the file downloads)
  const share = async () => {
    const blob = await cardBlob();
    if (!blob) { flash("Could not make the image"); return; }
    const name = fileName(), text = caption(), nat = nativeBridge();
    if (nat) { try { if (!nat.shareImage?.(await blobToBase64(blob), name, text)) flash("Could not open the share sheet"); } catch { flash("Could not share the picture"); } return; }
    const file = new File([blob], name, { type: "image/png" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; } } catch { return; /* the share sheet was closed */ }
    if (inOldApp()) { flash("Update the Wraith app to share pictures"); return; }
    downloadBlob(blob, name); flash("Downloaded to your device");
  };
  // Save: into the gallery (the app) or the downloads (a browser). It only says "Saved" when it really was.
  const save = async () => {
    const blob = await cardBlob();
    if (!blob) { flash("Could not make the image"); return; }
    const name = fileName(), nat = nativeBridge();
    if (nat?.saveImage) { try { flash(nat.saveImage(await blobToBase64(blob), name) ? "Saved to your gallery" : "Could not save. Allow photo access for Wraith."); } catch { flash("Could not save the picture"); } return; }
    if (inOldApp()) { flash("Update the Wraith app to save pictures"); return; }
    downloadBlob(blob, name); flash("Downloaded to your device");
  };

  return (
    <div className="shs" role="dialog" aria-modal="true" aria-label="Share card" data-no-elastic>
      <div className="shs-top">
        <button type="button" className="shs-circle" onClick={onClose} aria-label="Close"><X size={24} /></button>
        {idx === 1 ? (
          <div className="shs-pop-wrap">
            <button type="button" className="shs-period" onClick={() => setMenu(menu === "range" ? null : "range")} aria-haspopup="listbox" aria-expanded={menu === "range"}>
              {rangeInfo.label}<ChevronDown size={18} />
            </button>
            {menu === "range" && (
              <div className="shs-menu" role="listbox" aria-label="Period">
                {RANGES.map((r) => (
                  <button key={r.id} type="button" role="option" aria-selected={r.id === range} className={r.id === range ? "on" : ""} onClick={() => { setRange(r.id); setMenu(null); }}>
                    {r.label}{r.id === range && <Check size={18} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : <span />}
        <div className="shs-rail-wrap">
          <div className="shs-rail">
            <button type="button" className={menu === "show" ? "on" : ""} onClick={() => setMenu(menu === "show" ? null : "show")} aria-label="Show on card"><SlidersHorizontal size={22} /></button>
            <button type="button" onClick={startAdjust} aria-label="Adjust background"><Crop size={22} /></button>
          </div>
          {menu === "show" && (
            <div className="shs-menu" role="group" aria-label="Show on card">
              <h4>SHOW ON CARD</h4>
              <button type="button" onClick={() => setShowAvatar((v) => !v)} role="switch" aria-checked={showAvatar}>Avatar<span className={`shs-sw${showAvatar ? " on" : ""}`} /></button>
              <button type="button" onClick={() => setShowStats((v) => !v)} role="switch" aria-checked={showStats}>Stats<span className={`shs-sw${showStats ? " on" : ""}`} /></button>
              <button type="button" onClick={() => setShowMascot((v) => !v)} role="switch" aria-checked={showMascot}>Wraith<span className={`shs-sw${showMascot ? " on" : ""}`} /></button>
            </div>
          )}
        </div>
      </div>
      {menu && <div className="shs-scrim" onClick={() => setMenu(null)} />}

      <div className="shs-stage">
        <div className="shs-track" ref={track} onScroll={onScroll}>
          <div className="shs-card"><canvas ref={bioRef} aria-label="Bio card preview" /></div>
          <div className="shs-card"><canvas ref={profitRef} aria-label="Profit card preview" /></div>
        </div>
        <div className="shs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={idx === 0} className={idx === 0 ? "on" : ""} onClick={() => goTo(0)}>Bio</button>
          <button type="button" role="tab" aria-selected={idx === 1} className={idx === 1 ? "on" : ""} onClick={() => goTo(1)}>Profit</button>
        </div>
        {shotHint && (
          <button
            type="button"
            className="shs-shot"
            onClick={() => { try { (window as unknown as { WraithShot?: { enable: () => void } }).WraithShot?.enable(); } catch { /* not the app */ } setShotHint(false); }}
          >
            Want this to open by itself after a screenshot? Tap to allow photo access.
          </button>
        )}
      </div>

      <div className="shs-bar">
        <button type="button" className="shs-bgbtn" onClick={() => { setMenu(null); setSheet(true); }}><canvas ref={thumbRef} aria-hidden="true" />Background</button>
        <button type="button" className="shs-save" onClick={() => void save()} aria-label="Save to your gallery"><Download size={22} /></button>
        <button type="button" className="shs-share" onClick={() => void share()}>Share <ArrowRight size={20} /></button>
      </div>

      {sheet && (
        <>
          <div className="shs-scrim dim" onClick={() => setSheet(false)} />
          <div className="shs-sheet" role="dialog" aria-label="Background">
            <div className="shs-sheet-head">
              <button type="button" className="shs-circle sm" onClick={() => setSheet(false)} aria-label="Close"><X size={22} /></button>
              <b>Background</b>
              <button type="button" className="shs-link" onClick={startAdjust}><Crop size={18} /> Adjust</button>
            </div>
            <div className="shs-seg">
              <button type="button" className={tab === "clips" ? "on" : ""} onClick={() => setTab("clips")}>Clips</button>
              <button type="button" className={tab === "presets" ? "on" : ""} onClick={() => setTab("presets")}>Presets</button>
              <button type="button" className={tab === "yours" ? "on" : ""} onClick={() => setTab("yours")}>Yours</button>
            </div>
            {tab === "clips" && (
              <div className="shs-clipbar">
                <form onSubmit={(e) => { e.preventDefault(); void findClips(gifQ.trim()); }}>
                  <Search size={16} aria-hidden="true" />
                  <input value={gifQ} onChange={(e) => setGifQ(e.target.value)} placeholder="Movie scenes, anime, memes" enterKeyHint="search" autoComplete="off" spellCheck={false} aria-label="Search clips" />
                </form>
                <div className="shs-chips">
                  {CLIP_CHIPS.map((c) => <button key={c} type="button" className={gif.q.toLowerCase() === c.toLowerCase() ? "on" : ""} onClick={() => { setGifQ(c); void findClips(c); }}>{c}</button>)}
                </div>
              </div>
            )}
            <div className="shs-grid">
              {tab === "clips" ? (
                <>
                  {gif.ok === false && <p className="shs-clipnote">Clips are not switched on yet. They need a GIPHY key on the server.</p>}
                  {gif.ok === true && !gif.items.length && !gif.busy && <p className="shs-clipnote">Nothing found. Try another word.</p>}
                  {gif.items.map((it) => (
                    <button key={it.id} type="button" className={`shs-tile${bg === `video:gif${it.id}` ? " sel" : ""}`} onClick={() => useClip(it)} aria-label={it.title || "Use this clip"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.thumb} alt="" loading="lazy" />
                      {bg === `video:gif${it.id}` && <i><Check size={14} /></i>}
                    </button>
                  ))}
                  {gif.busy && <p className="shs-clipnote">Loading…</p>}
                  {gif.ok === true && gif.items.length >= 12 && !gif.busy && <button type="button" className="shs-more" onClick={() => void findClips(gif.q, true)}>More</button>}
                  {gif.ok === true && <p className="shs-clipnote shs-giphy">Powered by GIPHY</p>}
                </>
              ) : tab === "yours" ? (
                <>
                  <label className="shs-tile add"><ImagePlus size={26} /><span>Photo or video</span>
                    <input type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onFile(f); }} />
                  </label>
                  {clips.map((c) => (
                    <button key={c.id} type="button" className={`shs-tile${bg === `video:${c.id}` ? " sel" : ""}`} onClick={() => selectBg(`video:${c.id}`)} aria-label="Use this video">
                      <video src={c.url} muted playsInline preload="metadata" />
                      {bg === `video:${c.id}` && <i><Check size={14} /></i>}
                    </button>
                  ))}
                  {photos.map((p) => (
                    <button key={p.id} type="button" className={`shs-tile${bg === `photo:${p.id}` ? " sel" : ""}`} onClick={() => selectBg(`photo:${p.id}`)} aria-label="Use this photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.src} alt="" />
                      {bg === `photo:${p.id}` && <i><Check size={14} /></i>}
                    </button>
                  ))}
                </>
              ) : PRESETS.map((p) => (
                <button key={p.id} type="button" className={`shs-tile${bg === p.id ? " sel" : ""}`} onClick={() => selectBg(p.id)} aria-label={p.label}>
                  <Thumb id={p.id} im={im} />
                  {bg === p.id && <i><Check size={14} /></i>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {adjusting && (
        <div className="shs-adj">
          <div className="shs-adj-top">
            <button type="button" className="shs-pill" onClick={cancelAdjust}>Cancel</button>
            <button type="button" className="shs-link" onClick={() => { setFrame(FRESH); setDarken(0); }}>Reset</button>
            <button type="button" className="shs-pill go" onClick={() => setAdjusting(false)}>Done</button>
          </div>
          <div className="shs-adj-stage">
            <div className="shs-card adj" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
              <canvas ref={adjRef} aria-label="Card being adjusted" />
              <div className="shs-thirds" aria-hidden="true" />
            </div>
            <p className="shs-hint">{canFrame ? "Drag to move, pinch to zoom" : "Framing is available for photos and videos"}</p>
          </div>
          <div className="shs-adj-panel">
            <span>Darken</span>
            <input className="shs-range" type="range" min={0} max={80} step={1} value={Math.round(darken * 100)} onChange={(e) => setDarken(Number(e.target.value) / 100)} aria-label="Darken the background" />
            <b>{Math.round(darken * 100)}%</b>
          </div>
        </div>
      )}
      {note && <div className="shs-toast" role="status">{note}</div>}
    </div>
  );
}
