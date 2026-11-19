"use client";
// The Wraith ghost as a character, not just a logo: it stands on a small podium in a spotlight with gold sparks drifting down (the trophy mood of
// a rewards screen), wearing a crown. A pure CSS / SVG scene (no images but the logo): light, and it respects "reduce motion".
// <GhostScene /> is the big banner for hero spots. <GhostMini /> is the small sleepy ghost used in empty states.

const SPARKS = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 37 + 9) % 96}%`,
  delay: `${((i * 7) % 11) * 0.45}s`,
  dur: `${5.2 + ((i * 3) % 5) * 0.8}s`,
  size: 4 + (i % 3) * 2,
  gold: i % 3 !== 0,
}));

export default function GhostScene({ title, subtitle, height = 210 }: { title: string; subtitle?: string; height?: number }) {
  return (
    <div className="gs" style={{ height }} role="img" aria-label={title}>
      <i className="gs-cone" aria-hidden="true" />
      {SPARKS.map((s, i) => (
        <b key={i} className={`gs-spark${s.gold ? " gold" : ""}`} aria-hidden="true" style={{ left: s.left, animationDelay: s.delay, animationDuration: s.dur, width: s.size, height: s.size }} />
      ))}
      <div className="gs-stage" aria-hidden="true">
        <div className="gs-ghost-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="gs-ghost" src="/logo.png" alt="" />
          <svg className="gs-crown" viewBox="0 0 64 42" width="46" height="30">
            <defs>
              <linearGradient id="gsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#e0a020" /></linearGradient>
            </defs>
            <path d="M5 36 9 9l14 13L32 4l9 18L55 9l4 27Z" fill="url(#gsg)" stroke="#a8730a" strokeWidth="1.6" strokeLinejoin="round" />
            <rect x="5" y="34" width="54" height="6" rx="2" fill="#f2b632" stroke="#a8730a" strokeWidth="1.4" />
            <circle cx="9" cy="8" r="3" fill="#fff3c4" /><circle cx="32" cy="3.5" r="3.2" fill="#fff3c4" /><circle cx="55" cy="8" r="3" fill="#fff3c4" />
          </svg>
        </div>
        <div className="gs-podium"><span className="p2" /><span className="p1" /><span className="p3" /></div>
      </div>
      <div className="gs-copy"><b>{title}</b>{subtitle ? <small>{subtitle}</small> : null}</div>
    </div>
  );
}

/** The small sleepy ghost for empty states: floats gently, "z z z" rising from it. */
export function GhostMini({ size = 54 }: { size?: number }) {
  return (
    <div className="gm" aria-hidden="true" style={{ width: size * 1.7, height: size * 1.5 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" style={{ height: size }} />
      <span className="z1">z</span><span className="z2">z</span><span className="z3">Z</span>
    </div>
  );
}
