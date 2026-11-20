// Moving backgrounds for the Share studio that are drawn in code (no video, no download, nothing copyrighted): a synthwave sunset, a rainy neon
// city, a fire and an aurora. Everything is relative to the size (u = width / 1080) so a small tile and the full card look the same, and `t` is
// in seconds. `R` is a seeded random function that is re-seeded for every frame, so the same stars and buildings appear in the same places each time.

type G = CanvasRenderingContext2D;

const grad = (g: G, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const l = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) l.addColorStop(o, c);
  return l;
};
const glow = (g: G, x: number, y: number, r: number, rgb: string, a: number) => {
  const rg = g.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, `rgba(${rgb},${a})`); rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
};
const stars = (g: G, w: number, h: number, u: number, t: number, R: () => number, n: number, maxY: number) => {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h * maxY, s = (0.8 + R() * 2.2) * u, ph = R() * 6.28, sp = 0.6 + R() * 2;
    g.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * sp + ph))})`;
    g.fillRect(x, y, s, s);
  }
};

function synthwave(g: G, w: number, h: number, t: number, R: () => number) {
  const u = w / 1080, hor = h * 0.58;
  g.fillStyle = grad(g, 0, 0, 0, hor, [[0, "#0a0020"], [0.55, "#3b0a5e"], [0.85, "#c2307f"], [1, "#ff7a59"]]); g.fillRect(0, 0, w, hor + 2);
  stars(g, w, h, u, t, R, 90, 0.4);
  // the sun, cut by stripes that thicken toward the bottom and slide down
  const cx = w / 2, cy = hor - 0.02 * h, r = w * 0.3;
  glow(g, cx, cy, r * 1.9, "255,90,120", 0.4);
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = grad(g, 0, cy - r, 0, cy + r, [[0, "#ffe45c"], [0.5, "#ff7a45"], [1, "#e0306e"]]); g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = "#4a0f66";
  const phase = (t * 0.12) % 1;
  for (let i = 0; i < 9; i++) {
    const k = (i + phase) / 9; // 0 at the top of the cut area, 1 at the bottom
    const y = cy - r * 0.05 + k * r * 1.05, th = (3 + k * 26) * u;
    g.fillRect(cx - r, y, r * 2, th);
  }
  g.restore();
  // far mountains
  g.fillStyle = "#1c0636"; g.beginPath(); g.moveTo(0, hor);
  for (let x = 0; x <= w; x += 36 * u) g.lineTo(x, hor - (40 + 70 * Math.abs(Math.sin(x * 0.006 + 1.3)) + 30 * Math.abs(Math.sin(x * 0.017))) * u);
  g.lineTo(w, hor); g.closePath(); g.fill();
  // the ground and its grid, moving toward you
  g.fillStyle = grad(g, 0, hor, 0, h, [[0, "#2a0a4a"], [1, "#0a0216"]]); g.fillRect(0, hor, w, h - hor);
  glow(g, cx, hor, w * 0.9, "255,70,160", 0.25);
  g.lineWidth = Math.max(1.5, 3 * u);
  g.strokeStyle = "rgba(255,60,200,.75)";
  for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(cx + i * 14 * u, hor); g.lineTo(cx + i * w * 0.14, h); g.stroke(); }
  const rows = 16, slide = (t * 0.45) % 1;
  for (let i = 0; i < rows; i++) {
    const k = (i + slide) / rows, y = hor + (h - hor) * k * k;
    g.strokeStyle = `rgba(80,220,255,${0.25 + 0.6 * k})`; g.lineWidth = Math.max(1, (1 + 4 * k) * u);
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  glow(g, cx, hor, w * 0.5, "255,150,190", 0.22);
}

function citynight(g: G, w: number, h: number, t: number, R: () => number) {
  const u = w / 1080, hor = h * 0.74;
  g.fillStyle = grad(g, 0, 0, 0, hor, [[0, "#04020b"], [0.5, "#150a33"], [1, "#4b1456"]]); g.fillRect(0, 0, w, h);
  stars(g, w, h, u, t, R, 40, 0.3);
  glow(g, w * 0.5, hor, w * 0.85, "255,70,170", 0.3);
  // three layers of buildings, far to near, sliding at different speeds
  const layers: { n: number; min: number; max: number; col: string; speed: number; lit: number }[] = [
    { n: 16, min: 0.18, max: 0.36, col: "#1a0b36", speed: 7, lit: 0 },
    { n: 11, min: 0.2, max: 0.46, col: "#10061f", speed: 15, lit: 0.18 },
    { n: 7, min: 0.22, max: 0.56, col: "#07030f", speed: 30, lit: 0.34 },
  ];
  for (const L of layers) {
    const bw = (w * 1.2) / L.n, span = bw * L.n;
    for (let i = 0; i < L.n; i++) {
      const hh = (L.min + R() * (L.max - L.min)) * h, ww = bw * (0.7 + R() * 0.45), seed = R();
      const x = (((i * bw - t * L.speed * u) % span) + span) % span - bw;
      g.fillStyle = L.col; g.fillRect(x, hor - hh, ww, hh + 2);
      if (L.lit) { // windows, a few of them blinking
        const cols = Math.max(2, Math.floor(ww / (22 * u))), rows = Math.floor(hh / (30 * u));
        for (let cI = 0; cI < cols; cI++) for (let rI = 0; rI < rows; rI++) {
          const q = (Math.sin(i * 91.7 + cI * 12.9898 + rI * 78.233) * 43758.5453) % 1, on = Math.abs(q) < L.lit;
          if (!on) continue;
          const blink = 0.55 + 0.45 * Math.sin(t * (0.8 + Math.abs(q) * 3) + seed * 20 + cI);
          const pink = Math.abs(q * 7) % 1 > 0.55;
          g.fillStyle = pink ? `rgba(255,90,190,${0.35 + 0.5 * blink})` : `rgba(255,224,140,${0.3 + 0.5 * blink})`;
          g.fillRect(x + (cI + 0.5) * (ww / cols) - 4 * u, hor - hh + (rI + 0.6) * (hh / rows) - 5 * u, 8 * u, 10 * u);
        }
      }
    }
  }
  // neon signs on the near layer: soft pulsing bars
  const pulse = 0.65 + 0.35 * Math.sin(t * 2.2);
  glow(g, w * 0.22, h * 0.5, w * 0.22, "0,220,255", 0.4 * pulse); glow(g, w * 0.8, h * 0.44, w * 0.2, "255,60,190", 0.4 * (1.1 - pulse * 0.4));
  // the wet street and the reflected lights
  g.fillStyle = grad(g, 0, hor, 0, h, [[0, "#12061f"], [1, "#04020a"]]); g.fillRect(0, hor, w, h - hor);
  glow(g, w * 0.3, hor + (h - hor) * 0.35, w * 0.45, "0,200,255", 0.18); glow(g, w * 0.75, hor + (h - hor) * 0.4, w * 0.5, "255,60,180", 0.2);
  // rain
  g.lineCap = "round";
  for (let i = 0; i < 150; i++) {
    const x0 = R() * (w + 300 * u), y0 = R() * (h + 200), sp = 700 + R() * 700, len = (28 + R() * 50) * u, a = 0.1 + R() * 0.28;
    const y = (y0 + t * sp * u) % (h + 200) - 100, x = x0 - y * 0.18 - 100 * u;
    g.strokeStyle = `rgba(190,215,255,${a})`; g.lineWidth = Math.max(1, 1.8 * u);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * 0.18, y + len); g.stroke();
  }
}

function inferno(g: G, w: number, h: number, t: number, R: () => number) {
  const u = w / 1080;
  g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#070102"], [0.35, "#2a0709"], [0.65, "#7d1606"], [1, "#e0560f"]]); g.fillRect(0, 0, w, h);
  const fl = 0.8 + 0.2 * Math.sin(t * 7) * Math.sin(t * 3.1);
  glow(g, w * 0.5, h * 1.0, w * 1.25, "255,120,30", 0.6 * fl);
  glow(g, w * 0.5, h * 0.78, w * 0.7, "255,70,20", 0.2 * fl);
  // layers of flames: wavy tongues that rise and fall
  const lay = [
    { base: 0.26, amp: 0.2, f1: 0.007, f2: 0.017, s1: 1.7, s2: 2.4, c: ["rgba(120,20,0,.0)", "rgba(190,40,6,.6)", "rgba(255,90,10,.8)"] },
    { base: 0.19, amp: 0.16, f1: 0.009, f2: 0.021, s1: 2.3, s2: 3.1, c: ["rgba(255,80,10,.0)", "rgba(255,120,20,.65)", "rgba(255,190,60,.9)"] },
    { base: 0.12, amp: 0.11, f1: 0.011, f2: 0.027, s1: 3.1, s2: 4.2, c: ["rgba(255,170,40,.0)", "rgba(255,200,70,.7)", "rgba(255,245,170,.98)"] },
  ];
  for (let li = 0; li < lay.length; li++) {
    const L = lay[li];
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 10 * u) {
      const y = h - (L.base + L.amp * (0.5 + 0.5 * Math.sin(x * L.f1 / u + t * L.s1 + li) * (0.6 + 0.4 * Math.sin(x * L.f2 / u - t * L.s2)))) * h;
      g.lineTo(x, y);
    }
    g.lineTo(w, h); g.closePath();
    g.fillStyle = grad(g, 0, h - (L.base + L.amp) * h, 0, h, [[0, L.c[0]], [0.45, L.c[1]], [1, L.c[2]]]); g.fill();
  }
  // embers rising
  for (let i = 0; i < 130; i++) {
    const x0 = R() * w, sp = (70 + R() * 190) * u, ph = R() * 6.28, sz = (2 + R() * 6) * u, y0 = R() * h;
    const life = ((y0 + t * sp) % (h * 0.95)) / (h * 0.95); // 0 at the fire, 1 at the top
    const y = h - life * h * 0.95, x = x0 + Math.sin(t * 1.1 + ph + life * 6) * 38 * u * (0.4 + life);
    const a = (1 - life) * (0.55 + 0.45 * Math.sin(t * 9 + ph));
    g.fillStyle = `rgba(255,${Math.round(210 - life * 140)},${Math.round(80 - life * 70)},${Math.max(0, a)})`;
    g.beginPath(); g.arc(x, y, sz, 0, 6.28); g.fill();
  }
}

function aurora(g: G, w: number, h: number, t: number, R: () => number) {
  const u = w / 1080;
  g.fillStyle = grad(g, 0, 0, 0, h, [[0, "#01040c"], [0.55, "#031328"], [1, "#06243a"]]); g.fillRect(0, 0, w, h);
  stars(g, w, h, u, t, R, 110, 0.62);
  g.save(); g.globalCompositeOperation = "lighter";
  const bands = [
    { rgb: "60,255,170", y: 0.3, amp: 0.07, k: 0.0036, sp: 0.35, th: 0.34, a: 0.5 },
    { rgb: "70,200,255", y: 0.38, amp: 0.06, k: 0.0049, sp: 0.28, th: 0.3, a: 0.36 },
    { rgb: "170,110,255", y: 0.27, amp: 0.08, k: 0.0028, sp: 0.22, th: 0.26, a: 0.3 },
  ];
  for (let bi = 0; bi < bands.length; bi++) {
    const B = bands[bi], step = 7 * u;
    for (let x = 0; x < w; x += step) {
      const cy = h * (B.y + B.amp * Math.sin(x * B.k / u * 1 + t * B.sp + bi * 2) + 0.03 * Math.sin(x * 0.011 / u - t * B.sp * 1.3));
      const ln = h * B.th * (0.6 + 0.4 * Math.sin(x * 0.0083 / u + t * 0.5 + bi));
      const gr = g.createLinearGradient(0, cy - ln * 0.15, 0, cy + ln);
      gr.addColorStop(0, `rgba(${B.rgb},0)`); gr.addColorStop(0.18, `rgba(${B.rgb},${B.a})`); gr.addColorStop(1, `rgba(${B.rgb},0)`);
      g.fillStyle = gr; g.fillRect(x, cy - ln * 0.15, step + 1, ln * 1.15);
    }
  }
  g.restore();
  // dark ridge in front and a faint reflection
  g.fillStyle = "#020509"; g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 30 * u) g.lineTo(x, h * 0.86 - (30 + 55 * Math.abs(Math.sin(x * 0.0045 / u + 0.7)) + 25 * Math.abs(Math.sin(x * 0.014 / u))) * u);
  g.lineTo(w, h); g.closePath(); g.fill();
  glow(g, w * 0.5, h * 0.95, w * 0.7, "60,255,170", 0.07);
}

/** Draws one of the code-made moving scenes; returns false for any other id so the caller can draw its own. */
export function drawScene(g: G, w: number, h: number, id: string, t: number, R: () => number): boolean {
  switch (id) {
    case "synthwave": synthwave(g, w, h, t, R); return true;
    case "citynight": citynight(g, w, h, t, R); return true;
    case "inferno": inferno(g, w, h, t, R); return true;
    case "aurora": aurora(g, w, h, t, R); return true;
    default: return false;
  }
}
