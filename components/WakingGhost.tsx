"use client";
// The ghost on the lock screen. It is asleep (eyes shut, breathing slowly) until you touch a key, then it wakes up with a little hop, opens its eyes and
// blinks now and then. A wrong code squints them, the right one opens them wide. It is the logo's own shape (public/logo.svg) drawn as SVG so the eyes can move.
import { useEffect, useId, useState } from "react";

export default function WakingGhost({ awake, tone = "idle" }: { awake: boolean; tone?: "idle" | "error" | "ok" }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!awake) { setBlink(false); return; }
    let t = 0, b = 0;
    const loop = () => {
      t = window.setTimeout(() => { setBlink(true); b = window.setTimeout(() => setBlink(false), 140); loop(); }, 2200 + Math.random() * 2800);
    };
    loop();
    return () => { window.clearTimeout(t); window.clearTimeout(b); };
  }, [awake]);
  const shut = !awake || blink;
  const sy = tone === "error" ? 0.5 : tone === "ok" ? 1.18 : 1;
  return (
    <svg className={`wpl-ghost${awake ? " awake" : ""}`} viewBox="40 30 153 170" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff9556" /><stop offset=".55" stopColor="#ff7b3d" /><stop offset="1" stopColor="#f0601f" /></linearGradient>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity=".10" /><stop offset=".45" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".22" /></linearGradient>
        <radialGradient id={`${uid}e`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff3df" /><stop offset=".6" stopColor="#ffb877" /><stop offset="1" stopColor="#ff8a3d" /></radialGradient>
        <filter id={`${uid}b`} x="-80%" y="-120%" width="260%" height="340%"><feGaussianBlur stdDeviation="3.2" /></filter>
      </defs>
      <path d="M72 99.5C72 69.1 91.9 44.5 116.5 44.5S161 69.1 161 99.5L161 151.5 148 164.5 140 172.5 127 159.5 106 180.5 93 167.5 72 188.5Z" fill={`url(#${uid}g)`} stroke={`url(#${uid}g)`} strokeWidth="6" strokeLinejoin="round" />
      <path d="M72 99.5C72 69.1 91.9 44.5 116.5 44.5S161 69.1 161 99.5L161 151.5 148 164.5 140 172.5 127 159.5 106 180.5 93 167.5 72 188.5Z" fill={`url(#${uid}s)`} />
      {/* open eyes */}
      <g className="eyes" style={{ transform: `scaleY(${shut ? 0.1 : sy})`, transformOrigin: "0px 99.5px", opacity: shut ? 0 : 1 }}>
        <g transform="rotate(13 99.5 99.5)">
          <rect x="86.5" y="93" width="26" height="13" rx="6.5" fill="#0a0504" />
          <rect x="89" y="95.5" width="21" height="8" rx="4" fill="#ff8a3d" filter={`url(#${uid}b)`} opacity=".9" />
          <rect x="90.5" y="96.5" width="18" height="6" rx="3" fill={`url(#${uid}e)`} />
        </g>
        <g transform="rotate(-13 133.5 99.5)">
          <rect x="120.5" y="93" width="26" height="13" rx="6.5" fill="#0a0504" />
          <rect x="123" y="95.5" width="21" height="8" rx="4" fill="#ff8a3d" filter={`url(#${uid}b)`} opacity=".9" />
          <rect x="124.5" y="96.5" width="18" height="6" rx="3" fill={`url(#${uid}e)`} />
        </g>
      </g>
      {/* shut eyes: two small closed lids */}
      <g className="lids" style={{ opacity: shut ? 1 : 0 }} fill="none" stroke="#2a0f06" strokeWidth="4.2" strokeLinecap="round">
        <path d="M88.5 98q11 8 22 0" transform="rotate(13 99.5 99.5)" />
        <path d="M122.5 98q11 8 22 0" transform="rotate(-13 133.5 99.5)" />
      </g>
    </svg>
  );
}
