"use client";
// Wraith's own 3D character (lib/wraith3d.ts) as a live canvas: it bobs, blinks, turns toward your finger and plays an emote (hop, wave, spin,
// dance, cheer) when you tap it. A still picture of the same scene (public/mascot/*.webp) is drawn underneath, so the spot is never empty: it
// shows first on a phone-shaped banner, stays when the device cannot do 3D or has "reduce motion" on, and the live scene fades in over it.
//
// Speed: building the scene (the environment lighting, the shaders) is the expensive part, and it used to run again every time the Wins
// screen opened, right while the screen was sliding in. Now
//   1. the three.js code is fetched while the app is idle (warmWraith3D, called from AppShell), so opening the screen waits for no download;
//   2. the first build starts only after the screen has settled, and its shaders compile without blocking the page (compileAsync);
//   3. the built scene and its canvas are KEPT: leaving the screen only takes the canvas out of the page, coming back puts it in again at once.
import { useEffect, useRef, useState } from "react";
import type { WebGLRenderer } from "three";
import type { Pose, WraithScene } from "@/lib/wraith3d";

let can3dMemo: boolean | null = null;
function can3D(): boolean {
  if (can3dMemo !== null) return can3dMemo;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return (can3dMemo = false);
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.deviceMemory ?? 8) < 3) return (can3dMemo = false);
    const c = document.createElement("canvas");
    return (can3dMemo = Boolean(c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return (can3dMemo = false);
  }
}

/** Fetch the 3D code and the banner still ahead of time (when the app is idle), so the Wins screen opens without waiting for either. */
export function warmWraith3D() {
  try {
    if (!can3D()) return;
    void import("three");
    void import("@/lib/wraith3d");
    const im = new Image();
    im.decoding = "async";
    im.src = "/mascot/wraith-king.webp";
  } catch { /* optional */ }
}

type Opts = { pose: Pose; podium: 0 | 3; confetti: number; spotlight: boolean; zoom: number; shiftX: number };
type Shared = { canvas: HTMLCanvasElement; renderer: WebGLRenderer; sc: WraithScene; lost: boolean; dpr?: number };
// A phone is where the 3D was laggy: a phone-sized screen or a touch screen gets a lower resolution ceiling and 30 frames a second (a steady 30
// looks smoother than a 60 that keeps dropping), and every device lowers its resolution by itself if it cannot keep up (see the loop below).
const isPhone = () => { try { return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700; } catch { return false; } };
const kept = new Map<string, Shared>();
const building = new Map<string, Promise<Shared | null>>();

const afterSettle = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 700 }); else window.setTimeout(resolve, 40);
  }, ms);
});

function build(key: string, o: Opts, settleMs: number): Promise<Shared | null> {
  const hit = kept.get(key);
  if (hit && !hit.lost) return Promise.resolve(hit);
  const running = building.get(key);
  if (running) return running;
  const p = (async () => {
    // the downloads run in the background while the screen opens; the heavy synchronous part waits for it to settle
    const [THREE, { createWraithScene }] = await Promise.all([import("three"), import("@/lib/wraith3d")]);
    await afterSettle(settleMs);
    const canvas = document.createElement("canvas");
    canvas.className = "w3d-canvas";
    let renderer: WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { return null; }
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const sc = createWraithScene(renderer, { ...o, seed: 7 });
    // compile the shaders in parallel with the page instead of freezing it on the first frame (where the browser cannot, it simply compiles then)
    try { await renderer.compileAsync(sc.scene, sc.camera); } catch { /* compiled on the first frame instead */ }
    const s: Shared = { canvas, renderer, sc, lost: false };
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); s.lost = true; kept.delete(key); });
    kept.set(key, s);
    return s;
  })().finally(() => { building.delete(key); });
  building.set(key, p);
  return p;
}

export default function Wraith3D({
  pose = "king", podium = 3, confetti = 40, spotlight = true, zoom = 1, shiftX = 0, poster, alt = "", className, interactive = true,
}: {
  pose?: Pose;
  podium?: 0 | 3;
  confetti?: number;
  spotlight?: boolean;
  /** camera zoom and sideways shift: must match what the still poster was rendered with */
  zoom?: number;
  shiftX?: number;
  /** the still picture of this scene, e.g. "/mascot/wraith-king.webp" */
  poster: string;
  alt?: string;
  className?: string;
  interactive?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [still, setStill] = useState(false); // this device cannot (or should not) draw 3D: the picture stays
  const [warm, setWarm] = useState(false); // the scene was already built: no fade-in needed

  useEffect(() => {
    if (!can3D()) { setStill(true); return; }
    let alive = true;
    let stop = () => {};
    const key = `${pose}|${podium}|${confetti}|${spotlight}|${zoom}|${shiftX}`;
    const wasKept = kept.has(key);
    if (wasKept) setWarm(true);
    void (async () => {
      const sh = await build(key, { pose, podium, confetti, spotlight, zoom, shiftX }, isPhone() ? 650 : 380);
      const host = wrap.current;
      if (!alive || !sh || !host) return;
      const { canvas, renderer, sc } = sh;
      host.appendChild(canvas);
      const phone = isPhone();
      const maxDpr = phone ? 1.25 : 1.75;
      let dpr = Math.min(sh.dpr ?? window.devicePixelRatio ?? 1, maxDpr, window.devicePixelRatio || 1);
      const fit = () => {
        const r = host.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        renderer.setPixelRatio(dpr);
        renderer.setSize(r.width, r.height, false);
        sc.resize(r.width, r.height);
      };
      fit();
      const ro = new ResizeObserver(fit); ro.observe(host);
      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 }); io.observe(host);
      let raf = 0;
      const ptr = { x: 0, y: 0 };
      const move = (e: PointerEvent) => { const r = host.getBoundingClientRect(); ptr.x = ((e.clientX - r.left) / r.width - 0.5) * 2; ptr.y = ((e.clientY - r.top) / r.height - 0.5) * 2; };
      const rest = () => { ptr.x = 0; ptr.y = 0; };
      const tap = () => sc.poke();
      if (interactive) {
        host.addEventListener("pointermove", move, { passive: true });
        host.addEventListener("pointerleave", rest);
        host.addEventListener("pointerup", rest);
        host.addEventListener("pointerdown", tap);
      }
      let last = performance.now(), shown = false, slow = 0, since = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) { last = now; return; }
        if (phone && now - last < 30) return; // 30 frames a second on a phone
        const frame = now - last;
        const dt = Math.min(0.05, frame / 1000); last = now;
        sc.update(now / 1000, dt, ptr);
        renderer.render(sc.scene, sc.camera);
        if (!shown) { shown = true; setLive(true); }
        // can this device keep up? If it keeps missing the frame budget, draw at a lower resolution (a quarter step at a time, never below 0.75)
        if (frame > (phone ? 46 : 26)) slow++;
        if (now - since > 1500) {
          if (slow > 14 && dpr > 0.75) { dpr = Math.max(0.75, +(dpr - 0.25).toFixed(2)); sh.dpr = dpr; fit(); }
          slow = 0; since = now;
        }
      };
      raf = requestAnimationFrame(loop);
      stop = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
        host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", rest); host.removeEventListener("pointerup", rest); host.removeEventListener("pointerdown", tap);
        canvas.remove(); // kept in memory (see above), only taken out of the page
      };
    })();
    return () => { alive = false; stop(); };
  }, [pose, podium, confetti, spotlight, zoom, shiftX, interactive]);

  return (
    <div ref={wrap} className={`w3d${live ? " is-live" : ""}${still ? " is-still" : ""}${warm ? " is-warm" : ""}${className ? ` ${className}` : ""}`} role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="w3d-poster" src={poster} alt="" draggable={false} />
    </div>
  );
}
