// lib/wraith3d.ts  (browser only, loaded on demand)
// Wraith's own 3D character: a round orange ghost with a dark hood face and glowing eyes, built from code (no model files, no network), lit like a vinyl toy.
// One builder feeds two things: the live canvas (components/Wraith3D.tsx: bobs, blinks, follows your finger, hops when tapped) and the
// still posters (public/mascot/*.webp) used where a live canvas is not worth it (empty states, ranking header, the corner of share cards).
// Ghosts do not stand: it floats a hand's width above a hexagon podium (the hexagon is the radar shape from the ranking cards), with a glow and a shadow under it.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PetLook } from "@/lib/wraithPet";
import { buildPet, type PetParts } from "@/lib/wraithPet3d";

export type Pose = "king" | "wave" | "sleep" | "oops";
export interface SceneOpts {
  pose: Pose;
  /** 3 = the winners' podium under the ghost, 0 = ghost alone */
  podium: 0 | 3;
  /** falling gold pieces */
  confetti: number;
  /** the light cone from above */
  spotlight: boolean;
  /** freezes the random parts (confetti) so a still always looks the same */
  seed?: number;
  /** camera zoom, 1 = the whole podium scene */
  zoom?: number;
  /** slide the scene to the right by this many units */
  shiftX?: number;
  /** turns the ghost's orange to another colour: a fraction of the colour wheel (0 = orange, 0.55 = blue, 0.3 = green ...) */
  hue?: number;
  /** turns the ghost this many radians toward the viewer's left (negative) or right (positive): the default covers use it so the ghost looks at the profile photo beside it */
  yaw?: number;
  /** moves the camera up (the ghost sits lower in the picture) or down, in scene units */
  lift?: number;
  /** a person's own pet (lib/wraithPet.ts): its colour, body, face, hat and the weather around it replace the standard face; leave the pose as "wave" */
  pet?: PetLook;
}
export interface WraithScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(width: number, height: number): void;
  update(t: number, dt: number, pointer: { x: number; y: number }): void;
  /** a happy hop (tap) */
  poke(): void;
  /** freeze an emote at a point of its timeline (0..1) at time t: used to draw stills of the ghost mid-action */
  forceEmote(i: number, k: number, t: number): void;
  dispose(): void;
}

// body shape: a round dome on a belly that narrows a little to a scalloped hem. Rounder than tall, like a toy, with the face big on it.
const BODY_R = 1.04, CY = 0.2, DOME_B = 0.8, Y_BOT = -0.72, CORNER = 0.2;
const FACE_Y = 0.36;
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

/** The body: dome, round belly, a hem of five soft lobes. Colour is painted per vertex; the dark hood face is cut in the shader (smooth edge, nothing sticks out). */
function bodyGeometry(lobes = 5): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const a = BODY_R;
  for (let i = 0; i <= 28; i++) { const th = (i / 28) * (Math.PI / 2); pts.push(new THREE.Vector2(a * Math.sin(th), CY + DOME_B * Math.cos(th))); }
  for (let i = 1; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(a * (1 - 0.03 * t + 0.025 * Math.sin(Math.PI * t)), CY + (Y_BOT - CY) * t)); }
  const rEnd = pts[pts.length - 1].x;
  for (let i = 1; i <= 10; i++) { const ph = (i / 10) * (Math.PI / 2); pts.push(new THREE.Vector2(rEnd - CORNER + CORNER * Math.cos(ph), Y_BOT - CORNER * Math.sin(ph))); }
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
    const t = THREE.MathUtils.smoothstep(-y, 0.45, 0.92);
    const lobe = 0.5 + 0.5 * Math.cos(ang * lobes);
    y -= t * t * 0.17 * lobe;
    const infl = 1 + t * 0.03 * lobe; x *= infl; z *= infl;
    pos.setXYZ(i, x, y, z);
    const u = THREE.MathUtils.clamp((y + 1.1) / 2.2, 0, 1);
    if (u > 0.5) col.copy(MID).lerp(TOP, (u - 0.5) * 2); else col.copy(BOT).lerp(MID, u * 2);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** z of the body's front surface at (x, y): where things stuck on the front (eyes, chain) sit. */
function surfaceZ(x: number, y: number): number {
  const k = Math.min(1, Math.max(0, (CY - y) / (CY - Y_BOT)));
  const r = y > CY ? BODY_R * Math.sqrt(Math.max(0, 1 - ((y - CY) / DOME_B) ** 2)) : BODY_R * (1 - 0.03 * k + 0.025 * Math.sin(Math.PI * k));
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
    g.fillStyle = "#7a4300"; g.font = `800 ${s * 0.46}px "Plus Jakarta Sans", system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("O", s / 2, s / 2 + 8);
  });
}

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
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
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: 128 }).texture;
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
        float fd = length(vec2(vObjPos.x / 0.7, (vObjPos.y - ${FACE_Y.toFixed(3)}) / 0.5));
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
  // (no sheen on the arms: where the hand meets the arm it lit a pale ring that read like a bracelet)
  const armMat = own(new THREE.MeshStandardMaterial({ color: "#ff7a3e", roughness: 0.5, metalness: 0 }));
  // the soft room is only for the gold to reflect: on the orange body its bright panels showed up as hard yellow patches, and across the arms as pale rings,
  // so the body takes much less of it and the arms none
  bodyMat.envMap = envTex; bodyMat.envMapIntensity = 0.2;
  armMat.envMap = envTex; armMat.envMapIntensity = 0.0;
  // another colour of ghost (the default covers use a few): rotate the hue of everything that is orange; the gold, the eyes and the face stay
  // (a pet also has its own paleness / darkness: a sad one loses its colour)
  const hue = opts.pet ? opts.pet.hue : opts.hue ?? 0;
  const sat = opts.pet?.sat ?? 1, lum = opts.pet?.lum ?? 1;
  const shift = <C extends THREE.Color>(c: C): C => {
    if (!hue && sat === 1 && lum === 1) return c;
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL((((hsl.h + hue) % 1) + 1) % 1, Math.min(1, hsl.s * sat), Math.min(1, hsl.l * lum));
    return c;
  };
  shift(armMat.color); shift(bodyMat.emissive); shift(bodyMat.sheenColor); shift(rim.color);
  const goldMat = own(new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.24 }));
  const glow = own(new THREE.MeshBasicMaterial({ color: "#fff1dc" }));
  const coinFace = own(new THREE.MeshStandardMaterial({ map: own(coinTexture()), metalness: 0.8, roughness: 0.3 }));

  // everything about the ghost lives in one group so it can bob and turn as one
  const ghost = new THREE.Group();
  const bodyGeo = own(bodyGeometry(opts.pet?.lobes ?? 5));
  if (hue || sat !== 1 || lum !== 1) {
    const a = bodyGeo.getAttribute("color") as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < a.count; i++) { c.setRGB(a.getX(i), a.getY(i), a.getZ(i)); shift(c); a.setXYZ(i, c.r, c.g, c.b); }
    a.needsUpdate = true;
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  ghost.add(body);

  // eyes: glowing cream ovals with a bright spark each, a soft halo behind
  const haloTex = own(radialTexture([[0, "rgba(255,190,120,.4)"], [1, "rgba(255,150,80,0)"]]));
  const eyes: THREE.Group[] = [];
  const closed = opts.pose === "sleep";
  const wide = opts.pose === "oops";
  for (const sx of opts.pet ? [] : [-1, 1]) { // (a pet draws its own face below, once its arms exist)
    const x = sx * 0.29, y = FACE_Y + 0.1, z = surfaceZ(x, y) + 0.012;
    const e = new THREE.Group();
    e.position.set(x, y, z); e.rotation.y = Math.atan2(x, z);
    if (closed) {
      const arc = new THREE.Mesh(own(new THREE.TorusGeometry(0.12, 0.025, 10, 28, Math.PI)), glow);
      arc.rotation.z = Math.PI; arc.position.y = 0.04; e.add(arc);
    } else {
      const eye = new THREE.Mesh(own(new THREE.SphereGeometry(1, 32, 24)), glow);
      eye.scale.set(wide ? 0.18 : 0.14, wide ? 0.23 : 0.2, 0.04); e.add(eye);
      const spark = new THREE.Mesh(own(new THREE.SphereGeometry(0.04, 12, 12)), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
      spark.position.set(-0.035, 0.07, 0.05); e.add(spark);
      if (wide) {
        const pupil = new THREE.Mesh(own(new THREE.SphereGeometry(0.06, 12, 12)), own(new THREE.MeshBasicMaterial({ color: "#2a120a" })));
        pupil.position.set(0, -0.02, 0.045); e.add(pupil);
      }
    }
    const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(0.46, 0.46)), own(new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    halo.position.z = -0.01; e.add(halo);
    ghost.add(e); eyes.push(e);
  }
  // mouth
  let mouthG: THREE.Group | null = null; // the emotes make the smile bigger
  if (!opts.pet) {
    const y = FACE_Y - 0.17, z = surfaceZ(0, y) + 0.012;
    const m = new THREE.Group(); m.position.set(0, y, z); mouthG = m;
    if (opts.pose === "oops") {
      m.add(new THREE.Mesh(own(new THREE.TorusGeometry(0.075, 0.021, 10, 28)), glow));
    } else if (opts.pose === "sleep") {
      const l = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.015, 0.1, 6, 12)), glow); l.rotation.z = Math.PI / 2; m.add(l);
    } else {
      const s = new THREE.Mesh(own(new THREE.TorusGeometry(0.13, 0.023, 10, 32, Math.PI)), glow); s.rotation.z = Math.PI; s.position.y = 0.07; m.add(s);
    }
    ghost.add(m);
  }

  // arms: round mittens on short arms, the same size on both sides. Rotation z is measured from "hanging straight down"; for the left arm
  // (x < 0) a NEGATIVE angle swings it out to the left, for the right arm a POSITIVE one swings it out to the right. (Both used to swing inward
  // and hid behind the body, which is why one arm looked like a tiny stub.)
  const armL = new THREE.Group(), armR = new THREE.Group();
  const buildArm = (g: THREE.Group, sx: number) => {
    // one rounded capsule per arm (a separate, wider hand ball left a lit ring around the wrist that read like a bracelet)
    const limb = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.2, 0.36, 10, 24)), armMat);
    limb.position.y = -0.24; g.add(limb);
    g.position.set(sx * 0.96, 0.0, 0.1);
    ghost.add(g);
  };
  buildArm(armL, -1); buildArm(armR, 1);
  const bothUp = opts.pose === "king" || opts.pose === "oops";
  const rightUp = bothUp || opts.pose === "wave";
  const UP = opts.pose === "oops" ? 2.5 : 2.2, DOWN = 0.5;
  let leftBase = bothUp ? -UP : -DOWN, rightBase = rightUp ? UP : DOWN;
  // a pet: its own face, hat, what it holds and the weather around it, and its arms follow its mood (lib/wraithPet3d.ts)
  let petParts: PetParts | null = null;
  if (opts.pet) {
    try {
      petParts = buildPet({ scene, ghost, armR, own, glow, goldMat, coinFace, haloTex, surfaceZ, FACE_Y, CY, DOME_B, canvasTexture, radialTexture, starShape }, opts.pet);
      eyes.push(...petParts.eyes);
      mouthG = petParts.mouth;
      leftBase = petParts.armBase.l; rightBase = petParts.armBase.r;
    } catch (err) { console.warn("[wraith pet] could not build the pet", err); }
  }
  armL.rotation.z = leftBase; armR.rotation.z = rightBase;
  const energy = opts.pet?.energy ?? 1, droop = opts.pet?.droop ?? 0;
  const bx = opts.pet ? opts.pet.bodyX * opts.pet.size : 1, by = opts.pet ? opts.pet.bodyY * opts.pet.size : 1;
  if (opts.pose === "king") {
    // a gold O (OMEN) coin in the right hand, a gold star in the left: the winner's pose, the same on both sides
    const coin = new THREE.Mesh(own(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 48)), [goldMat, coinFace, goldMat]);
    coin.rotation.x = Math.PI / 2; coin.position.set(0, -0.68, 0);
    const holdR = new THREE.Group(); holdR.add(coin); holdR.rotation.y = 0.25; armR.add(holdR);
    const star = new THREE.Mesh(own(new THREE.ExtrudeGeometry(starShape(0.27, 0.12), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3 })), goldMat);
    star.position.set(0, -0.7, -0.03); star.rotation.z = Math.PI;
    const holdL = new THREE.Group(); holdL.add(star); holdL.rotation.y = -0.25; armL.add(holdL);
  }

  // crown (king, and the sleeper's slipping one): band, five points with pearls, a ruby in front
  if (opts.pose === "king" || opts.pose === "sleep") {
    const crown = new THREE.Group();
    const bandMat = own(new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.24, side: THREE.DoubleSide }));
    crown.add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.46, 0.42, 0.26, 48, 1, true)), bandMat));
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
    crown.position.set(0.03, CY + DOME_B - 0.06, 0.05); crown.rotation.set(0.14, 0, opts.pose === "sleep" ? -0.35 : -0.08); crown.scale.setScalar(1.18);
    ghost.add(crown);
  }

  // necklace with the coin (king): a chain that goes ALL the way round the body just under the face and hangs lowest at the front, where the coin
  // is. It used to be a short arc laid on the front that stopped at the edges of the face, so it looked stuck on; now it wraps round the sides and
  // disappears behind, like something worn. Its height follows the body, so it sits on the surface all the way round.
  if (opts.pose === "king") {
    const yNeck = -0.02, sag = 0.26, N = 96;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2 - Math.PI; // -PI..PI, 0 = the front
      const front = Math.max(0, Math.cos(th));
      const y = yNeck - sag * front * front; // flat round the sides and the back, dipping toward the front
      const R = surfaceZ(0, y) + 0.03; // the body's radius at that height, plus half the chain
      pts.push(new THREE.Vector3(Math.sin(th) * R, y, Math.cos(th) * R));
    }
    ghost.add(new THREE.Mesh(own(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 220, 0.024, 8, true)), goldMat));
    const yp = yNeck - sag - 0.11; // the coin hangs from the lowest point of the chain
    const pend = new THREE.Mesh(own(new THREE.CylinderGeometry(0.15, 0.15, 0.045, 40)), [goldMat, coinFace, goldMat]);
    pend.rotation.x = Math.PI / 2; pend.position.set(0, yp, surfaceZ(0, yp) + 0.065); ghost.add(pend);
  }

  const HOVER = 1.4; // body-origin height above the podium top: the lowest hem lobe floats about a hand's width above it
  ghost.position.y = opts.podium ? HOVER : 0;
  scene.add(ghost);

  // podium: three hexagon steps (1st in the middle, 2nd left, 3rd right), glossy graphite, a metal ring on top and an orange light line at the foot
  const podium = new THREE.Group();
  if (opts.podium) {
    const stone = own(new THREE.MeshPhysicalMaterial({ color: "#14141a", roughness: 0.3, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
    const topMat = own(new THREE.MeshPhysicalMaterial({ color: "#1d1d25", roughness: 0.35, metalness: 0.4, clearcoat: 0.6 }));
    const ember = own(new THREE.MeshBasicMaterial({ color: "#ff7b3d" }));
    const steps: [number, number, number, string][] = [[0, 0, 1, "#ffc83d"], [-2.1, -0.5, 2, "#cfd6e4"], [2.1, -0.85, 3, "#d8955a"]];
    for (const [x, top, n, color] of steps) {
      const h = 1.5;
      const hex = new THREE.Mesh(own(new THREE.CylinderGeometry(0.98, 1.06, h, 6, 1)), stone);
      hex.rotation.y = Math.PI / 6; hex.position.set(x, top - h / 2, 0); podium.add(hex);
      const plate = new THREE.Mesh(own(new THREE.CylinderGeometry(0.88, 0.88, 0.03, 6)), topMat);
      plate.rotation.y = Math.PI / 6; plate.position.set(x, top + 0.012, 0); podium.add(plate);
      const ring = new THREE.Mesh(own(new THREE.TorusGeometry(0.88, 0.024, 8, 6)), own(new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.28 })));
      ring.rotation.set(Math.PI / 2, 0, 0); ring.position.set(x, top + 0.03, 0); podium.add(ring);
      const foot = new THREE.Mesh(own(new THREE.TorusGeometry(1.08, 0.022, 8, 6)), ember);
      foot.rotation.set(Math.PI / 2, 0, 0); foot.position.set(x, top - h + 0.03, 0); podium.add(foot);
      const tag = new THREE.Mesh(own(new THREE.PlaneGeometry(0.62, 0.62)), own(new THREE.MeshBasicMaterial({ map: own(numeral(n, color)), transparent: true })));
      tag.position.set(x, top - 0.52, 0.93); podium.add(tag);
    }
    // an orange light pool on the winner's step and the ghost's soft shadow on it
    const pool = new THREE.Mesh(own(new THREE.CircleGeometry(1.7, 48)), own(new THREE.MeshBasicMaterial({ map: own(radialTexture([[0, "rgba(255,150,80,.55)"], [1, "rgba(255,150,80,0)"]])), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.045, 0); podium.add(pool);
    const shadow = new THREE.Mesh(own(new THREE.CircleGeometry(0.85, 40)), own(new THREE.MeshBasicMaterial({ map: own(radialTexture([[0, "rgba(0,0,0,.55)"], [1, "rgba(0,0,0,0)"]])), transparent: true, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.05, 0); podium.add(shadow);
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
    if (hue) shift(mat.uniforms.uColor.value as THREE.Color);
    beam = new THREE.Mesh(own(new THREE.ConeGeometry(2.6, 8.4, 64, 1, true)), mat);
    beam.position.set(0, 3.9, -0.3);
    scene.add(beam);
  }

  // confetti
  const flakes = opts.confetti;
  let confetti: THREE.InstancedMesh | null = null;
  const fl: { x: number; y: number; z: number; v: number; r: number; s: number }[] = [];
  // on a wide banner the confetti spreads over the whole width (and gets denser, up to twice as many flakes), not just the middle
  const flakeMax = Math.ceil(flakes * 2);
  let xScale = 1;
  if (flakes > 0) {
    confetti = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(0.09, 0.15)), own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), flakeMax);
    confetti.count = flakes;
    const palette = ["#ffc83d", "#ffd96b", "#ff8447", "#fff1dc", "#ff5a7a"].map((c) => new THREE.Color(c));
    for (let i = 0; i < flakeMax; i++) {
      fl.push({ x: (R() - 0.5) * 6.5, y: R() * 6 - 1.5, z: (R() - 0.5) * 3 + 0.3, v: 0.25 + R() * 0.45, r: R() * Math.PI * 2, s: 0.6 + R() * 0.8 });
      confetti.setColorAt(i, palette[Math.floor(R() * palette.length)]);
    }
    scene.add(confetti);
  }
  const dummy = new THREE.Object3D();
  const placeFlakes = (t: number) => {
    if (!confetti) return;
    for (let i = 0; i < confetti.count; i++) {
      const f = fl[i];
      const y = ((f.y - t * f.v + 1.5) % 6 + 6) % 6 - 1.5;
      dummy.position.set(f.x * xScale + Math.sin(t * 0.8 + i) * 0.12, y, f.z);
      dummy.rotation.set(t * f.s + f.r, t * f.s * 0.7, f.r);
      dummy.updateMatrix();
      confetti.setMatrixAt(i, dummy.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
  };
  placeFlakes(0.7);

  // animation state
  let blinkAt = 2.2, blinkT = -1;
  const base = ghost.position.y;
  const cur = { x: 0, y: 0 };

  // ── emotes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A tap plays one short, fixed emote (hop, wave, spin, dance, cheer) and the next tap plays the next one. Every emote is a timeline that
  // starts and ends at rest, so nothing can build up: a tap while one is playing queues at most ONE more. (The old tap added hop speed every
  // time, so a few quick taps threw the ghost off the top of the screen.) Each emote returns offsets that are added on top of the idle bob.
  type Off = { y: number; ry: number; rz: number; rx: number; sq: number; aL: number; aR: number; eL: number; eR: number; mouth: number };
  const off: Off = { y: 0, ry: 0, rz: 0, rx: 0, sq: 1, aL: 0, aR: 0, eL: 1, eR: 1, mouth: 1 };
  const clear01 = (x: number) => Math.min(1, Math.max(0, x));
  const smooth = (x: number) => { const u = clear01(x); return u * u * (3 - 2 * u); };
  const outCubic = (x: number) => 1 - Math.pow(1 - clear01(x), 3);
  const bump = (k: number, a: number, b: number) => (k <= a || k >= b ? 0 : Math.sin(((k - a) / (b - a)) * Math.PI)); // 0 -> 1 -> 0 between a and b
  // crouch, push off, float, land: the base of the hop and the cheer (h = how high, arms = how far the arms go up, lean = leaning back in the air)
  const jump = (k: number, h: number, arms: number, lean: number) => {
    if (k < 0.22) { const c = smooth(k / 0.22); off.sq = 1 - 0.13 * c; off.y = -0.07 * c; off.aL = off.aR = -0.15 * c; return; }
    if (k < 0.72) {
      const u = (k - 0.22) / 0.5;
      off.y = -0.07 * (1 - u) + h * 4 * u * (1 - u);
      off.sq = u < 0.5 ? 0.88 + 0.17 * outCubic(u * 2) : 1.05 - 0.05 * smooth((u - 0.5) * 2);
      off.aL = off.aR = arms * Math.sin(Math.PI * u) - 0.15 * (1 - u);
      off.rx = -lean * Math.sin(Math.PI * u);
      off.eL = off.eR = 1 - 0.5 * Math.sin(Math.PI * u);
      off.mouth = 1 + 0.35 * Math.sin(Math.PI * u);
      return;
    }
    const v = (k - 0.72) / 0.28;
    off.sq = 1 - 0.1 * Math.sin(Math.PI * v);
    off.eL = off.eR = 1 - 0.25 * (1 - v);
  };
  const EMOTES: { name: string; dur: number; play: (k: number) => void }[] = [
    { name: "hop", dur: 0.9, play: (k) => jump(k, 0.17, 0.6, 0.06) },
    { name: "wave", dur: 1.5, play: (k) => {
      const env = smooth(Math.min(k / 0.15, (1 - k) / 0.2, 1));
      const ph = Math.sin(k * Math.PI * 2 * 3.2);
      off.rz = -0.07 * env; off.aR = 0.4 * ph * env; off.aL = 0.12 * env; off.y = 0.03 * Math.abs(ph) * env;
      off.eR = 1 - 0.85 * bump(k, 0.35, 0.72); // a wink
      off.mouth = 1 + 0.2 * env;
    } },
    { name: "spin", dur: 1.0, play: (k) => {
      off.ry = Math.PI * 2 * smooth(k); off.y = 0.09 * Math.sin(Math.PI * k);
      off.sq = 1 - 0.05 * bump(k, 0, 0.25) + 0.04 * bump(k, 0.25, 0.85);
      off.aL = off.aR = 0.5 * Math.sin(Math.PI * k); off.eL = off.eR = 1 - 0.4 * Math.sin(Math.PI * k);
    } },
    { name: "dance", dur: 1.6, play: (k) => {
      const env = smooth(Math.min(k / 0.12, (1 - k) / 0.12, 1));
      const ph = k * Math.PI * 2 * 3;
      off.rz = 0.2 * Math.sin(ph) * env; off.ry = 0.22 * Math.sin(ph) * env; off.y = 0.07 * Math.abs(Math.sin(ph)) * env;
      off.aR = 0.55 * Math.sin(ph) * env; off.aL = -0.55 * Math.sin(ph) * env;
      off.sq = 1 + 0.03 * Math.cos(2 * ph) * env; off.eL = off.eR = 1 - 0.35 * env; off.mouth = 1 + 0.25 * env;
    } },
    { name: "cheer", dur: 1.3, play: (k) => jump(k, 0.21, 0.75, 0.2) },
  ];
  let emote: { i: number; t0: number; burst: boolean } | null = null;
  let queued = false, wantStart = false, nextEmote = 0, now = 0, boop = 0;
  const startEmote = () => { emote = { i: nextEmote, t0: now, burst: false }; nextEmote = (nextEmote + 1) % EMOTES.length; };

  // the cheer throws a handful of gold pieces up from the crown; they fall back and shrink away
  const BURST_N = 28;
  let burst: THREE.InstancedMesh | null = null;
  const bp: { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; s: number }[] = [];
  let burstAge = -1;
  const spawnBurst = () => {
    if (!burst) {
      burst = new THREE.InstancedMesh(own(new THREE.PlaneGeometry(0.1, 0.16)), own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), BURST_N);
      const palette = ["#ffc83d", "#ffd96b", "#ff8447", "#fff1dc", "#ff5a7a"].map((c) => new THREE.Color(c));
      for (let i = 0; i < BURST_N; i++) burst.setColorAt(i, palette[i % palette.length]);
      burst.frustumCulled = false; scene.add(burst);
    }
    for (let i = 0; i < BURST_N; i++) {
      const a = Math.random() * Math.PI * 2;
      bp[i] = { x: Math.cos(a) * 0.25, y: ghost.position.y + 1.1, z: 0.3 + Math.random() * 0.5, vx: Math.cos(a) * (0.5 + Math.random() * 1.7), vy: 1.8 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 1.2, r: Math.random() * 6, s: 3 + Math.random() * 6 };
    }
    burst.count = BURST_N; burstAge = 0;
  };
  const stepBurst = (dt: number) => {
    if (!burst || burstAge < 0) return;
    burstAge += dt;
    const life = 1.7, d = new THREE.Object3D();
    for (let i = 0; i < burst.count; i++) {
      const p = bp[i];
      p.vy -= 5.5 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      d.position.set(p.x, p.y, p.z); d.rotation.set(burstAge * p.s + p.r, burstAge * p.s * 0.7, p.r); d.scale.setScalar(Math.max(0.001, 1 - burstAge / life)); d.updateMatrix();
      burst.setMatrixAt(i, d.matrix);
    }
    burst.instanceMatrix.needsUpdate = true;
    if (burstAge > life) { burst.count = 0; burstAge = -1; }
  };
  const crowned = opts.pose === "king" || opts.pose === "sleep";
  const zoom = opts.zoom ?? 1; // >1 moves the camera in (the hero banner is wide and short, so it wants the ghost bigger)
  const lookAtY = (opts.podium ? 1.0 + (zoom - 1) : crowned ? 0.45 : -0.05) + (opts.lift ?? 0);
  const sx = -(opts.shiftX ?? 0); // the camera slides left, so the ghost appears to the right (leaves room for a title on the left)
  camera.position.set(sx, opts.podium ? 1.5 + (zoom - 1) * 0.6 : lookAtY + 0.3, (opts.podium ? 8.6 : crowned ? 7.6 : 6.0) / zoom);
  camera.lookAt(sx, lookAtY, 0);

  return {
    scene, camera,
    resize(w, h) {
      camera.aspect = Math.max(0.2, w / Math.max(1, h)); camera.fov = camera.aspect < 1 ? 32 / Math.min(1, camera.aspect * 0.9 + 0.1) : 32; camera.updateProjectionMatrix();
      const half = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect; // half the visible width at the ghost's depth
      xScale = Math.max(1, (half + Math.abs(sx)) / 3.25);
      if (confetti) confetti.count = Math.min(flakeMax, Math.round(flakes * Math.min(2, xScale)));
    },
    update(t, dt, pointer) {
      now = t;
      cur.x += (pointer.x - cur.x) * Math.min(1, dt * 5); cur.y += (pointer.y - cur.y) * Math.min(1, dt * 5);
      // which emote is playing (a tap starts one; the next tap while it plays waits for it to finish)
      if (wantStart && !emote) { wantStart = false; startEmote(); }
      off.y = 0; off.ry = 0; off.rz = 0; off.rx = 0; off.sq = 1; off.aL = 0; off.aR = 0; off.eL = 1; off.eR = 1; off.mouth = 1;
      if (emote) {
        let k = (t - emote.t0) / EMOTES[emote.i].dur;
        if (k >= 1) {
          if (queued) { queued = false; startEmote(); k = 0; } else { emote = null; k = 0; }
        }
        if (emote) {
          EMOTES[emote.i].play(clear01(k));
          if (EMOTES[emote.i].name === "cheer" && !emote.burst && k > 0.22) { emote.burst = true; spawnBurst(); }
        }
      }
      boop = Math.max(0, boop - dt * 4.5); // every tap answers at once with a little squash, even when it has to wait its turn
      off.sq *= 1 - 0.06 * boop * boop;
      // (a lively pet bobs more and faster, a sad one sags and leans forward: energy 1 and droop 0 are the standard ghost)
      ghost.position.y = base - droop * 0.08 + Math.sin(t * 1.8 * energy) * 0.06 * Math.min(1.4, energy) + off.y; // floats, never touches
      ghost.rotation.y = (opts.yaw ?? 0) + cur.x * 0.5 + Math.sin(t * 0.6) * 0.1 + off.ry;
      ghost.rotation.x = -cur.y * 0.14 + droop * 0.14 + off.rx;
      ghost.rotation.z = Math.sin(t * 1.2) * 0.02 + off.rz;
      const squash = (1 + Math.sin(t * 1.8 * energy + 1.2) * 0.012) * off.sq * (1 - droop * 0.05); ghost.scale.set(bx / Math.sqrt(squash), by * squash, bx / Math.sqrt(squash));
      // both arms move together: the same swing, a half-beat apart, mirrored left and right (an arm never goes past straight up)
      const wave = Math.sin(t * 6) * 0.25;
      armR.rotation.z = Math.min(3.0, rightBase + (opts.pose === "wave" && !opts.pet ? wave : Math.sin(t * 2.2 * energy) * 0.06) + off.aR);
      armL.rotation.z = Math.max(-3.0, leftBase - (bothUp ? Math.sin(t * 2.2 + 1.4) * 0.06 : Math.sin(t * 2 + 1) * 0.05) - off.aL);
      // blink (the emotes squint the eyes happy, or wink, on top of it)
      let bl = 1;
      if (!closed && t > blinkAt && blinkT < 0) blinkT = t;
      if (blinkT >= 0) { const k = (t - blinkT) / 0.14; bl = k < 1 ? 1 - Math.sin(k * Math.PI) * 0.92 : 1; if (k >= 1) { blinkT = -1; blinkAt = t + 2.4 + Math.random() * 2.4; } }
      if (eyes.length === 2) { // (a pet's closed, star, X and spiral eyes do not blink)
        if (!eyes[0].userData.noBlink) eyes[0].scale.y = Math.max(0.08, bl * off.eL);
        if (!eyes[1].userData.noBlink) eyes[1].scale.y = Math.max(0.08, bl * off.eR);
      }
      if (mouthG) mouthG.scale.set(off.mouth, off.mouth, 1);
      petParts?.update(t);
      if (beam) (beam.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.4 + Math.sin(t * 0.9) * 0.03;
      placeFlakes(t);
      stepBurst(dt);
    },
    poke() { boop = 1; if (emote) queued = true; else wantStart = true; },
    forceEmote(i, k, t) { emote = { i: Math.max(0, Math.min(EMOTES.length - 1, Math.floor(i))), t0: t - k * EMOTES[Math.max(0, Math.min(EMOTES.length - 1, Math.floor(i)))].dur, burst: true }; wantStart = false; queued = false; },
    dispose() {
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose()); });
      for (const d of disposables) { try { d.dispose(); } catch { /* already gone */ } }
    },
  };
}
