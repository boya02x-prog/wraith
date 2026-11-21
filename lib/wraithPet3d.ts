// lib/wraithPet3d.ts (browser only, loaded with three.js by lib/wraith3d.ts)
// Draws one pet's own parts on the Wraith body: the eyes, brows, mouth and cheeks that come from its mood, the hat, what it holds in its hand, the mark on its
// belly, the tears or sweat, and the weather around it (sparkles, hearts, coins, a rain cloud, sleepy z's). lib/wraithPet.ts decides what to draw; this only draws.
// Everything is built from simple shapes and the same materials as the rest of the character, so a pet is as light to draw as the Wins ghost.
import * as THREE from "three";
import type { PetLook } from "@/lib/wraithPet";

export interface PetCtx {
  scene: THREE.Scene;
  ghost: THREE.Group;
  armR: THREE.Group;
  own: <T extends { dispose(): void }>(o: T) => T;
  glow: THREE.MeshBasicMaterial;
  goldMat: THREE.MeshStandardMaterial;
  coinFace: THREE.MeshStandardMaterial;
  haloTex: THREE.Texture;
  surfaceZ: (x: number, y: number) => number;
  FACE_Y: number; CY: number; DOME_B: number;
  canvasTexture: (size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) => THREE.CanvasTexture;
  radialTexture: (stops: [number, string][]) => THREE.CanvasTexture;
  starShape: (outer: number, inner: number) => THREE.Shape;
}
export interface PetParts {
  eyes: THREE.Group[]; // two groups; scale.y is the blink (unless userData.noBlink)
  mouth: THREE.Group; // scale is the "smile bigger" of the emotes
  /** where the arms rest (rotation z of the left and the right arm) */
  armBase: { l: number; r: number };
  update(t: number): void;
}

const ARMS = { down: [-0.5, 0.5], up: [-1.9, 1.9], cheer: [-2.5, 2.5], shrug: [-1.15, 1.15], hug: [-0.2, 0.2] } as const;

// small pictures for the weather
const sparkle = (g: CanvasRenderingContext2D, s: number) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2); gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#ffc83d");
  g.fillStyle = gr; g.beginPath();
  g.moveTo(s / 2, 4); g.lineTo(s * 0.58, s * 0.42); g.lineTo(s - 4, s / 2); g.lineTo(s * 0.58, s * 0.58); g.lineTo(s / 2, s - 4); g.lineTo(s * 0.42, s * 0.58); g.lineTo(4, s / 2); g.lineTo(s * 0.42, s * 0.42); g.closePath(); g.fill();
};
const heart = (g: CanvasRenderingContext2D, s: number) => {
  g.fillStyle = "#ff5c8a"; g.beginPath(); g.moveTo(s / 2, s * 0.86);
  g.bezierCurveTo(s * 0.04, s * 0.55, s * 0.12, s * 0.12, s / 2, s * 0.34); g.bezierCurveTo(s * 0.88, s * 0.12, s * 0.96, s * 0.55, s / 2, s * 0.86); g.fill();
  g.fillStyle = "rgba(255,255,255,.55)"; g.beginPath(); g.ellipse(s * 0.34, s * 0.34, s * 0.07, s * 0.045, -0.6, 0, Math.PI * 2); g.fill();
};
const coin = (g: CanvasRenderingContext2D, s: number) => {
  const gr = g.createRadialGradient(s * 0.4, s * 0.35, 4, s / 2, s / 2, s / 2); gr.addColorStop(0, "#fff0b0"); gr.addColorStop(0.55, "#ffc83d"); gr.addColorStop(1, "#d98a14");
  g.fillStyle = gr; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(120,70,0,.5)"; g.lineWidth = 5; g.beginPath(); g.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2); g.stroke();
};
const drop = (g: CanvasRenderingContext2D, s: number) => {
  g.fillStyle = "#7cc4ff"; g.beginPath(); g.moveTo(s / 2, 6); g.bezierCurveTo(s * 0.9, s * 0.5, s * 0.8, s * 0.92, s / 2, s * 0.92); g.bezierCurveTo(s * 0.2, s * 0.92, s * 0.1, s * 0.5, s / 2, 6); g.fill();
};
const zee = (g: CanvasRenderingContext2D, s: number) => {
  g.fillStyle = "#ffffff"; g.font = `800 ${s * 0.8}px "Plus Jakarta Sans", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(120,140,255,.8)"; g.shadowBlur = 10; g.fillText("z", s / 2, s / 2 + 4);
};

export function buildPet(c: PetCtx, look: PetLook): PetParts {
  const { ghost, own, glow, surfaceZ, FACE_Y } = c;
  const basic = (color: string) => own(new THREE.MeshBasicMaterial({ color }));
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => own(new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...extra }));
  const accent = std(look.accent, { roughness: 0.42 });
  const dark = basic("#07030a");
  const anim: ((t: number) => void)[] = [];
  /** stand something on the face / belly: at (x, y) on the body's surface, turned to look outward */
  const onFace = (g: THREE.Object3D, x: number, y: number, lift = 0.012) => { const z = surfaceZ(x, y) + lift; g.position.set(x, y, z); g.rotation.y = Math.atan2(x, z); };
  const spark = (e: THREE.Group, x = -0.035, y = 0.07, r = 0.04) => {
    const s = new THREE.Mesh(own(new THREE.SphereGeometry(r, 12, 12)), basic("#ffffff")); s.position.set(x, y, 0.05); e.add(s);
  };

  // ── eyes ──
  const eyes: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Group();
    onFace(e, sx * 0.29, FACE_Y + 0.1);
    const blob = (rx: number, ry: number) => { const m = new THREE.Mesh(own(new THREE.SphereGeometry(1, 32, 24)), glow); m.scale.set(rx, ry, 0.04); e.add(m); };
    const arc = (up: boolean, y: number, tube = 0.026) => {
      const m = new THREE.Mesh(own(new THREE.TorusGeometry(0.12, tube, 10, 28, Math.PI)), glow); m.rotation.z = up ? 0 : Math.PI; m.position.y = y; e.add(m); e.userData.noBlink = true;
    };
    switch (look.eyes) {
      case "oval": blob(0.14, 0.2); spark(e); break;
      case "tall": blob(0.1, 0.27); spark(e, -0.03, 0.1); break;
      case "wide": {
        blob(0.19, 0.22);
        const p = new THREE.Mesh(own(new THREE.SphereGeometry(0.07, 14, 14)), dark); p.position.set(sx * -0.02, -0.01, 0.05); e.add(p);
        spark(e, -0.05, 0.08, 0.035); break;
      }
      case "dot": blob(0.075, 0.075); spark(e, -0.02, 0.03, 0.022); break;
      case "droop": {
        blob(0.15, 0.19);
        const lid = new THREE.Mesh(own(new THREE.CircleGeometry(1, 28, 0, Math.PI)), dark); lid.scale.set(0.19, 0.12, 1); lid.position.set(0, 0.06, 0.06); lid.rotation.z = sx * 0.12; e.add(lid);
        spark(e, -0.03, -0.02, 0.03); break;
      }
      case "star": {
        const g = own(new THREE.ExtrudeGeometry(c.starShape(0.19, 0.085), { depth: 0.03, bevelEnabled: false })); g.center();
        const m = new THREE.Mesh(g, glow); m.position.z = 0.02; m.rotation.z = sx * 0.12; e.add(m); e.userData.noBlink = true;
        anim.push((t) => m.scale.setScalar(1 + Math.sin(t * 5 + sx) * 0.08)); break;
      }
      case "x": {
        for (const a of [Math.PI / 4, -Math.PI / 4]) { const bar = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.022, 0.2, 6, 10)), glow); bar.rotation.z = a; bar.position.z = 0.03; e.add(bar); }
        e.userData.noBlink = true; break;
      }
      case "spiral": {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 56; i++) { const k = i / 56, a = k * Math.PI * 4.2, r = 0.012 + k * 0.105; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
        const m = new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.013, 6)), glow); m.position.z = 0.03; e.add(m); e.userData.noBlink = true;
        anim.push((t) => { m.rotation.z = -t * 4 * sx; }); break;
      }
      case "closed": arc(false, 0.04); break;
      case "happy": arc(true, -0.04, 0.03); break;
    }
    const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(0.46, 0.46)), own(new THREE.MeshBasicMaterial({ map: c.haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    halo.position.z = -0.01; e.add(halo);
    ghost.add(e); eyes.push(e);
  }

  // ── brows ──
  if (look.brows !== "none") {
    const tilt = look.brows === "worried" ? 0.42 : look.brows === "angry" ? -0.42 : 0.08;
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(own(new THREE.CapsuleGeometry(look.brows === "thick" ? 0.032 : 0.02, 0.16, 6, 10)), glow);
      b.rotation.z = Math.PI / 2;
      const g = new THREE.Group(); g.add(b);
      onFace(g, sx * 0.29, FACE_Y + 0.1 + 0.28, 0.014);
      g.rotation.z = -sx * tilt; // (a worried brow has its inner end up, an angry one its inner end down)
      ghost.add(g);
    }
  }

  // ── mouth ──
  const mouth = new THREE.Group();
  onFace(mouth, 0, FACE_Y - 0.17);
  const mArc = (r: number, tube: number, up: boolean, y: number) => {
    const m = new THREE.Mesh(own(new THREE.TorusGeometry(r, tube, 10, 32, Math.PI)), glow); m.rotation.z = up ? 0 : Math.PI; m.position.y = y; mouth.add(m);
  };
  switch (look.mouth) {
    case "smile": mArc(0.13, 0.023, false, 0.07); break;
    case "grin": {
      mArc(0.2, 0.03, false, 0.1);
      const fill = new THREE.Mesh(own(new THREE.CircleGeometry(0.2, 32, Math.PI, Math.PI)), basic("#fff1dc")); fill.position.set(0, 0.1, -0.003); mouth.add(fill);
      const tongue = new THREE.Mesh(own(new THREE.CircleGeometry(0.085, 20)), basic("#ff7a6a")); tongue.scale.set(1, 0.6, 1); tongue.position.set(0, -0.05, -0.001); mouth.add(tongue);
      break;
    }
    case "flat": { const l = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.016, 0.14, 6, 12)), glow); l.rotation.z = Math.PI / 2; mouth.add(l); break; }
    case "frown": mArc(0.11, 0.022, true, -0.07); break;
    case "open": mouth.add(new THREE.Mesh(own(new THREE.TorusGeometry(0.075, 0.021, 10, 28)), glow)); break;
    case "wavy": {
      const pts = [-0.15, -0.075, 0, 0.075, 0.15].map((x, i) => new THREE.Vector3(x, i % 2 ? 0.03 : -0.03, 0));
      mouth.add(new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.02, 8)), glow)); break;
    }
    case "tiny": { const d = new THREE.Mesh(own(new THREE.SphereGeometry(0.03, 12, 12)), glow); d.scale.z = 0.5; mouth.add(d); break; }
  }
  ghost.add(mouth);

  // ── cheeks ──
  if (look.cheeks === "blush") {
    const tex = own(c.radialTexture([[0, "rgba(255,110,120,.6)"], [1, "rgba(255,110,120,0)"]]));
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(own(new THREE.PlaneGeometry(0.34, 0.22)), own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))));
      onFace(g, sx * 0.5, FACE_Y - 0.06, 0.016); ghost.add(g);
    }
  } else if (look.cheeks === "freckles") {
    const fm = basic("#ffae7a");
    for (const sx of [-1, 1]) for (const [dx, dy] of [[0, 0], [0.07, 0.05], [0.07, -0.05]]) {
      const g = new THREE.Group(); const m = new THREE.Mesh(own(new THREE.SphereGeometry(0.02, 10, 10)), fm); m.scale.z = 0.4; g.add(m);
      onFace(g, sx * (0.46 + dx), FACE_Y - 0.02 + dy, 0.012); ghost.add(g);
    }
  } else if (look.cheeks === "whiskers") {
    for (const sx of [-1, 1]) for (const a of [-0.25, 0, 0.25]) {
      const g = new THREE.Group(); const m = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.01, 0.17, 4, 8)), glow); m.rotation.z = Math.PI / 2 + sx * a; m.position.x = sx * 0.09; g.add(m);
      onFace(g, sx * 0.5, FACE_Y - 0.06 + a * 0.12, 0.012); ghost.add(g);
    }
  }

  // ── tears and sweat ──
  const dropMat = own(new THREE.MeshStandardMaterial({ color: "#8fd0ff", roughness: 0.15, emissive: "#3a8bd8", emissiveIntensity: 0.55 }));
  if (look.tears) {
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); const d = new THREE.Mesh(own(new THREE.SphereGeometry(0.038, 12, 12)), dropMat); d.scale.set(1, 1.5, 0.7); g.add(d); ghost.add(g);
      const y0 = FACE_Y + 0.02, x = sx * 0.31;
      anim.push((t) => { const k = (t * 0.7 + (sx > 0 ? 0.45 : 0)) % 1; const y = y0 - k * 0.4; g.position.set(x, y, surfaceZ(x, y) + 0.03); g.rotation.y = Math.atan2(x, g.position.z); d.scale.set(1 - k * 0.3, (1 - k * 0.2) * 1.5, 0.7); g.visible = k < 0.96; });
    }
  }
  if (look.sweat) {
    const g = new THREE.Group(); const d = new THREE.Mesh(own(new THREE.SphereGeometry(0.05, 12, 12)), dropMat); d.scale.set(1, 1.5, 0.7); g.add(d); ghost.add(g);
    anim.push((t) => { const y = FACE_Y + 0.34 - ((t * 0.5) % 1) * 0.16, x = -0.66; g.position.set(x, y, surfaceZ(x, y) + 0.03); g.rotation.y = Math.atan2(x, g.position.z); });
  }

  // ── hat ──
  const top = c.CY + c.DOME_B;
  const cap = (thetaMax: number, mat: THREE.Material) => {
    // a skin over the top of the head, a little bigger than it, so it sits on it
    const m = new THREE.Mesh(own(new THREE.SphereGeometry(1, 40, 22, 0, Math.PI * 2, 0, thetaMax)), mat);
    m.scale.set(1.09, 0.88, 1.09); m.position.y = c.CY; return m;
  };
  const rimAt = (thetaMax: number) => ({ y: c.CY + 0.88 * Math.cos(thetaMax), r: 1.09 * Math.sin(thetaMax) });
  switch (look.hat) {
    case "crown": {
      const g = new THREE.Group();
      const bandMat = own(new THREE.MeshStandardMaterial({ color: "#ffc83d", metalness: 1, roughness: 0.24, side: THREE.DoubleSide }));
      g.add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.46, 0.42, 0.26, 48, 1, true)), bandMat));
      for (const y of [0.13, -0.13]) { const t = new THREE.Mesh(own(new THREE.TorusGeometry(y > 0 ? 0.46 : 0.42, 0.03, 12, 64)), c.goldMat); t.rotation.x = Math.PI / 2; t.position.y = y; g.add(t); }
      const pearl = own(new THREE.MeshPhysicalMaterial({ color: "#fff6e6", roughness: 0.2, clearcoat: 1, sheen: 1 }));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sp = new THREE.Mesh(own(new THREE.ConeGeometry(0.1, 0.36, 24)), c.goldMat); sp.position.set(Math.sin(a) * 0.45, 0.3, Math.cos(a) * 0.45); g.add(sp);
        const p = new THREE.Mesh(own(new THREE.SphereGeometry(0.055, 16, 16)), pearl); p.position.set(Math.sin(a) * 0.45, 0.5, Math.cos(a) * 0.45); g.add(p);
      }
      const ruby = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.075)), own(new THREE.MeshPhysicalMaterial({ color: "#ff3355", emissive: "#ff1a40", emissiveIntensity: 0.6, roughness: 0.15, clearcoat: 1 })));
      ruby.position.set(0, 0, 0.45); ruby.scale.set(1, 1.3, 0.8); g.add(ruby);
      g.position.set(0.03, top - 0.06, 0.05); g.rotation.set(0.14, 0, -0.08); g.scale.setScalar(1.18); ghost.add(g); break;
    }
    case "beanie": {
      ghost.add(cap(0.95, accent));
      const { y, r } = rimAt(0.95);
      const cuff = new THREE.Mesh(own(new THREE.TorusGeometry(r + 0.01, 0.075, 14, 56)), std("#f4f4f6", { roughness: 0.7 })); cuff.rotation.x = Math.PI / 2; cuff.position.y = y; ghost.add(cuff);
      const pom = new THREE.Mesh(own(new THREE.SphereGeometry(0.15, 20, 20)), std("#f4f4f6", { roughness: 0.8 })); pom.position.set(0, c.CY + 0.88 + 0.1, 0); ghost.add(pom); break;
    }
    case "cap": {
      ghost.add(cap(0.9, accent));
      const { y } = rimAt(0.9);
      const brim = new THREE.Mesh(own(new THREE.CylinderGeometry(1.12, 1.12, 0.05, 40, 1, false, -0.62, 1.24)), std("#1f2937", { roughness: 0.55 })); brim.position.set(0, y - 0.02, 0); brim.rotation.x = -0.12; ghost.add(brim);
      const btn = new THREE.Mesh(own(new THREE.SphereGeometry(0.06, 14, 14)), std("#f4f4f6")); btn.position.set(0, c.CY + 0.88 + 0.01, 0); ghost.add(btn); break;
    }
    case "wizard": {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(own(new THREE.ConeGeometry(0.52, 1.2, 40)), accent); cone.position.y = 0.6; g.add(cone);
      const brim = new THREE.Mesh(own(new THREE.CylinderGeometry(0.98, 0.98, 0.05, 56)), accent); g.add(brim);
      const star = new THREE.Mesh(own(new THREE.ExtrudeGeometry(c.starShape(0.13, 0.055), { depth: 0.03, bevelEnabled: false })), c.goldMat); star.position.set(0, 0.55, 0.3); g.add(star);
      g.position.set(0, top - 0.12, 0.02); g.rotation.z = -0.1; ghost.add(g); break;
    }
    case "bow": {
      const g = new THREE.Group();
      for (const s of [-1, 1]) { const l = new THREE.Mesh(own(new THREE.SphereGeometry(1, 20, 16)), accent); l.scale.set(0.24, 0.14, 0.08); l.position.x = s * 0.2; l.rotation.z = s * 0.45; g.add(l); }
      g.add(new THREE.Mesh(own(new THREE.SphereGeometry(0.085, 16, 16)), accent));
      g.position.set(0.48, 0.86, 0.4); g.rotation.set(-0.5, 0, -0.35); ghost.add(g); break;
    }
    case "halo": {
      const t = new THREE.Mesh(own(new THREE.TorusGeometry(0.42, 0.04, 14, 56)), own(new THREE.MeshStandardMaterial({ color: "#ffd96b", emissive: "#ffc83d", emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 })));
      t.rotation.x = Math.PI / 2 - 0.12; ghost.add(t);
      anim.push((tt) => { t.position.set(0, top + 0.34 + Math.sin(tt * 2) * 0.03, 0.02); t.rotation.z = tt * 0.6; }); break;
    }
    case "horns": {
      for (const s of [-1, 1]) { const h = new THREE.Mesh(own(new THREE.ConeGeometry(0.11, 0.4, 20)), accent); h.position.set(s * 0.42, 0.92, 0.18); h.rotation.z = -s * 0.5; ghost.add(h); } break;
    }
    case "cat": {
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(own(new THREE.ConeGeometry(0.24, 0.44, 4)), std(look.accent)); e.position.set(s * 0.56, 0.8, 0.02); e.rotation.set(0, Math.PI / 4, -s * 0.5); ghost.add(e);
        const inner = new THREE.Mesh(own(new THREE.ConeGeometry(0.13, 0.28, 4)), std("#ff9bb3")); inner.position.set(s * 0.56, 0.78, 0.12); inner.rotation.set(0, Math.PI / 4, -s * 0.5); ghost.add(inner);
      } break;
    }
    case "bunny": {
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.12, 0.55, 8, 16)), accent); e.position.set(s * 0.3, 1.38, 0); e.rotation.z = -s * 0.22; ghost.add(e);
        const inner = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.06, 0.4, 6, 12)), std("#ff9bb3")); inner.position.set(s * 0.3 + (-s) * 0.025, 1.38, 0.08); inner.rotation.z = -s * 0.22; ghost.add(inner);
      } break;
    }
    case "sprout": {
      const stem = new THREE.Mesh(own(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 10)), std("#2f9e63")); stem.position.set(0, top + 0.12, 0); ghost.add(stem);
      for (const s of [-1, 1]) { const l = new THREE.Mesh(own(new THREE.SphereGeometry(1, 20, 14)), std("#34d399")); l.scale.set(0.22, 0.06, 0.12); l.position.set(s * 0.18, top + 0.3, 0); l.rotation.z = s * 0.5; ghost.add(l); } break;
    }
    case "antenna": {
      const stem = new THREE.Mesh(own(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 10)), std("#cfd6e4", { metalness: 0.6 })); stem.position.set(0, top + 0.2, 0); ghost.add(stem);
      const ball = new THREE.Mesh(own(new THREE.SphereGeometry(0.09, 16, 16)), own(new THREE.MeshStandardMaterial({ color: look.accent, emissive: look.accent, emissiveIntensity: 0.7, roughness: 0.3 }))); ball.position.set(0, top + 0.47, 0); ghost.add(ball);
      anim.push((t) => ball.scale.setScalar(1 + Math.sin(t * 4) * 0.12)); break;
    }
    case "party": {
      const h = new THREE.Mesh(own(new THREE.ConeGeometry(0.3, 0.7, 28)), accent); h.position.set(0.22, top + 0.22, 0.08); h.rotation.z = -0.35; ghost.add(h);
      const p = new THREE.Mesh(own(new THREE.SphereGeometry(0.07, 14, 14)), c.goldMat); p.position.set(0.22 + Math.sin(0.35) * 0.35, top + 0.22 + Math.cos(0.35) * 0.35, 0.08); ghost.add(p); break;
    }
    case "none": break;
  }

  // ── what it holds (the right hand) ──
  const holdR = new THREE.Group(); holdR.rotation.y = 0.25; c.armR.add(holdR);
  switch (look.prop) {
    case "coin": { const m = new THREE.Mesh(own(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 48)), [c.goldMat, c.coinFace, c.goldMat]); m.rotation.x = Math.PI / 2; m.position.set(0, -0.68, 0); holdR.add(m); break; }
    case "star": { const m = new THREE.Mesh(own(new THREE.ExtrudeGeometry(c.starShape(0.27, 0.12), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3 })), c.goldMat); m.position.set(0, -0.7, -0.03); m.rotation.z = Math.PI; holdR.add(m); break; }
    case "gem": { const m = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.2)), own(new THREE.MeshPhysicalMaterial({ color: look.accent, emissive: look.accent, emissiveIntensity: 0.35, roughness: 0.1, clearcoat: 1 }))); m.scale.set(1, 1.4, 1); m.position.set(0, -0.72, 0); holdR.add(m); break; }
    case "flag": {
      const pole = new THREE.Mesh(own(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 10)), std("#e5e7eb", { metalness: 0.5 })); pole.position.set(0, -0.35, 0); holdR.add(pole);
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0.5, 0.17); sh.lineTo(0, 0.34); sh.closePath();
      const fl = new THREE.Mesh(own(new THREE.ShapeGeometry(sh)), own(new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.6, side: THREE.DoubleSide }))); fl.position.set(0.02, 0.0, 0); holdR.add(fl);
      anim.push((t) => { fl.rotation.y = Math.sin(t * 3) * 0.25; }); break;
    }
    case "none": break;
  }

  // ── the mark on its belly ──
  if (look.emblem !== "none") {
    const y = -0.34;
    const g = new THREE.Group(); onFace(g, 0, y, 0.02);
    switch (look.emblem) {
      case "star": { const m = new THREE.Mesh(own(new THREE.ExtrudeGeometry(c.starShape(0.15, 0.065), { depth: 0.03, bevelEnabled: false })), c.goldMat); m.geometry.center(); g.add(m); break; }
      case "bolt": {
        const sh = new THREE.Shape(); sh.moveTo(0.05, 0.15); sh.lineTo(-0.08, -0.01); sh.lineTo(-0.005, -0.01); sh.lineTo(-0.05, -0.15); sh.lineTo(0.08, 0.02); sh.lineTo(0.005, 0.02); sh.closePath();
        g.add(new THREE.Mesh(own(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false })), c.goldMat)); break;
      }
      case "diamond": { const m = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.12)), c.goldMat); m.scale.set(1, 1.3, 0.35); g.add(m); break; }
      case "ring": g.add(new THREE.Mesh(own(new THREE.TorusGeometry(0.1, 0.028, 12, 36)), c.goldMat)); break;
    }
    ghost.add(g);
  }

  // ── the weather around it ──
  if (look.aura !== "none") {
    const kind = look.aura;
    const N = kind === "rain" ? 16 : kind === "zzz" ? 3 : 12;
    const tex = own(c.canvasTexture(96, kind === "sparkles" ? sparkle : kind === "hearts" ? heart : kind === "coins" ? coin : kind === "rain" ? drop : zee));
    const mesh = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(kind === "rain" ? 0.14 : 0.28, kind === "rain" ? 0.2 : 0.28)), own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })), N);
    mesh.frustumCulled = false; c.scene.add(mesh);
    const d = new THREE.Object3D();
    if (kind === "rain") {
      const cloud = new THREE.Group();
      const cm = std("#9aa3b5", { roughness: 0.9 });
      for (const [x, y, r] of [[-0.3, 0, 0.3], [0, 0.1, 0.38], [0.32, 0, 0.3], [0.05, -0.05, 0.3]]) { const s = new THREE.Mesh(own(new THREE.SphereGeometry(r, 20, 16)), cm); s.position.set(x, y, 0); s.scale.set(1, 0.8, 0.8); cloud.add(s); }
      cloud.position.set(0, top + 0.62, 0.1); c.scene.add(cloud);
      anim.push((t) => { cloud.position.y = top + 0.62 + Math.sin(t * 1.4) * 0.03; });
    }
    anim.push((t) => {
      for (let i = 0; i < N; i++) {
        let x = 0, y = 0, z = 0.3, s = 1, rz = 0, ry = 0;
        if (kind === "sparkles") { const a = (i / N) * Math.PI * 2 + t * 0.3, R = 1.45 + 0.18 * Math.sin(i * 1.7); x = Math.cos(a) * R; z = Math.sin(a) * 0.7 + 0.4; y = 0.25 + 0.95 * Math.sin(i * 2.3) + 0.12 * Math.sin(t + i); s = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3 + i * 1.9)); rz = t * 0.8 + i; }
        else if (kind === "hearts") { const L = 3.2, k = ((t + (i * L) / N) % L) / L; x = (i % 2 ? 1 : -1) * (0.95 + 0.22 * Math.sin(i * 1.3)) + 0.1 * Math.sin(k * 6 + i); y = 0.1 + k * 2.4; z = 0.5; s = 0.15 + Math.sin(k * Math.PI) * 0.85; }
        else if (kind === "coins") { const k = (t * 0.32 + i / N) % 1; x = ((i % 7) - 3) * 0.42; y = 2.9 - k * 3.6; z = 0.25 + 0.5 * Math.sin(i * 1.9); ry = t * 3 + i; s = 0.9; }
        else if (kind === "rain") { const k = (t * 0.9 + i / N) % 1; x = ((i % 5) - 2) * 0.27 + 0.05 * Math.sin(i); y = top + 0.45 - k * 2.5; z = 0.2; s = 0.8; }
        else { const k = (t * 0.25 + i / N) % 1; x = 0.75 + k * 0.7 + 0.06 * Math.sin(t * 2 + i); y = 1.05 + k * 1.1; z = 0.4; s = 0.5 + k * 0.7; rz = 0.2; }
        d.position.set(x, y, z); d.rotation.set(0, ry, rz); d.scale.setScalar(Math.max(0.001, s)); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  const [l, r] = ARMS[look.arms];
  return { eyes, mouth, armBase: { l, r }, update(t) { for (const a of anim) a(t); } };
}
