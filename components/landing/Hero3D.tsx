"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

function Poster() {
  return (
    <div className="lp-poster" aria-hidden="true">
      <img src="/logo.png" alt="" />
    </div>
  );
}

const Ghost3D = dynamic(() => import("./Ghost3D"), { ssr: false, loading: () => <Poster /> });

function canUse3D() {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if (window.innerWidth < 820) return false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency ?? 8) < 4) return false;
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function Hero3D() {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(canUse3D()); }, []);
  return <div className="lp-hero-art">{on ? <Ghost3D /> : <Poster />}</div>;
}
