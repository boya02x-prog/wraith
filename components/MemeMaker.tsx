"use client";

// Meme maker for intel posts: pick a photo (or a built-in background), add top/bottom text, post it.
// Everything runs in the browser on a canvas; the result is a small JPEG data URL that the existing image upload already accepts.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, X } from "lucide-react";

const SIZE = 640;
const MAX_CHARS = 420_000; // the callouts API keeps images up to ~450k characters

const BACKGROUNDS: { id: string; label: string; draw: (c: CanvasRenderingContext2D, img: HTMLImageElement | null) => void }[] = [
  { id: "ghost", label: "Ghost", draw: (c, img) => { grad(c, "#1a0f0a", "#0c0c0d"); if (img) c.drawImage(img, SIZE * 0.25, SIZE * 0.18, SIZE * 0.5, SIZE * 0.64); } },
  { id: "pump", label: "Pump", draw: (c) => { grad(c, "#06210f", "#0c0c0d"); line(c, [[0, .85], [.2, .75], [.35, .8], [.55, .5], [.7, .55], [1, .12]], "#22c55e"); } },
  { id: "rug", label: "Rug", draw: (c) => { grad(c, "#250a0a", "#0c0c0d"); line(c, [[0, .2], [.3, .25], [.5, .22], [.62, .8], [.8, .85], [1, .95]], "#ef4444"); } },
  { id: "plain", label: "Plain", draw: (c) => grad(c, "#1a1a1d", "#0c0c0d") },
];
function grad(c: CanvasRenderingContext2D, a: string, b: string) {
  const g = c.createLinearGradient(0, 0, 0, SIZE);
  g.addColorStop(0, a); g.addColorStop(1, b);
  c.fillStyle = g; c.fillRect(0, 0, SIZE, SIZE);
}
function line(c: CanvasRenderingContext2D, pts: [number, number][], color: string) {
  c.strokeStyle = color; c.lineWidth = 8; c.lineJoin = "round"; c.lineCap = "round"; c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x * SIZE, y * SIZE) : c.moveTo(x * SIZE, y * SIZE)));
  c.stroke();
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawText(c: CanvasRenderingContext2D, text: string, size: number, pos: "top" | "bottom") {
  if (!text.trim()) return;
  c.font = `900 ${size}px Impact, "Anton", "Arial Black", sans-serif`;
  c.textAlign = "center"; c.textBaseline = "alphabetic"; c.lineJoin = "round";
  c.lineWidth = Math.max(4, size / 7); c.strokeStyle = "#000"; c.fillStyle = "#fff";
  const lines = wrap(c, text, SIZE - 40);
  const lh = size * 1.05;
  const startY = pos === "top" ? 16 + size : SIZE - 18 - (lines.length - 1) * lh;
  lines.forEach((l, i) => { const y = startY + i * lh; c.strokeText(l, SIZE / 2, y); c.fillText(l, SIZE / 2, y); });
}

export default function MemeMaker({ onDone, onClose }: { onDone: (dataUrl: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [top, setTop] = useState("");
  const [bottom, setBottom] = useState("");
  const [size, setSize] = useState(54);
  const [bg, setBg] = useState("ghost");
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [ghost, setGhost] = useState<HTMLImageElement | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const i = new Image();
    i.onload = () => setGhost(i);
    i.src = "/ghost.png";
  }, []);

  const render = useCallback(() => {
    const cv = canvasRef.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    cv.width = SIZE; cv.height = SIZE;
    if (photo) {
      c.fillStyle = "#0c0c0d"; c.fillRect(0, 0, SIZE, SIZE);
      const s = Math.max(SIZE / photo.width, SIZE / photo.height); // cover
      const w = photo.width * s, h = photo.height * s;
      c.drawImage(photo, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    } else {
      (BACKGROUNDS.find((b) => b.id === bg) ?? BACKGROUNDS[0]).draw(c, ghost);
    }
    drawText(c, top, size, "top");
    drawText(c, bottom, size, "bottom");
  }, [photo, bg, ghost, top, bottom, size]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) { setErr("Use a PNG, JPG, WebP or GIF image."); return; }
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { setPhoto(i); setErr(""); URL.revokeObjectURL(url); };
    i.onerror = () => setErr("Could not read that image.");
    i.src = url;
  };

  const done = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    for (const q of [0.88, 0.78, 0.68, 0.55, 0.42]) {
      const out = cv.toDataURL("image/jpeg", q);
      if (out.length <= MAX_CHARS) { onDone(out); return; }
    }
    setErr("Could not make it small enough. Try a simpler image.");
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="mm-back" role="dialog" aria-label="Meme maker" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mm-box">
        <header><b>Make a meme</b><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <div className="mm-body">
          <canvas ref={canvasRef} className="mm-canvas" />
          <div className="mm-side">
            <label>Top text<input value={top} maxLength={60} onChange={(e) => setTop(e.target.value)} placeholder="WHEN THE CHART…" /></label>
            <label>Bottom text<input value={bottom} maxLength={60} onChange={(e) => setBottom(e.target.value)} placeholder="…FINALLY PUMPS" /></label>
            <label>Text size<input type="range" min={30} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
            <div className="mm-bgs">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} type="button" className={!photo && bg === b.id ? "on" : ""} onClick={() => { setPhoto(null); setBg(b.id); }}>{b.label}</button>
              ))}
              <button type="button" className={photo ? "on" : ""} onClick={() => fileRef.current?.click()}><ImagePlus size={13} /> Your photo</button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            {err && <p className="mm-err">{err}</p>}
            <button type="button" className="mm-go" onClick={done}>Use this meme</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
