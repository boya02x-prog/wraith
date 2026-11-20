// Avatar borders ("frames") a trader can pick for their profile. They are cosmetic only: a ring and glow around the photo wherever it is shown
// (leaderboard, Hot shots, profile, search). The choice is saved on the profile as `frame` (see /api/user/profile); the look lives in
// app/wraith-frames.css (one `.fr-<id>` class per frame) and the wrapper component in components/Frame.tsx.
//
// Event frames can only be picked while their window is open (the window repeats every year). Once picked they stay.

export type FrameId =
  | "none" | "crown" | "flames" | "wings" | "demon" | "lightning" | "cyber" | "laurel" | "frost" | "ghosts"
  | "blackfriday" | "winter" | "newyear" | "valentine" | "halloween"
  // the first round of plain rings: still drawn for anyone who picked one, no longer offered in the picker
  | "ember" | "gold" | "neon" | "aurora" | "inferno" | "ghost" | "matrix" | "royal" | "prism" | "ice" | "toxic";

export type FrameDef = {
  id: FrameId;
  label: string;
  /** one short line under the name in the picker */
  hint: string;
  /** main colour: also used as the soft glow on cards and posters of people who wear it */
  color: string;
  /** month/day window (1-based month) in which an event frame can be picked, inclusive; the window can wrap over New Year */
  event?: { from: [number, number]; to: [number, number]; name: string };
  /** an old plain ring: still shown on profiles that have it, hidden from the picker */
  legacy?: boolean;
};

export const FRAMES: FrameDef[] = [
  { id: "none", label: "Plain", hint: "No border", color: "#ffffff" },
  { id: "crown", label: "Crown", hint: "Gold ring, jewelled crown", color: "#ffc94a" },
  { id: "flames", label: "Flames", hint: "A ring of fire", color: "#ff6a1a" },
  { id: "wings", label: "Wings", hint: "Angel wings and halo", color: "#bcd0ff" },
  { id: "demon", label: "Horns", hint: "Devil horns and spikes", color: "#ff4d4d" },
  { id: "lightning", label: "Storm", hint: "Crackling lightning", color: "#7fd4ff" },
  { id: "cyber", label: "Cyber", hint: "Spinning HUD rings", color: "#22e5ff" },
  { id: "laurel", label: "Champion", hint: "Gold laurel wreath", color: "#ffc94a" },
  { id: "frost", label: "Frost", hint: "Ice crystals", color: "#8fd8ff" },
  { id: "ghosts", label: "Haunt", hint: "Little ghosts circling", color: "#ff9a52" },
  { id: "blackfriday", label: "Black Friday", hint: "Gold stripes, sale tag", color: "#ffd24a", event: { from: [11, 18], to: [12, 2], name: "Black Friday" } },
  { id: "winter", label: "Winter", hint: "Santa hat and snow", color: "#ff5252", event: { from: [12, 1], to: [1, 6], name: "Winter" } },
  { id: "newyear", label: "New Year", hint: "Gold fireworks", color: "#ffe08a", event: { from: [12, 26], to: [1, 8], name: "New Year" } },
  { id: "valentine", label: "Valentine", hint: "Floating hearts", color: "#ff5c93", event: { from: [2, 5], to: [2, 16], name: "Valentine's" } },
  { id: "halloween", label: "Halloween", hint: "Pumpkin and bats", color: "#ff8a1f", event: { from: [10, 12], to: [11, 3], name: "Halloween" } },
  { id: "ember", label: "Ember", hint: "Warm orange glow", color: "#ff7b3d", legacy: true },
  { id: "gold", label: "Gold", hint: "Slow golden shimmer", color: "#ffc94a", legacy: true },
  { id: "neon", label: "Neon", hint: "Cyan and pink spin", color: "#22e5ff", legacy: true },
  { id: "aurora", label: "Aurora", hint: "Northern lights", color: "#3ddc97", legacy: true },
  { id: "inferno", label: "Inferno", hint: "Burning ring", color: "#ff4d2e", legacy: true },
  { id: "ghost", label: "Spectral", hint: "Cold white pulse", color: "#bcd4ff", legacy: true },
  { id: "matrix", label: "Matrix", hint: "Green code ring", color: "#2bff88", legacy: true },
  { id: "royal", label: "Royal", hint: "Purple and gold", color: "#a78bfa", legacy: true },
  { id: "prism", label: "Prism", hint: "Full colour spin", color: "#ff5ea8", legacy: true },
  { id: "ice", label: "Frost ring", hint: "Icy sparkle", color: "#8fe3ff", legacy: true },
  { id: "toxic", label: "Toxic", hint: "Acid green", color: "#c6ff2e", legacy: true },
];

const BY_ID = new Map<string, FrameDef>(FRAMES.map((f) => [f.id, f]));

export const isFrameId = (v: unknown): v is FrameId => typeof v === "string" && BY_ID.has(v);
export const frameOf = (id: unknown): FrameDef => (typeof id === "string" ? BY_ID.get(id) : undefined) ?? BY_ID.get("none")!;

/** Is this event frame pickable on this date? Frames that are not events are always pickable. */
export function frameOpen(f: FrameDef, now = new Date()): boolean {
  if (!f.event) return true;
  const key = (m: number, d: number) => m * 100 + d;
  const today = key(now.getMonth() + 1, now.getDate());
  const a = key(f.event.from[0], f.event.from[1]);
  const b = key(f.event.to[0], f.event.to[1]);
  return a <= b ? today >= a && today <= b : today >= a || today <= b;
}

/** When a closed event frame is next open, as a short phrase for the picker ("back Dec 1"). */
export function frameBack(f: FrameDef): string {
  if (!f.event) return "";
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `back ${names[f.event.from[0] - 1]} ${f.event.from[1]}`;
}
