"use client";
// Share studio, like Fomo's: swipe between a Bio card and a Profit card, pick the period, hide the avatar or the stats, choose a background
// (art drawn in code, your avatar, or your own photo with framing and a darken slider) and share the picture.
// It opens from the Share button on the profile, and by itself right after a screenshot: the Android app tells the page with a
// "wraith-screenshot" event (see MainActivity.java and app/app/profile/page.tsx).
// Every card is drawn on a canvas, so what you see is exactly the picture that gets shared. Numbers come from the profile page; nothing is made up.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Crop, ImagePlus, SlidersHorizontal, X } from "lucide-react";

export type ShareTrade = { ts: number; usd: number }; // realized profit (+) or loss (-) of one closed trade, or the size of one trade, in display currency
type Range = "24h" | "7d" | "30d";
type Frame = { z: number; x: number; y: number }; // photo framing: zoom (1 = just covers the card) and offset in card pixels
type Imgs = { av: HTMLImageElement | null; ghost: HTMLImageElement | null };
type Photo = { id: string; src: string };

const RANGES: { id: Range; label: string; ms: number }[] = [
  { id: "24h", label: "Past 24 Hours", ms: 86400e3 },
  { id: "7d", label: "Past 7 Days", ms: 7 * 86400e3 },
  { id: "30d", label: "Past 30 Days", ms: 30 * 86400e3 },
];
const PRESETS: { id: string; label: string }[] = [
  { id: "wraith", label: "Wraith" }, { id: "avatar", label: "Your avatar" }, { id: "ember", label: "Ember" }, { id: "midnight", label: "Midnight" },
  { id: "aurora", label: "Aurora" }, { id: "gold", label: "Gold" }, { id: "ocean", label: "Ocean" }, { id: "neon", label: "Neon" },
  { id: "sunset", label: "Sunset" }, { id: "candles", label: "Candles" }, { id: "ghosts", label: "Ghosts" }, { id: "graphite", label: "Graphite" },
];
const W = 1080, H = 1620;
const FONT = `"Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
const PREFS_KEY = "wraith_share_studio_v1";
const PHOTOS_KEY = "wraith_share_photos_v1";
const MAX_PHOTOS = 6;
const FRESH: Frame = { z: 1, x: 0, y: 0 };

type Prefs = { range?: Range; bg?: string; showAvatar?: boolean; showStats?: boolean; darken?: number };
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

/** One piece of background art. Everything is relative to the size, so the small tile and the full card look the same. */
function drawPreset(g: CanvasRenderingContext2D, w: number, h: number, id: string, im: Imgs) {
  const u = w / W;
  const R = rng(id.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const ghostLogo = (x: number, y: number, size: number, a: number, rot = 0) => {
    if (!im.ghost) return;
    g.save(); g.globalAlpha = a; g.translate(x, y); g.rotate(rot);
    g.drawImage(im.ghost, -size / 2, -size / 2, size, size * (im.ghost.height / im.ghost.width));
    g.restore();
  };
  switch (id) {
    case "ember": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#120303"], [0.55, "#3a0f06"], [0.86, "#90300d"], [1, "#ff7b3d"]]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 1.02, w * 0.95, "255,150,70", 0.5);
      for (let i = 0; i < 110; i++) { g.fillStyle = `rgba(255,${140 + ((R() * 90) | 0)},70,${0.12 + R() * 0.5})`; dot(g, R() * w, h * (0.25 + R() * 0.75), (1 + R() * 3.4) * u); }
      break;
    }
    case "midnight": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#050921"], [0.55, "#171250"], [1, "#31176a"]]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.82, h * 0.13, w * 0.55, "150,165,255", 0.2);
      for (let i = 0; i < 280; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.75})`; dot(g, R() * w, R() * h * 0.92, (0.7 + R() * 2.2) * u); }
      g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = Math.max(1, 2 * u);
      for (let i = 0; i < 9; i++) { const x = R() * w, y = R() * h * 0.7, s = (10 + R() * 14) * u; g.beginPath(); g.moveTo(x - s, y); g.lineTo(x + s, y); g.moveTo(x, y - s); g.lineTo(x, y + s); g.stroke(); }
      g.fillStyle = "rgba(236,239,255,.9)"; dot(g, w * 0.82, h * 0.13, 40 * u);
      break;
    }
    case "aurora": {
      g.fillStyle = "#03100e"; g.fillRect(0, 0, w, h);
      glow(g, w * 0.25, h * 0.2, w * 0.75, "40,230,160", 0.38);
      glow(g, w * 0.88, h * 0.42, w * 0.65, "80,160,255", 0.3);
      glow(g, w * 0.15, h * 0.78, w * 0.8, "150,90,255", 0.3);
      glow(g, w * 0.75, h * 0.97, w * 0.65, "40,230,160", 0.2);
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${0.1 + R() * 0.5})`; dot(g, R() * w, R() * h, (0.6 + R() * 1.6) * u); }
      break;
    }
    case "gold": {
      g.fillStyle = "#0b0803"; g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.38, w * 0.95, "255,190,70", 0.3);
      for (let i = 0; i < 16; i++) { g.fillStyle = `rgba(255,200,90,${0.03 + R() * 0.05})`; dot(g, R() * w, R() * h, (30 + R() * 70) * u); }
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,${190 + ((R() * 50) | 0)},90,${0.2 + R() * 0.7})`; dot(g, R() * w, R() * h, (0.8 + R() * 3) * u); }
      break;
    }
    case "ocean": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#02101c"], [0.5, "#04324a"], [1, "#0b6e82"]]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.05, w * 0.8, "120,220,255", 0.14);
      g.lineWidth = Math.max(1, 3 * u);
      for (let k = 0; k < 11; k++) {
        g.beginPath();
        for (let x = 0; x <= w; x += Math.max(2, 12 * u)) { const y = h * (0.3 + k * 0.065) + Math.sin((x / w) * Math.PI * (2.2 + k * 0.15) + k) * 22 * u; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.strokeStyle = `rgba(190,240,255,${0.05 + k * 0.012})`; g.stroke();
      }
      break;
    }
    case "neon": {
      g.fillStyle = "#06030d"; g.fillRect(0, 0, w, h);
      glow(g, w * 0.15, h * 0.12, w * 0.85, "255,40,180", 0.34);
      glow(g, w * 0.92, h * 0.88, w * 0.95, "40,220,255", 0.3);
      const hz = h * 0.66; g.strokeStyle = "rgba(255,70,200,.3)"; g.lineWidth = Math.max(1, 2 * u);
      for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(w / 2 + i * 14 * u, hz); g.lineTo(w / 2 + i * 120 * u, h); g.stroke(); }
      for (let k = 1; k < 12; k++) { const y = hz + (h - hz) * Math.pow(k / 12, 1.9); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      break;
    }
    case "sunset": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#140a33"], [0.45, "#5b1e6e"], [0.72, "#d3446a"], [0.9, "#ff8a3d"], [1, "#ffd27a"]]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.9, w * 0.75, "255,214,130", 0.5);
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.08 + R() * 0.4})`; dot(g, R() * w, R() * h * 0.45, (0.6 + R() * 1.6) * u); }
      break;
    }
    case "candles": {
      g.fillStyle = "#050806"; g.fillRect(0, 0, w, h);
      glow(g, w * 0.85, h * 0.2, w * 0.8, "55,213,138", 0.2);
      const n = 22, cw = w / n;
      let price = 0.86;
      for (let i = 0; i < n; i++) {
        const open = price, up = R() < 0.72;
        const close = Math.min(0.9, Math.max(0.12, open + (0.01 + R() * 0.05) * (up ? -1 : 1) - 0.012)); // y grows downward: a falling y is a rising price
        price = close;
        const hi = Math.min(open, close) - R() * 0.03, lo = Math.max(open, close) + R() * 0.03, x = i * cw + cw / 2;
        g.strokeStyle = up ? "rgba(55,213,138,.45)" : "rgba(255,93,77,.4)"; g.lineWidth = Math.max(1, 3 * u);
        g.beginPath(); g.moveTo(x, hi * h); g.lineTo(x, lo * h); g.stroke();
        g.fillStyle = up ? "rgba(55,213,138,.5)" : "rgba(255,93,77,.45)";
        g.fillRect(x - cw * 0.3, Math.min(open, close) * h, cw * 0.6, Math.max(8 * u, Math.abs(open - close) * h));
      }
      break;
    }
    case "ghosts": {
      g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#06120a"], [1, "#0c2214"]]); g.fillRect(0, 0, w, h);
      glow(g, w * 0.5, h * 0.4, w * 0.9, "55,213,138", 0.1);
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

function clampFrame(f: Frame, photo: HTMLImageElement | null): Frame {
  const z = Math.min(4, Math.max(1, Number.isFinite(f.z) ? f.z : 1));
  if (!photo) return { z, x: 0, y: 0 };
  const s = Math.max(W / photo.width, H / photo.height) * z;
  const mx = Math.max(0, (photo.width * s - W) / 2), my = Math.max(0, (photo.height * s - H) / 2);
  return { z, x: Math.min(mx, Math.max(-mx, f.x)), y: Math.min(my, Math.max(-my, f.y)) };
}

/** The whole background: preset art or the framed photo, a soft dark band top and bottom so text stays readable, then the person's own darken amount. */
function paintBg(g: CanvasRenderingContext2D, w: number, h: number, bg: string, im: Imgs, photo: HTMLImageElement | null, frame: Frame, darken: number) {
  if (bg.startsWith("photo:") && photo) {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const f = clampFrame(frame, photo), k = w / W;
    const s = Math.max(w / photo.width, h / photo.height) * f.z, dw = photo.width * s, dh = photo.height * s;
    g.drawImage(photo, (w - dw) / 2 + f.x * k, (h - dh) / 2 + f.y * k, dw, dh);
  } else drawPreset(g, w, h, bg.startsWith("photo:") ? "wraith" : bg, im);
  g.fillStyle = grad(g, 0, 0, 0, h, [[0, "rgba(0,0,0,.28)"], [0.22, "rgba(0,0,0,0)"], [0.55, "rgba(0,0,0,.12)"], [1, "rgba(0,0,0,.62)"]]);
  g.fillRect(0, 0, w, h);
  if (darken > 0) { g.fillStyle = `rgba(0,0,0,${darken})`; g.fillRect(0, 0, w, h); }
}

// ───────────────────────── the cards ─────────────────────────
type CardData = {
  name: string; username: string | null; bio: string; value: number | null; bigText?: string; bigCaption?: string; followers: number; following: number;
  total: number; realized: number; un: number; volume: number; pct: number | null; period: string;
  showAvatar: boolean; showStats: boolean; ref: string; im: Imgs; fmt: (n: number) => string; sym: string;
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

function drawCard(c: HTMLCanvasElement, kind: "bio" | "profit", d: CardData, bg: HTMLCanvasElement) {
  const g = c.getContext("2d");
  if (!g) return;
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  g.clearRect(0, 0, W, H);
  g.drawImage(bg, 0, 0);
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
    if (d.showStats) cols([[d.following.toLocaleString("en-US"), "FOLLOWING"], [d.followers.toLocaleString("en-US"), "FOLLOWERS"]], py + 700);
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
    ], py + 700);
  }

  // footer: ghost + WRAITH, then the invite code or the address
  const fy = H - 120;
  g.save(); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 14;
  g.font = `400 70px Impact, 'Arial Narrow', sans-serif`;
  const tw = g.measureText("WRAITH").width;
  if (d.im.ghost) {
    const lh = 74, lw = lh * (d.im.ghost.width / d.im.ghost.height), x0 = cx - (lw + 18 + tw) / 2;
    g.drawImage(d.im.ghost, x0, fy - 62, lw, lh);
    g.textAlign = "left"; g.fillStyle = "#fff"; g.fillText("WRAITH", x0 + lw + 18, fy); g.textAlign = "center";
  } else { g.fillStyle = "#fff"; g.fillText("WRAITH", cx, fy); }
  g.restore();
  g.fillStyle = "rgba(255,255,255,.64)"; g.font = `700 34px ${FONT}`;
  g.fillText(d.ref ? `Join with my code ${d.ref}` : "wraith.farm", cx, fy + 62);
}

function Thumb({ id, im }: { id: string; im: Imgs }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext("2d");
    if (!c || !g) return;
    c.width = 220; c.height = 330;
    paintBg(g, 220, 330, id, im, null, FRESH, 0);
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
  const [darken, setDarken] = useState(Math.min(0.8, Math.max(0, initial.darken ?? 0)));
  const [frame, setFrame] = useState<Frame>(FRESH);
  const [photos, setPhotos] = useState<Photo[]>(() => (typeof window === "undefined" ? [] : readPhotos()));
  const [idx, setIdx] = useState(0);
  const [menu, setMenu] = useState<null | "range" | "show">(null);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<"yours" | "presets">("presets");
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [im, setIm] = useState<Imgs>({ av: null, ghost: null });
  const [photoImg, setPhotoImg] = useState<HTMLImageElement | null>(null);
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
  const photoRef = useRef<HTMLImageElement | null>(null);
  photoRef.current = photoImg;
  const noteTimer = useRef(0);

  const isPhoto = bg.startsWith("photo:");
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
    void Promise.all([loadImg(avatar), loadImg("/logo.png")]).then(([av, ghost]) => { if (on) setIm({ av, ghost }); });
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

  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ range, bg, showAvatar, showStats, darken } satisfies Prefs)); } catch { /* storage blocked */ } }, 250);
    return () => window.clearTimeout(t);
  }, [range, bg, showAvatar, showStats, darken]);

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
    showAvatar, showStats, ref, im, fmt, sym,
  }), [name, username, bio, value, bioBig, followers, following, stats, rangeInfo, showAvatar, showStats, ref, im, fmt, sym]);

  // build the background once per change, then draw the cards (and the adjust preview) on top of it
  useEffect(() => {
    const key = JSON.stringify([bg, frame, darken, !!im.av, !!im.ghost, photoImg?.src.length ?? 0]);
    const c = bgCanvas.current ?? (bgCanvas.current = document.createElement("canvas"));
    if (key !== bgKey.current) {
      c.width = W; c.height = H;
      const g = c.getContext("2d");
      if (!g) return;
      paintBg(g, W, H, bg, im, photoImg, frame, darken);
      bgKey.current = key;
      const t = thumbRef.current, tg = t?.getContext("2d");
      if (t && tg) { t.width = 88; t.height = 88; tg.drawImage(c, 0, H * 0.18, W, W, 0, 0, 88, 88); }
    }
    if (bioRef.current) drawCard(bioRef.current, "bio", data, c);
    if (profitRef.current) drawCard(profitRef.current, "profit", data, c);
    if (adjRef.current) drawCard(adjRef.current, idx === 0 ? "bio" : "profit", data, c);
  }, [bg, frame, darken, im, photoImg, data, idx, adjusting]);

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
    if (id.startsWith("photo:") && darken === 0) setDarken(0.2); // photos are busy: a little darker keeps the numbers readable
  };
  const onFile = async (f?: File | null) => {
    if (!f) return;
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
    if (!isPhoto) { if (!toasted.current) { toasted.current = true; flash("Framing is available for photos"); } p.x = e.clientX; p.y = e.clientY; return; }
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
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => { if (isPhoto) setFrame((f) => clampFrame({ ...f, z: f.z * (e.deltaY < 0 ? 1.08 : 0.92) }, photoRef.current)); };

  const share = async () => {
    const c = (idx === 0 ? bioRef : profitRef).current;
    if (!c) return;
    const blob = await new Promise<Blob | null>((res) => { try { c.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
    if (!blob) { flash("Could not make the image"); return; }
    const file = new File([blob], `wraith-${idx === 0 ? "bio" : "profit"}.png`, { type: "image/png" });
    try {
      const text = shareText ? (ref ? `${shareText} Join with my code ${ref}.` : shareText) : (ref ? `Trade with me on Wraith. Code ${ref}` : "My Wraith card");
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    } catch { return; /* the share sheet was closed */ }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    flash("Saved the image");
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
              <button type="button" className={tab === "yours" ? "on" : ""} onClick={() => setTab("yours")}>Yours</button>
              <button type="button" className={tab === "presets" ? "on" : ""} onClick={() => setTab("presets")}>Presets</button>
            </div>
            <div className="shs-grid">
              {tab === "yours" ? (
                <>
                  <label className="shs-tile add"><ImagePlus size={26} /><span>Add photo</span>
                    <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onFile(f); }} />
                  </label>
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
            <p className="shs-hint">{isPhoto ? "Drag to move, pinch to zoom" : "Framing is available for photos"}</p>
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
