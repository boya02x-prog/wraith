// lib/petStill.ts (browser only): draws a pet ONCE to a small transparent picture, for lists where a live 3D canvas per row would run out of graphics contexts
// (the Leaderboard). One shared renderer, one pet at a time with a breath between them so scrolling never stutters, and every picture is remembered.
import { petKey, type PetLook } from "@/lib/wraithPet";

const done = new Map<string, string>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
const queue: { key: string; look: PetLook }[] = [];
let busy = false;
let shared: { renderer: import("three").WebGLRenderer; canvas: HTMLCanvasElement } | null = null;

async function renderOne(look: PetLook): Promise<string | null> {
  const [THREE, { createWraithScene }] = await Promise.all([import("three"), import("@/lib/wraith3d")]);
  if (!shared) {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1); renderer.setSize(220, 250, false);
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); shared = null; });
    shared = { renderer, canvas };
  }
  const { renderer, canvas } = shared;
  const tall = look.hat === "wizard" || look.hat === "bunny";
  const sc = createWraithScene(renderer, { pose: "wave", podium: 0, confetti: 0, spotlight: false, zoom: tall ? 0.74 : 0.9, lift: tall ? 0.5 : 0.32, seed: 7, pet: look });
  try { sc.resize(220, 250); sc.update(1.6, 0.016, { x: 0, y: 0 }); renderer.render(sc.scene, sc.camera); return canvas.toDataURL("image/png"); } finally { sc.dispose(); }
}

function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  renderOne(job.look).catch(() => null).then((url) => {
    if (url) done.set(job.key, url);
    for (const cb of waiting.get(job.key) ?? []) cb(url);
    waiting.delete(job.key);
    busy = false;
    window.setTimeout(pump, 60);
  });
}

export const peekPetStill = (look: PetLook): string | null => done.get(petKey(look)) ?? null;

export function petStill(look: PetLook): Promise<string | null> {
  const key = petKey(look);
  const hit = done.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const w = waiting.get(key);
    if (w) { w.push(resolve); return; }
    waiting.set(key, [resolve]);
    queue.push({ key, look });
    pump();
  });
}
