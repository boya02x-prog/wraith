"use client";
// Wraith's own 3D character (lib/wraith3d.ts) as a live canvas: it bobs, blinks, turns toward your finger and hops when you tap it.
// A still picture of the same scene (public/mascot/*.png) is drawn underneath, so the spot is never empty: it shows first, stays when the phone
// cannot do 3D or has "reduce motion" on, and the live scene fades in over it with no jump. Three.js only loads when this actually runs.
import { useEffect, useRef, useState } from "react";
import type { Pose } from "@/lib/wraith3d";

function can3D(): boolean {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.deviceMemory ?? 8) < 3) return false;
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
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
  /** the still picture of this scene, e.g. "/mascot/wraith-king.png" */
  poster: string;
  alt?: string;
  className?: string;
  interactive?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!can3D()) return;
    let alive = true, raf = 0;
    let stop = () => {};
    void (async () => {
      const THREE = await import("three");
      const { createWraithScene } = await import("@/lib/wraith3d");
      const host = wrap.current, cv = canvas.current;
      if (!alive || !host || !cv) return;
      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { return; }
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const sc = createWraithScene(renderer, { pose, podium, confetti, spotlight, seed: 7, zoom, shiftX });
      const fit = () => {
        const r = host.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(r.width, r.height, false);
        sc.resize(r.width, r.height);
      };
      fit();
      const ro = new ResizeObserver(fit); ro.observe(host);
      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 }); io.observe(host);
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
      let last = performance.now(), shown = false;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) { last = now; return; }
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        sc.update(now / 1000, dt, ptr);
        renderer.render(sc.scene, sc.camera);
        if (!shown) { shown = true; setLive(true); }
      };
      raf = requestAnimationFrame(loop);
      stop = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
        host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", rest); host.removeEventListener("pointerup", rest); host.removeEventListener("pointerdown", tap);
        sc.dispose(); renderer.dispose();
      };
    })();
    return () => { alive = false; cancelAnimationFrame(raf); stop(); };
  }, [pose, podium, confetti, spotlight, zoom, shiftX, interactive]);

  return (
    <div ref={wrap} className={`w3d${live ? " is-live" : ""}${className ? ` ${className}` : ""}`} role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="w3d-poster" src={poster} alt="" draggable={false} />
      <canvas ref={canvas} className="w3d-canvas" />
    </div>
  );
}
