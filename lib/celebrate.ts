// A short burst of confetti (and a buzz on phones) when a trade closes in profit. No library: one canvas, about two seconds,
// removed when done. Skipped entirely for people who ask their system for reduced motion.
export function celebrate(strength: "small" | "big" = "small") {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try { navigator.vibrate?.(strength === "big" ? [30, 40, 30, 40, 60] : [25, 35, 25]); } catch { /* not supported */ }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const c = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000";
  const g = c.getContext("2d");
  if (!g) return;
  g.scale(dpr, dpr);
  document.body.appendChild(c);
  const colors = ["#ff7b3d", "#ffb26b", "#37d58a", "#f2ead8", "#ffd166"];
  const n = strength === "big" ? 150 : 80;
  const parts = Array.from({ length: n }, () => {
    const a = (-Math.PI / 2) + (Math.random() - 0.5) * 1.5; // fan upward from the bottom middle
    const v = (strength === "big" ? 15 : 12) * (0.55 + Math.random() * 0.7);
    return { x: W / 2, y: H * 0.78, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: colors[Math.floor(Math.random() * colors.length)], life: 0 };
  });
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = now - t0;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life = t;
      g.save(); g.globalAlpha = Math.max(0, 1 - t / 2100); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.col;
      g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore();
    }
    if (t < 2100) requestAnimationFrame(tick); else c.remove();
  };
  requestAnimationFrame(tick);
}
