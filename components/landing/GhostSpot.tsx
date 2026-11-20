"use client";

// The app's own 3D Wraith (components/Wraith3D.tsx) on the website. It is decoration, so it never costs the first paint: three.js is only
// fetched once the browser is idle ("idle", for the hero) or once the spot is close to the screen ("near", for the band at the bottom).
// There is no still picture here on purpose: a device that cannot or should not draw 3D (reduce motion, low memory, data saver) just shows
// nothing in this spot, and the live scene fades in by itself when it is ready.
import { useEffect, useRef, useState } from "react";
import Wraith3D from "@/components/Wraith3D";
import type { Pose } from "@/lib/wraith3d";

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Idle = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

export default function GhostSpot({
  when = "idle", className, pose = "wave", podium = 0, confetti = 0, spotlight = false, zoom = 1, shiftX = 0,
}: {
  when?: "idle" | "near";
  className?: string;
  pose?: Pose;
  podium?: 0 | 3;
  confetti?: number;
  spotlight?: boolean;
  zoom?: number;
  shiftX?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (on) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return; // data saver: no 3D download for decoration
    if (when === "idle") {
      const w = window as unknown as Idle;
      if (w.requestIdleCallback) {
        const id = w.requestIdleCallback(() => setOn(true), { timeout: 2500 });
        return () => w.cancelIdleCallback?.(id);
      }
      const t = window.setTimeout(() => setOn(true), 1500);
      return () => window.clearTimeout(t);
    }
    const el = host.current;
    if (!el || typeof IntersectionObserver === "undefined") { setOn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { rootMargin: "700px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [when, on]);

  return (
    <div ref={host} className={className}>
      {on && <Wraith3D pose={pose} podium={podium} confetti={confetti} spotlight={spotlight} zoom={zoom} shiftX={shiftX} poster={BLANK} />}
    </div>
  );
}
