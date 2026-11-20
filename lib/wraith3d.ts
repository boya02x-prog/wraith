// lib/wraith3d.ts  (browser only, loaded on demand)
// Wraith's own 3D character: a chubby orange ghost with glowing eyes, built from code (no model files, no network), lit like a vinyl toy.
// One builder feeds two things: the live canvas (components/Wraith3D.tsx: bobs, blinks, follows your finger, hops when tapped) and the
// still posters (public/mascot/*.png) used where a live canvas is not worth it (empty states, share-card backgrounds).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type Pose = "king" | "wave" | "sleep" | "oops";
export interface SceneOpts {
  pose: Pose;
  /** 3 = the winners' podium under the ghost, 0 = ghost alone */
  podium: 0 | 3;
  /** falling gold pieces */
  confetti: number;
  /** the light cone from above */
  spotlight: boolean;
  /** freezes the random parts (confetti, sparkle) so a still always looks the same */
  seed?: number;
  /** camera zoom, 1 = the whole podium scene */
  zoom?: number;
  /** slide the scene to the right by this many units */
  shiftX?: number;
}
export interface WraithScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(width: number, height: number): void;
  update(t: number, dt: number, pointer: { x: number; y: number }): void;
  /** a happy hop (tap) */
  poke(): void;
  dispose(): void;
}

const BODY_R = 1.02;
const TOP = new THREE.Color("#ff9a58");
const MID = new THREE.Color("#ff7a3a");
const BOT = new THREE.Color("#e4470e");
const GOLD = "#ffc83d";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const radialTexture = (stops: [number, string][]) => canvasTexture(128, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, c] of stops) r.addColorStop(o, c);
  g.fillStyle = r; g.fillRect(0, 0, s, s);
});

/** The ghost's body: dome, round belly, a hem of five soft lobes; the colour is painted per vertex, the dark hood face is cut in the shader (smooth edge, nothing sticks out). */
function bodyGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const cy = 0.28, a = BODY_R, b = 0.9;
  for (let i = 0; i <= 28; i++) { const th = (i / 28) * (Math.PI / 2); pts.push(new THREE.Vector2(a * Math.sin(th), cy + b * Math.cos(th))); }
  const yBot = -0.85;
  for (let i = 1; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(a * (1 - 0.03 * t + 0.02 * Math.sin(Math.PI * t)), cy + (yBot - cy) * t)); }
  const rEnd = pts[pts.length - 1].x, c = 0.22;
  for (let i = 1; i <= 10; i++) { const ph = (i / 10) * (Math.PI / 2); pts.push(new THREE.Vector2(rEnd - c + c * Math.cos(ph), yBot - c * Math.sin(ph))); }
  // (no bottom cap: the hem is never seen from below, and a cap that follows the scalloped lobes folded into a bright stray shard on the front)
  pts.reverse(); // bottom to top: the surface faces outward
  const g = new THREE.LatheGeometry(pts, 112);
  g.rotateY(Math.PI); // the seam goes to the back
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(x, z); // 0 = straight at the viewer
    const t = THREE.MathUtils.smoothstep(-y, 0.55, 1.07);
    const lobe = 0.5 + 0.5 * Math.cos(ang * 5);
    y -= t * t * 0.2 * lobe;
    const infl = 1 + t * 0.03 * lobe; x *= infl; z *= infl;
    pos.setXYZ(i, x, y, z);
    const u = THREE.MathUtils.clamp((y + 1.3) / 2.5, 0, 1);
    if (u > 0.5) col.copy(MID).lerp(TOP, (u - 0.5) * 2); else col.copy(BOT).lerp(MID, u * 2);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** y of the body's front surface at (x, y): where things stuck on the front (eyes, chain) sit. */
function surfaceZ(x: number, y: number): number {
  const r = y > 0.28 ? BODY_R * Math.sqrt(Math.max(0, 1 - ((y - 0.28) / 0.9) ** 2)) : BODY_R * (1 - 0.03 * Math.min(1, (0.28 - y) / 1.13));
  return Math.sqrt(Math.max(0.0001, r * r - x * x));
}

function numeral(n: number, color: string) {
  return canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = color; g.font = `800 ${s * 0.7}px "Plus Jakarta Sans", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 8; g.fillText(String(n), s / 2, s / 2 + 8);
  });
}

function coinTexture() {
  return canvasTexture(256, (g, s) => {
    const r = g.createRadialGradient(s * 0.4, s * 0.35, 8, s / 2, s / 2, s / 2);
    r.addColorStop(0, "#fff0b0"); r.addColorStop(0.5, "#ffc83d"); r.addColorStop(1, "#d98a14");
    g.fillStyle = r; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(120,70,0,.55)"; g.lineWidth = 10; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#7a4300"; g.font = `800 ${s * 0.46}px "Plus Jakarta Sans", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("W", s / 2, s / 2 + 8);
  });
}

export function createWraithScene(renderer: THREE.WebGLRenderer, opts: SceneOpts): WraithScene {
  const R = rng(opts.seed ?? 7);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 60);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => { disposables.push(o); return o; };

  // light: warm key from the front left, orange rim from behind, a cool fill, plus a soft room for the gold to reflect
  scene.add(new THREE.HemisphereLight(0xffe6cf, 0x1d1030, 0.5));
  const key = new THREE.DirectionalLight(0xfff0e2, 1.9); key.position.set(3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff6a2a, 2.6); rim.position.set(-4, 3, -3); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x86a6ff, 0.55); fill.position.set(-4, 1, 4); scene.add(fill);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex; scene.environmentIntensity = 0.42;
  own(envTex);

  const bodyMat = own(new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.6, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color("#ffb88a"),
    emissive: new THREE.Color("#ff4a0a"), emissiveIntensity: 0.06,
  }));
  // the hood opening: a smooth dark oval on the front, decided per pixel from where the pixel sits on the body
  bodyMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float fd = length(vec2(vObjPos.x / 0.66, (vObjPos.y - 0.5) / 0.47));
        float fm = (1.0 - smoothstep(0.88, 1.0, fd)) * smoothstep(0.0, 0.25, vObjPos.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.014, 0.009), fm * 0.99);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, fm);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (1.0 - fm);")
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
        material.clearcoat *= (1.0 - fm * 0.9);
        #ifdef USE_SHEEN
          material.sheenColor *= (1.0 - fm);
        #endif`);
  };
  const armMat = own(new THREE.MeshPhysicalMaterial({ color: "#ff7a3e", roughness: 0.44, clearcoat: 0.45, clearcoatRoughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color("#ffb88a") }));
  // the soft room is only for the gold to reflect: on the orange body its bright panels showed up as hard yellow patches, so the body takes much less of it
  bodyMat.envMap = armMat.envMap = envTex;
  bodyMat.envMapIntensity = armMat.envMapIntensity = 0.2;
  const goldMat = own(new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.24 }));
  const glow = own(new THREE.MeshBasicMaterial({ color: "#fff1dc" }));

  // everything about the ghost lives in one group so it can bob and turn as one
  const ghost = new THREE.Group();
  const body = new THREE.Mesh(own(bodyGeometry()), bodyMat);
  ghost.add(body);

  // eyes: glowing cream ovals with a bright spark each, a soft halo behind
  const haloTex = own(radialTexture([[0, "rgba(255,190,120,.4)"], [1, "rgba(255,150,80,0)"]]));
  const eyes: THREE.Group[] = [];
  const closed = opts.pose === "sleep";
  const wide = opts.pose === "oops";
  for (const sx of [-1, 1]) {
    const x = sx * 0.27, y = 0.56, z = surfaceZ(x, y) + 0.012;
    const e = new THREE.Group();
    e.position.set(x, y, z); e.rotation.y = Math.atan2(x, z);
    if (closed) {
      const arc = new THREE.Mesh(own(new THREE.TorusGeometry(0.115, 0.024, 10, 28, Math.PI)), glow);
      arc.rotation.z = Math.PI; arc.position.y = 0.04; e.add(arc);
    } else {
      const eye = new THREE.Mesh(own(new THREE.SphereGeometry(1, 32, 24)), glow);
      eye.scale.set(wide ? 0.17 : 0.13, wide ? 0.22 : 0.19, 0.04); e.add(eye);
      const spark = new THREE.Mesh(own(new THREE.SphereGeometry(0.04, 12, 12)), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
      spark.position.set(-0.035, 0.07, 0.05); e.add(spark);
      const pupil = new THREE.Mesh(own(new THREE.SphereGeometry(wide ? 0.06 : 0.0, 12, 12)), own(new THREE.MeshBasicMaterial({ color: "#2a120a" })));
      pupil.position.set(0, -0.02, 0.045); if (wide) e.add(pupil);
    }
    const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(0.44, 0.44)), own(new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    halo.position.z = -0.01; e.add(halo);
    ghost.add(e); eyes.push(e);
  }
  // mouth
  {
    const y = 0.27, z = surfaceZ(0, y) + 0.012;
    const m = new THREE.Group(); m.position.set(0, y, z);
    if (opts.pose === "oops") {
      const o = new THREE.Mesh(own(new THREE.TorusGeometry(0.07, 0.02, 10, 28)), glow); m.add(o);
    } else if (opts.pose === "sleep") {
      const l = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.014, 0.1, 6, 12)), glow); l.rotation.z = Math.PI / 2; m.add(l);
    } else {
      const s = new THREE.Mesh(own(new THREE.TorusGeometry(0.12, 0.022, 10, 32, Math.PI)), glow); s.rotation.z = Math.PI; s.position.y = 0.06; m.add(s);
    }
    ghost.add(m);
  }

  // arms: stubby mittens. The right one is up (holding a coin in "king", waving in "wave")
  const armL = new THREE.Group(), armR = new THREE.Group();
  const arm = (g: THREE.Group, sx: number) => {
    const limb = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.18, 0.3, 8, 20)), armMat);
    limb.position.y = -0.2; g.add(limb);
    const hand = new THREE.Mesh(own(new THREE.SphereGeometry(0.21, 24, 18)), armMat);
    hand.position.y = -0.52; g.add(hand);
    g.position.set(sx * 0.98, 0.1, 0.12);
    ghost.add(g);
  };
  arm(armL, -1); arm(armR, 1);
  const upRight = opts.pose === "king" || opts.pose === "wave" || opts.pose === "oops";
  armL.rotation.z = opts.pose === "oops" ? -2.5 : 0.5; // hangs a little out
  armR.rotation.z = upRight ? (opts.pose === "oops" ? 2.5 : 2.3) : -0.5;
  const raised = upRight;
  if (opts.pose === "king") {
    const coin = new THREE.Mesh(own(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 48)), [goldMat, own(new THREE.MeshStandardMaterial({ map: own(coinTexture()), metalness: 0.8, roughness: 0.3 })), goldMat]);
    coin.rotation.x = Math.PI / 2; coin.position.set(0.0, -0.78, 0.0);
    const hold = new THREE.Group(); hold.add(coin); hold.rotation.y = 0.3; armR.add(hold);
  }

  // crown (king only): band, five points with pearls, a ruby in front
  if (opts.pose === "king" || opts.pose === "sleep") {
    const crown = new THREE.Group();
    const band = new THREE.Mesh(own(new THREE.CylinderGeometry(0.46, 0.42, 0.26, 48, 1, true)), goldMat);
    (band.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    crown.add(band);
    for (const y of [0.13, -0.13]) { const rimT = new THREE.Mesh(own(new THREE.TorusGeometry(y > 0 ? 0.46 : 0.42, 0.03, 12, 64)), goldMat); rimT.rotation.x = Math.PI / 2; rimT.position.y = y; crown.add(rimT); }
    const pearl = own(new THREE.MeshPhysicalMaterial({ color: "#fff6e6", roughness: 0.2, clearcoat: 1, sheen: 1 }));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(own(new THREE.ConeGeometry(0.1, 0.36, 24)), goldMat);
      spike.position.set(Math.sin(a) * 0.45, 0.3, Math.cos(a) * 0.45); crown.add(spike);
      const p = new THREE.Mesh(own(new THREE.SphereGeometry(0.055, 16, 16)), pearl);
      p.position.set(Math.sin(a) * 0.45, 0.5, Math.cos(a) * 0.45); crown.add(p);
    }
    const ruby = new THREE.Mesh(own(new THREE.OctahedronGeometry(0.075)), own(new THREE.MeshPhysicalMaterial({ color: "#ff3355", emissive: "#ff1a40", emissiveIntensity: 0.6, roughness: 0.15, clearcoat: 1 })));
    ruby.position.set(0, 0, 0.45); ruby.scale.set(1, 1.3, 0.8); crown.add(ruby);
    crown.position.set(0.04, 1.1, 0.06); crown.rotation.set(0.14, 0, opts.pose === "sleep" ? -0.35 : -0.1); crown.scale.setScalar(1.22);
    ghost.add(crown);
  }

  // chain with a coin, lying on the front of the body (king)
  if (opts.pose === "king") {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 28; i++) {
      const u = (i / 28) * 2 - 1; // -1..1
      const x = u * 0.72, y = -0.2 + 0.4 * u * u;
      pts.push(new THREE.Vector3(x, y, surfaceZ(x, y) + 0.03));
    }
    const chain = new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.02, 8, false)), goldMat);
    ghost.add(chain);
    const pend = new THREE.Mesh(own(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 40)), [goldMat, own(new THREE.MeshStandardMaterial({ map: own(coinTexture()), metalness: 0.8, roughness: 0.3 })), goldMat]);
    pend.rotation.x = Math.PI / 2; pend.position.set(0, -0.28, surfaceZ(0, -0.28) + 0.06); ghost.add(pend);
  }

  ghost.position.y = opts.podium ? 1.27 : 0;
  scene.add(ghost);

  // podium (1st in the middle, 2nd left, 3rd right) with a gold ring on top of the winner
  const podium = new THREE.Group();
  if (opts.podium) {
    const stone = own(new THREE.MeshPhysicalMaterial({ color: "#17171d", roughness: 0.32, metalness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.25 }));
    const steps: [number, number, number, string][] = [[0, 0, 1.0, "#ffc83d"], [-1.95, -0.38, 2, "#cfd6e4"], [1.95, -0.7, 3, "#d8955a"]];
    for (const [x, top, n, color] of steps) {
      const h = 1.2;
      const box = new THREE.Mesh(own(new RoundedBoxGeometry(1.7, h, 1.7, 6, 0.1)), stone);
      box.position.set(x, top - h / 2, 0); podium.add(box);
      const tag = new THREE.Mesh(own(new THREE.PlaneGeometry(0.7, 0.7)), own(new THREE.MeshBasicMaterial({ map: own(numeral(Math.round(n), color)), transparent: true })));
      tag.position.set(x, top - 0.42, 0.861); podium.add(tag);
      const ringTop = new THREE.Mesh(own(new THREE.TorusGeometry(0.82, 0.018, 10, 80)), own(new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.3 })));
      ringTop.rotation.x = Math.PI / 2; ringTop.position.set(x, top + 0.004, 0); podium.add(ringTop);
    }
    // light pool and contact shadow on the winner's step
    const pool = new THREE.Mesh(own(new THREE.CircleGeometry(1.5, 48)), own(new THREE.MeshBasicMaterial({ map: own(radialTexture([[0, "rgba(255,200,130,.5)"], [1, "rgba(255,200,130,0)"]])), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.01, 0); podium.add(pool);
    const shadow = new THREE.Mesh(own(new THREE.CircleGeometry(0.95, 40)), own(new THREE.MeshBasicMaterial({ map: own(radialTexture([[0, "rgba(0,0,0,.65)"], [1, "rgba(0,0,0,0)"]])), transparent: true, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.015, 0); podium.add(shadow);
    scene.add(podium);
  }

  // spotlight cone, brightest at the source, soft at the edges
  let beam: THREE.Mesh | null = null;
  if (opts.spotlight) {
    const mat = own(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color("#ffe3bd") }, uOpacity: { value: 0.42 } },
      vertexShader: "varying vec3 vN; varying vec3 vV; varying float vH; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }",
      fragmentShader: "uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying float vH; void main(){ float f = abs(dot(normalize(vN), normalize(vV))); float edge = smoothstep(0.0, 0.7, f); float along = pow(vH, 1.3); gl_FragColor = vec4(uColor, uOpacity * edge * along); }",
    }));
    beam = new THREE.Mesh(own(new THREE.ConeGeometry(2.6, 8.4, 64, 1, true)), mat);
    beam.position.set(0, 3.9, -0.3);
    scene.add(beam);
  }

  // confetti
  const flakes = opts.confetti;
  let confetti: THREE.InstancedMesh | null = null;
  const fl: { x: number; y: number; z: number; v: number; r: number; s: number }[] = [];
  if (flakes > 0) {
    confetti = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(0.09, 0.15)), own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), flakes);
    const palette = ["#ffc83d", "#ffd96b", "#ff8447", "#fff1dc", "#ff5a7a"].map((c) => new THREE.Color(c));
    for (let i = 0; i < flakes; i++) {
      fl.push({ x: (R() - 0.5) * 6.5, y: R() * 6 - 1.5, z: (R() - 0.5) * 3 + 0.3, v: 0.25 + R() * 0.45, r: R() * Math.PI * 2, s: 0.6 + R() * 0.8 });
      confetti.setColorAt(i, palette[Math.floor(R() * palette.length)]);
    }
    scene.add(confetti);
  }
  const dummy = new THREE.Object3D();
  const placeFlakes = (t: number) => {
    if (!confetti) return;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      const y = ((f.y - t * f.v + 1.5) % 6 + 6) % 6 - 1.5;
      dummy.position.set(f.x + Math.sin(t * 0.8 + i) * 0.12, y, f.z);
      dummy.rotation.set(t * f.s + f.r, t * f.s * 0.7, f.r);
      dummy.updateMatrix();
      confetti.setMatrixAt(i, dummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
  };
  placeFlakes(0.7);

  // animation state
  let hop = 0, hopV = 0, spin = 0, blinkAt = 2.2, blinkT = -1;
  const base = ghost.position.y;
  const cur = { x: 0, y: 0 };
  const crowned = opts.pose === "king" || opts.pose === "sleep";
  const zoom = opts.zoom ?? 1; // >1 moves the camera in (the hero banner is wide and short, so it wants the ghost bigger)
  const lookAtY = opts.podium ? 1.0 + (zoom - 1) : crowned ? 0.5 : -0.02;
  const sx = -(opts.shiftX ?? 0); // the camera slides left, so the ghost appears to the right (leaves room for a title on the left)
  const frame = () => {
    camera.position.set(sx, opts.podium ? 1.5 + (zoom - 1) * 0.6 : lookAtY + 0.3, (opts.podium ? 8.6 : crowned ? 7.9 : 6.0) / zoom);
    camera.lookAt(sx, lookAtY, 0);
  };
  frame();

  return {
    scene, camera,
    resize(w, h) { camera.aspect = Math.max(0.2, w / Math.max(1, h)); camera.fov = camera.aspect < 1 ? 32 / Math.min(1, camera.aspect * 0.9 + 0.1) : 32; camera.updateProjectionMatrix(); },
    update(t, dt, pointer) {
      cur.x += (pointer.x - cur.x) * Math.min(1, dt * 5); cur.y += (pointer.y - cur.y) * Math.min(1, dt * 5);
      // hop on tap: a little spring
      hopV -= 28 * dt; hop += hopV * dt; if (hop < 0) { hop = 0; hopV = 0; }
      spin *= Math.pow(0.02, dt);
      ghost.position.y = base + Math.sin(t * 1.8) * 0.05 + hop;
      ghost.rotation.y = cur.x * 0.5 + Math.sin(t * 0.6) * 0.1 + spin;
      ghost.rotation.x = -cur.y * 0.14;
      ghost.rotation.z = Math.sin(t * 1.2) * 0.02;
      const squash = 1 + Math.sin(t * 1.8 + 1.2) * 0.012; ghost.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      if (opts.pose === "wave") armR.rotation.z = 2.3 + Math.sin(t * 6) * 0.25;
      else if (raised) armR.rotation.z = (opts.pose === "oops" ? 2.5 : 2.3) + Math.sin(t * 2.2) * 0.05;
      armL.rotation.z = (opts.pose === "oops" ? -2.5 : 0.5) + Math.sin(t * 2 + 1) * 0.04;
      // blink
      if (!closed && t > blinkAt && blinkT < 0) blinkT = t;
      if (blinkT >= 0) { const k = (t - blinkT) / 0.14; const s = k < 1 ? 1 - Math.sin(k * Math.PI) * 0.92 : 1; for (const e of eyes) e.scale.y = Math.max(0.08, s); if (k >= 1) { blinkT = -1; blinkAt = t + 2.4 + Math.random() * 2.4; } }
      if (beam) (beam.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.4 + Math.sin(t * 0.9) * 0.03;
      placeFlakes(t);
    },
    poke() { hopV = 7.5; spin += 0.9; },
    dispose() {
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose()); });
      for (const d of disposables) { try { d.dispose(); } catch { /* already gone */ } }
    },
  };
}
