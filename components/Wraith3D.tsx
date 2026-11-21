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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WebGLRenderer } from "three";
import type { Pose, WraithScene } from "@/lib/wraith3d";
import { petKey, type PetLook } from "@/lib/wraithPet";

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

/** The Wins banner's scene: components/GhostScene.tsx draws it with exactly these settings (and warmWraith3D builds it ahead of time with them). */
export const WINS_SCENE = { pose: "king", podium: 3, confetti: 44, spotlight: true, zoom: 1.15, shiftX: 0.85 } as const;
const sceneKey = (o: Opts) => (o.pet ? `pet|${petKey(o.pet)}|${o.zoom}|${o.shiftX}|${o.lift ?? 0}` : `${o.pose}|${o.podium}|${o.confetti}|${o.spotlight}|${o.zoom}|${o.shiftX}`);

/**
 * Fetch the 3D code and the banner still ahead of time (when the app is idle), so the Wins screen opens without waiting for either, and a few
 * seconds later BUILD the Wins scene itself while nothing else is going on. Before this the scene was only built after you opened Wins, so the
 * still picture sat there for a second or more, which looked like a frozen character that then suddenly started to move. Now it is already
 * built and kept (see `kept`), and opening Wins shows it moving at once.
 */
export function warmWraith3D() {
  try {
    if (!can3D()) return;
    void import("three");
    void import("@/lib/wraith3d");
    const im = new Image();
    im.decoding = "async";
    im.src = "/mascot/wraith-king.webp";
    // the scene is built while the app is still quiet, a moment after it opens, so it is long finished by the time anyone taps Wins
    window.setTimeout(() => {
      void build(sceneKey(WINS_SCENE), WINS_SCENE, 0).catch(() => undefined);
    }, isPhone() ? 900 : 500);
  } catch { /* optional */ }
}

type Opts = { pose: Pose; podium: 0 | 3; confetti: number; spotlight: boolean; zoom: number; shiftX: number; lift?: number; pet?: PetLook };
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
    // one frame now, off the page: the first frame that is really shown then does not pay for uploading the textures and buffers to the graphics card
    try { sc.update(0, 0.016, { x: 0, y: 0 }); renderer.render(sc.scene, sc.camera); } catch { /* the first real frame does it */ }
    const s: Shared = { canvas, renderer, sc, lost: false };
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); s.lost = true; kept.delete(key); });
    // old pet scenes that are not on screen are let go: when a pet's look changes (a new mood after a trade) or you move to another profile, the phone never holds a
    // graphics context per mood. (One that is still in the page is in use, say two different pets on one screen, and stays.)
    if (o.pet) for (const [k, v] of [...kept]) if (k.startsWith("pet|") && k !== key && !v.canvas.isConnected) { kept.delete(k); try { v.sc.dispose(); v.renderer.dispose(); v.renderer.forceContextLoss(); } catch { /* already gone */ } }
    kept.set(key, s);
    return s;
  })().finally(() => { building.delete(key); });
  building.set(key, p);
  return p;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Puts a built scene into `host` and runs it; returns the function that takes it out again (the scene itself stays in `kept`).
 * The first frame is drawn right here, before the browser paints, so the character is on screen together with the screen, not a moment after it
 * (the still picture used to show first and the live scene fade in over it, which read as a frozen character that then started).
 */
function attach(sh: Shared, host: HTMLElement, interactive: boolean, onLive: () => void): () => void {
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
    renderer.render(sc.scene, sc.camera); // resizing clears the canvas: draw it again at once so it never flashes empty
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
  let last = performance.now(), slow = 0, since = performance.now();
  sc.update(last / 1000, 0.016, ptr);
  renderer.render(sc.scene, sc.camera);
  onLive();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) { last = now; return; }
    if (phone && now - last < 30) return; // 30 frames a second on a phone
    const frame = now - last;
    const dt = Math.min(0.05, frame / 1000); last = now;
    sc.update(now / 1000, dt, ptr);
    renderer.render(sc.scene, sc.camera);
    // can this device keep up? If it keeps missing the frame budget, draw at a lower resolution (a quarter step at a time, never below 0.75)
    if (frame > (phone ? 46 : 26)) slow++;
    if (now - since > 1500) {
      if (slow > 14 && dpr > 0.75) { dpr = Math.max(0.75, +(dpr - 0.25).toFixed(2)); sh.dpr = dpr; fit(); }
      slow = 0; since = now;
    }
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", rest); host.removeEventListener("pointerup", rest); host.removeEventListener("pointerdown", tap);
    canvas.remove(); // kept in memory (see above), only taken out of the page
  };
}

export default function Wraith3D({
  pose = "king", podium = 3, confetti = 40, spotlight = true, zoom = 1, shiftX = 0, lift, pet, poster, alt = "", className, interactive = true,
}: {
  pose?: Pose;
  podium?: 0 | 3;
  confetti?: number;
  spotlight?: boolean;
  /** camera zoom and sideways shift: must match what the still poster was rendered with */
  zoom?: number;
  shiftX?: number;
  /** camera height (scene units): a pet with a tall hat wants the camera a little higher */
  lift?: number;
  /** someone's own pet (lib/wraithPet.ts): pose, podium, confetti and spotlight are ignored for it */
  pet?: PetLook;
  /** the still picture of this scene, e.g. "/mascot/wraith-king.webp" (a pet's fallback for devices that cannot draw 3D) */
  poster: string;
  alt?: string;
  className?: string;
  interactive?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const key = sceneKey({ pose, podium, confetti, spotlight, zoom, shiftX, lift, pet });
  // the scene was already built (warmWraith3D, or an earlier visit): it is drawn before the first paint, so it starts out live and needs no fade-in
  const [warm] = useState(() => { const h = kept.get(key); return !!h && !h.lost; });
  const [live, setLive] = useState(warm);
  const [still, setStill] = useState(false); // this device cannot (or should not) draw 3D: the picture stays

  useIsoLayoutEffect(() => {
    if (!can3D()) { setStill(true); return; }
    const host = wrap.current;
    if (!host) return;
    let alive = true;
    let stop = () => {};
    const hit = kept.get(key);
    if (hit && !hit.lost) stop = attach(hit, host, interactive, () => setLive(true));
    else {
      // (the wait before a first build used to be 650 / 380 ms because the screen slid in; tab switches no longer slide, so a short settle is enough)
      void build(key, { pose, podium, confetti, spotlight, zoom, shiftX, lift, pet }, isPhone() ? 300 : 150).then((sh) => {
        const h = wrap.current;
        if (alive && sh && h) stop = attach(sh, h, interactive, () => setLive(true));
      });
    }
    return () => { alive = false; stop(); };
  }, [key, pose, podium, confetti, spotlight, zoom, shiftX, lift, pet, interactive]);

  return (
    <div ref={wrap} className={`w3d${live ? " is-live" : ""}${still ? " is-still" : ""}${warm ? " is-warm" : ""}${pet ? " is-pet" : ""}${className ? ` ${className}` : ""}`} role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="w3d-poster" src={poster} alt="" draggable={false} />
    </div>
  );
}
