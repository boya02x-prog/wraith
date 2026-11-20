// The art of an avatar border: a small animated SVG drawn around the photo (crown, flames, wings ...). viewBox -50..50, the photo is the circle of
// radius 34 in the middle, so everything here sits outside r=35. Animations are plain CSS classes (fa-*) in app/wraith-frames.css.
// Wrapped by components/Frame.tsx; the big profile photos (.fx) place it themselves.
import { useId, type ReactNode } from "react";

const rot = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + (360 / n) * i);
const polar = (deg: number, r: number) => [Math.cos(((deg - 90) * Math.PI) / 180) * r, Math.sin(((deg - 90) * Math.PI) / 180) * r] as const;
const Spark = ({ x, y, d = 0, s = 1, c = "#fff" }: { x: number; y: number; d?: number; s?: number; c?: string }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}><path className="fa-twinkle" style={{ animationDelay: `${d}s` }} d="M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1Z" fill={c} /></g>
);
const HEART = "M0 3 C-6 -2 -4.5 -7 0 -4 C4.5 -7 6 -2 0 3Z";
const GHOST = "M0 -6 C-4.5 -6 -6 -2.5 -6 1 V6 L-4 4.5 L-2 6 L0 4.5 L2 6 L4 4.5 L6 6 V1 C6 -2.5 4.5 -6 0 -6Z";

const ART: Record<string, (u: string) => ReactNode> = {
  crown: (u) => (
    <>
      <defs><linearGradient id={`g${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff3b0" /><stop offset=".55" stopColor="#ffc94a" /><stop offset="1" stopColor="#b9790f" /></linearGradient></defs>
      <circle r="36" fill="none" stroke={`url(#g${u})`} strokeWidth="2.8" />
      <circle r="36" fill="none" stroke="#fff6c8" strokeOpacity=".55" strokeWidth=".9" strokeDasharray="1 5" className="fa-spin" />
      <g transform="translate(0 -34)">
        <path d="M-15 0 L-19 -15 L-9.5 -8 L0 -19 L9.5 -8 L19 -15 L15 0 Z" fill={`url(#g${u})`} stroke="#8a5a08" strokeWidth=".8" strokeLinejoin="round" />
        <rect x="-15.5" y="-1.6" width="31" height="3.8" rx="1.2" fill="#e0a21f" stroke="#8a5a08" strokeWidth=".6" />
        <circle cx="0" cy="-20" r="2.3" fill="#ff5a7a" /><circle cx="-19" cy="-16" r="1.9" fill="#6fe0ff" /><circle cx="19" cy="-16" r="1.9" fill="#6fe0ff" />
        <circle cx="-5" cy="0.4" r="1.1" fill="#fff6c8" /><circle cx="0" cy="0.4" r="1.1" fill="#ff5a7a" /><circle cx="5" cy="0.4" r="1.1" fill="#fff6c8" />
      </g>
      <Spark x={-33} y={-24} d={0} /><Spark x={34} y={-20} d={0.7} s={0.8} /><Spark x={-37} y={14} d={1.3} s={0.7} /><Spark x={36} y={24} d={0.4} s={0.9} />
    </>
  ),
  flames: (u) => (
    <>
      <defs><linearGradient id={`g${u}`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff3b1a" /><stop offset=".55" stopColor="#ff8a1f" /><stop offset="1" stopColor="#ffd44a" /></linearGradient></defs>
      <circle r="35.5" fill="none" stroke="#ff6a1a" strokeWidth="2.2" />
      {rot(16).map((a, i) => (
        <g key={a} transform={`rotate(${a}) translate(0 -34) scale(${i % 2 ? 0.75 : 1.1})`}>
          <path className="fa-flame" style={{ animationDelay: `${(i % 5) * 0.17}s` }} d="M0 0 C6 -5 7 -12 0 -21 C-1.5 -13 -8 -9 0 0Z" fill={`url(#g${u})`} />
          <path className="fa-flame" style={{ animationDelay: `${(i % 4) * 0.21}s` }} d="M0 0 C2.8 -3 3.4 -7 0 -11.5 C-.8 -7 -4.4 -4.6 0 0Z" fill="#ffe98a" />
        </g>
      ))}
      <Spark x={-30} y={-32} d={0.2} c="#ffd44a" s={0.7} /><Spark x={32} y={-34} d={1} c="#ffb04a" s={0.6} />
    </>
  ),
  wings: (u) => {
    const wing = (
      <g className="fa-flap">
        <path d="M-34 -2 C-46 -24 -64 -18 -60 2 C-58 11 -53 15 -47 15 C-51 19 -49 25 -43 25 C-45 29 -41 31 -37 27 Z" fill={`url(#g${u})`} stroke="#c9d8ff" strokeWidth=".7" strokeLinejoin="round" />
        <path d="M-37 4 C-45 0 -54 2 -58 9 M-37 11 C-43 9 -49 11 -53 17 M-37 18 C-41 17 -45 19 -47 23" stroke="#9fb4e8" strokeWidth=".7" fill="none" strokeLinecap="round" />
      </g>
    );
    return (
      <>
        <defs><linearGradient id={`g${u}`} x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#bcd0ff" /></linearGradient></defs>
        <g>{wing}</g><g transform="scale(-1 1)">{wing}</g>
        <circle r="35.5" fill="none" stroke="#eaf1ff" strokeWidth="2" />
        <ellipse cx="0" cy="-42" rx="14" ry="4.4" fill="none" stroke="#ffe68a" strokeOpacity=".35" strokeWidth="5" />
        <ellipse cx="0" cy="-42" rx="14" ry="4.4" fill="none" stroke="#ffe68a" strokeWidth="2.2" />
        <Spark x={-8} y={-47} d={0.3} c="#fff6c8" s={0.7} /><Spark x={10} y={-46} d={1} c="#fff6c8" s={0.6} />
      </>
    );
  },
  demon: (u) => (
    <>
      <defs><linearGradient id={`g${u}`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#5a0a0a" /><stop offset="1" stopColor="#ff4d4d" /></linearGradient></defs>
      <circle r="35.5" fill="none" stroke="#7a0b12" strokeWidth="2.6" />
      {rot(18, 10).map((a) => <path key={a} transform={`rotate(${a})`} d="M-2.4 -35.8 L0 -43 L2.4 -35.8Z" fill="#c1121f" />)}
      {[1, -1].map((sx) => (
        <g key={sx} transform={`scale(${sx} 1)`}>
          <path d="M-14 -33 C-26 -37 -30 -51 -22 -59 C-23 -48 -17 -42 -10 -37 Z" fill={`url(#g${u})`} stroke="#3a0505" strokeWidth=".7" strokeLinejoin="round" />
        </g>
      ))}
      <Spark x={-30} y={-30} d={0.5} c="#ff6a4d" s={0.6} /><Spark x={31} y={-28} d={1.2} c="#ff6a4d" s={0.6} />
    </>
  ),
  lightning: () => (
    <>
      <circle r="36" fill="none" stroke="#7fd4ff" strokeWidth="2" />
      <circle r="36" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth=".8" strokeDasharray="3 7" className="fa-spin" />
      {rot(7, 8).map((a, i) => (
        <g key={a} transform={`rotate(${a})`}>
          <path className="fa-bolt" style={{ animationDelay: `${(i * 0.23) % 1.4}s` }} d="M0 -37 L-3.4 -44 L2.2 -45 L-2.8 -54" fill="none" stroke="#cfeaff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </>
  ),
  cyber: () => (
    <>
      <circle r="36.5" fill="none" stroke="#22e5ff" strokeWidth="2.4" strokeDasharray="21 6" className="fa-spin" />
      <circle r="41.5" fill="none" stroke="#ff2bd6" strokeWidth="1.4" strokeDasharray="4 8" className="fa-spin rev" />
      <circle r="33.6" fill="none" stroke="#22e5ff" strokeOpacity=".5" strokeWidth=".8" />
      {[45, 135, 225, 315].map((a) => <path key={a} transform={`rotate(${a})`} d="M-7 -46.5 H7 M-7 -46.5 V-43" fill="none" stroke="#22e5ff" strokeWidth="1.4" strokeLinecap="round" />)}
      {rot(24).map((a) => <path key={a} transform={`rotate(${a})`} d="M0 -44.5 V-46.5" stroke="#ff2bd6" strokeOpacity=".8" strokeWidth=".9" />)}
    </>
  ),
  laurel: (u) => (
    <>
      <defs><linearGradient id={`g${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3b0" /><stop offset="1" stopColor="#c98a12" /></linearGradient></defs>
      <circle r="35.2" fill="none" stroke={`url(#g${u})`} strokeWidth="1.4" />
      {[1, -1].map((sx) => (
        <g key={sx} transform={`scale(${sx} 1)`}>
          {Array.from({ length: 11 }, (_, k) => {
            const deg = 190 + k * 13.5; // from the bottom, clockwise up the left side; rotate(deg) lines the leaf up with the way the branch grows
            const [x, y] = polar(deg, 37.5);
            return (
              <g key={k} transform={`translate(${x} ${y}) rotate(${deg})`}>
                <ellipse cx="3.4" cy="-2" rx="5.6" ry="2.1" transform="rotate(-26 3.4 -2)" fill={`url(#g${u})`} stroke="#9a6a0a" strokeWidth=".4" />
                <ellipse cx="3.4" cy="2" rx="5.6" ry="2.1" transform="rotate(26 3.4 2)" fill={`url(#g${u})`} stroke="#9a6a0a" strokeWidth=".4" />
              </g>
            );
          })}
          <circle cx={polar(339, 41)[0]} cy={polar(339, 41)[1]} r="1.8" fill="#ff5a7a" />
        </g>
      ))}
      <path d="M-6 41 L0 37 L6 41 L3 47 L0 43 L-3 47Z" fill={`url(#g${u})`} stroke="#9a6a0a" strokeWidth=".5" />
      <Spark x={-36} y={-20} d={0.2} c="#fff6c8" s={0.7} /><Spark x={36} y={-22} d={0.9} c="#fff6c8" s={0.7} />
    </>
  ),
  frost: () => (
    <>
      <circle r="35.8" fill="none" stroke="#d9f3ff" strokeWidth="2.2" />
      <circle r="35.8" fill="none" stroke="#8fd8ff" strokeWidth=".8" strokeDasharray="2 5" className="fa-spin rev" />
      {rot(12).map((a, i) => (
        <path key={a} transform={`rotate(${a}) scale(${i % 2 ? 0.62 : 1})`} d="M0 -36 L2.4 -42 L0 -51 L-2.4 -42Z" fill="#e8f9ff" stroke="#8fd8ff" strokeWidth=".6" strokeLinejoin="round" />
      ))}
      <Spark x={-34} y={-30} d={0} c="#eaffff" /><Spark x={35} y={-28} d={0.8} c="#eaffff" s={0.8} /><Spark x={-30} y={34} d={1.4} c="#eaffff" s={0.7} /><Spark x={32} y={30} d={0.5} c="#eaffff" s={0.9} />
    </>
  ),
  ghosts: () => (
    <>
      <circle r="35.5" fill="none" stroke="#ff9a52" strokeWidth="2.2" />
      <circle r="35.5" fill="none" stroke="#c58bff" strokeWidth=".9" strokeDasharray="2 4" className="fa-spin rev" />
      <g className="fa-orbit">
        {rot(3).map((a) => (
          <g key={a} transform={`rotate(${a})`}>
            <g transform="translate(0 -43)"><path d={GHOST} fill="#ffd2a8" stroke="#ff7b3d" strokeWidth=".9" /><ellipse cx="-2.2" cy="-1.2" rx="1" ry="1.5" fill="#2a1208" /><ellipse cx="2.2" cy="-1.2" rx="1" ry="1.5" fill="#2a1208" /></g>
          </g>
        ))}
      </g>
    </>
  ),
  valentine: () => (
    <>
      <circle r="35.6" fill="none" stroke="#ff5c93" strokeWidth="2.4" />
      <circle r="35.6" fill="none" stroke="#ffc2d8" strokeWidth=".8" strokeDasharray="1 5" className="fa-spin" />
      {[[-32, -26, 0], [33, -30, 0.5], [-38, 8, 1.1], [39, 12, 1.7], [-24, 38, 0.9], [26, 38, 0.3]].map(([x, y, d], i) => (
        <g key={i} transform={`translate(${x} ${y}) scale(${i % 2 ? 1.2 : 1.6})`}><path className="fa-rise" style={{ animationDelay: `${d}s` }} d={HEART} fill={i % 2 ? "#ff8fb4" : "#ff3d7a"} /></g>
      ))}
    </>
  ),
  halloween: () => (
    <>
      <circle r="35.6" fill="none" stroke="#ff8a1f" strokeWidth="2.6" />
      <circle r="35.6" fill="none" stroke="#7c2bff" strokeWidth="1" strokeDasharray="3 5" className="fa-spin" />
      <g transform="translate(27 29)">
        <ellipse cx="0" cy="0" rx="8.4" ry="7.2" fill="#ff8a1f" stroke="#a84a00" strokeWidth=".7" />
        <path d="M-3.4 -6.8 C-1 -7.4 1 -7.4 3.4 -6.8 M0 -7.2 V6.8" stroke="#c75f00" strokeWidth=".6" fill="none" />
        <path d="M0 -7 C0 -10 1.5 -11.5 3.5 -11.5" stroke="#2f9e3a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M-4.4 -2 L-2.2 -4 L-1.2 -1.6Z M4.4 -2 L2.2 -4 L1.2 -1.6Z M-3.6 2.4 L-1.8 3.8 L0 2.6 L1.8 3.8 L3.6 2.4 L2 5.4 L0 4.2 L-2 5.4Z" fill="#2a0f00" />
      </g>
      {[[-31, -30, 0], [33, -24, 0.25]].map(([x, y, d], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path className="fa-bat" style={{ animationDelay: `${d}s` }} d="M0 0 C-3 -3.4 -7.4 -3.6 -10.5 0 C-7.5 -1.4 -5.2 .8 -3.4 3.4 L0 1.2 L3.4 3.4 C5.2 .8 7.5 -1.4 10.5 0 C7.4 -3.6 3 -3.4 0 0Z" fill="#1d1030" stroke="#7c2bff" strokeWidth=".5" />
        </g>
      ))}
    </>
  ),
  winter: () => (
    <>
      <circle r="35.6" fill="none" stroke="#fff" strokeWidth="2.4" />
      <circle r="35.6" fill="none" stroke="#e5312b" strokeWidth="2.4" strokeDasharray="5 9" className="fa-spin" />
      <g transform="translate(13 -32) rotate(20)">
        <path d="M-17 0 C-15 -15 -4 -24 9 -24 C7 -15 13 -6 17 0 Z" fill="#e5312b" stroke="#a31612" strokeWidth=".7" strokeLinejoin="round" />
        <rect x="-19" y="-1.2" width="38" height="6.4" rx="3.2" fill="#fff" stroke="#d9dde6" strokeWidth=".5" />
        <circle cx="9.5" cy="-25" r="4.2" fill="#fff" stroke="#d9dde6" strokeWidth=".5" />
      </g>
      {[[-36, -14, 0], [38, -6, 0.8], [-30, 30, 1.5], [34, 32, 0.4], [0, 46, 1.1]].map(([x, y, d], i) => <circle key={i} className="fa-fall" style={{ animationDelay: `${d}s` }} cx={x} cy={y} r="1.5" fill="#fff" />)}
    </>
  ),
  blackfriday: () => (
    <>
      <circle r="35.8" fill="none" stroke="#111" strokeWidth="3.2" />
      <circle r="35.8" fill="none" stroke="#ffd24a" strokeWidth="3" strokeDasharray="5 5" className="fa-spin" />
      <g transform="translate(26 30) rotate(-12)">
        <rect x="-15" y="-8" width="30" height="16" rx="3.4" fill="#ffd24a" stroke="#111" strokeWidth=".8" />
        <text x="0" y="3.8" textAnchor="middle" fontSize="10.5" fontWeight="900" fill="#111" fontFamily="Arial, sans-serif">-50%</text>
      </g>
      <Spark x={-33} y={-26} d={0} c="#ffd24a" /><Spark x={34} y={-24} d={0.9} c="#ffd24a" s={0.8} />
    </>
  ),
  newyear: () => (
    <>
      <circle r="35.8" fill="none" stroke="#ffe08a" strokeWidth="2.6" />
      <circle r="35.8" fill="none" stroke="#fff6c8" strokeWidth=".9" strokeDasharray="1 5" className="fa-spin" />
      {[[-34, -30, 0, "#ffd24a"], [35, -26, 0.7, "#ff8fd0"], [-36, 24, 1.4, "#7fe3ff"], [34, 34, 0.35, "#ffd24a"], [0, -46, 1.05, "#ffffff"]].map(([x, y, d, c], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <g className="fa-burst" style={{ animationDelay: `${d}s` }}>
            {rot(8).map((a) => <path key={a} transform={`rotate(${a})`} d="M0 -2 V-7" stroke={c as string} strokeWidth="1.5" strokeLinecap="round" />)}
          </g>
        </g>
      ))}
    </>
  ),
};

export const hasFrameArt = (id: string) => id in ART;

export default function FrameArt({ id }: { id?: string | null }) {
  const u = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const art = id ? ART[id] : undefined;
  if (!art) return null;
  return (
    <svg className={`fr-art fa-${id}`} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
      {art(u)}
    </svg>
  );
}
