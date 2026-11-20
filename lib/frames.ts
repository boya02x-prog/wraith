// Avatar borders ("frames") a trader can pick for their profile. They are cosmetic only: a ring and glow around the photo wherever it is shown
// (leaderboard, Hot shots, profile, search). The choice is saved on the profile as `frame` (see /api/user/profile); the look lives in
// app/wraith-frames.css (one `.fr-<id>` class per frame) and the wrapper component in components/Frame.tsx.
//
// Event frames can only be picked while their window is open (the window repeats every year). Once picked they stay.

export type FrameId =
  | "none" | "ember" | "gold" | "neon" | "aurora" | "inferno" | "ghost" | "matrix" | "royal" | "prism" | "ice" | "toxic"
  | "blackfriday" | "winter" | "newyear" | "valentine" | "halloween";

export type FrameDef = {
  id: FrameId;
  label: string;
  /** one short line under the name in the picker */
  hint: string;
  /** main colour: also used as the soft glow on cards and posters of people who wear it */
  color: string;
  /** month/day window (1-based month) in which an event frame can be picked, inclusive; the window can wrap over New Year */
  event?: { from: [number, number]; to: [number, number]; name: string };
};

export const FRAMES: FrameDef[] = [
  { id: "none", label: "Plain", hint: "No border", color: "#ffffff" },
  { id: "ember", label: "Ember", hint: "Warm orange glow", color: "#ff7b3d" },
  { id: "gold", label: "Gold", hint: "Slow golden shimmer", color: "#ffc94a" },
  { id: "neon", label: "Neon", hint: "Cyan and pink spin", color: "#22e5ff" },
  { id: "aurora", label: "Aurora", hint: "Northern lights", color: "#3ddc97" },
  { id: "inferno", label: "Inferno", hint: "Burning ring", color: "#ff4d2e" },
  { id: "ghost", label: "Spectral", hint: "Cold white pulse", color: "#bcd4ff" },
  { id: "matrix", label: "Matrix", hint: "Green code ring", color: "#2bff88" },
  { id: "royal", label: "Royal", hint: "Purple and gold", color: "#a78bfa" },
  { id: "prism", label: "Prism", hint: "Full colour spin", color: "#ff5ea8" },
  { id: "ice", label: "Frost", hint: "Icy sparkle", color: "#8fe3ff" },
  { id: "toxic", label: "Toxic", hint: "Acid green", color: "#c6ff2e" },
  { id: "blackfriday", label: "Black Friday", hint: "Gold and black sale", color: "#ffd24a", event: { from: [11, 18], to: [12, 2], name: "Black Friday" } },
  { id: "winter", label: "Winter lights", hint: "Blinking holiday lights", color: "#ff5252", event: { from: [12, 1], to: [1, 6], name: "Winter" } },
  { id: "newyear", label: "New Year", hint: "Gold fireworks", color: "#ffe08a", event: { from: [12, 26], to: [1, 8], name: "New Year" } },
  { id: "valentine", label: "Valentine", hint: "Pink hearts glow", color: "#ff5c93", event: { from: [2, 5], to: [2, 16], name: "Valentine's" } },
  { id: "halloween", label: "Halloween", hint: "Orange and purple", color: "#ff8a1f", event: { from: [10, 12], to: [11, 3], name: "Halloween" } },
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
