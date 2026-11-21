// lib/wraithPet.ts: everyone's own Wraith (no three.js here, so the logic can be used anywhere).
// The pet's LOOK says who you are and how you trade: its colour, body, eyes, cheeks, hat, what it holds and the mark on its belly come from your account
// (the same account always gets the same pet) and your trades unlock the rest (a crown for the top of the board, a halo for a high win rate, a wizard hat
// for a moonshot, and it grows as you close trades). Its MOOD says how you are doing right now: the money in your wallet, your profit or loss, your win rate
// and your place on the board decide the face, the arms, the little cloud or the coins around it. lib/wraithPet3d.ts draws it.

export type PetStats = {
  /** trades closed so far */
  closed: number;
  /** share of closed trades that made money (percent), null before the first one */
  winRate: number | null;
  /** profit or loss over the last 7 days, in SOL */
  pnlSol: number;
  /** best single trade, percent */
  bestPct: number;
  /** "top N%" of everyone who has traded (null when there are too few traders to say) */
  topPct: number | null;
  rank: number | null;
  /** how many traders the rank is among */
  of: number;
  /** money in the wallet, in dollars; null when it is not known yet */
  cashUsd: number | null;
};

export type Mood = "sleepy" | "hungry" | "chill" | "happy" | "euphoric" | "worried" | "rekt";
export type EyeStyle = "oval" | "tall" | "wide" | "dot" | "droop" | "star" | "x" | "spiral" | "closed" | "happy";
export type BrowStyle = "none" | "soft" | "thick" | "worried" | "angry";
export type MouthStyle = "smile" | "grin" | "flat" | "frown" | "open" | "wavy" | "tiny";
export type CheekStyle = "none" | "blush" | "freckles" | "whiskers";
export type HatStyle = "none" | "crown" | "beanie" | "cap" | "wizard" | "bow" | "halo" | "horns" | "cat" | "bunny" | "sprout" | "antenna" | "party";
export type PropStyle = "none" | "coin" | "star" | "gem" | "flag";
export type EmblemStyle = "none" | "star" | "bolt" | "diamond" | "ring";
export type AuraStyle = "none" | "sparkles" | "hearts" | "coins" | "rain" | "zzz";
export type ArmStyle = "down" | "up" | "cheer" | "shrug" | "hug";

/** What never changes with the mood: who this pet is. */
export type PetGenome = {
  hue: number; // turn of the colour wheel away from the orange (0 = orange, 0.3 = green, 0.55 = blue, 0.83 = pink)
  accent: string; // the colour of its hat and what it holds
  bodyX: number; bodyY: number; lobes: number; // how wide, how tall, how many scallops on the hem
  eyes: EyeStyle; brows: BrowStyle; cheeks: CheekStyle;
  hat: HatStyle; prop: PropStyle; emblem: EmblemStyle;
  size: number; // grows with the number of trades
  earned: string[]; // the labels of what the trades unlocked
};

/** Everything the 3D scene needs: the genome with the mood put on top of it. */
export type PetLook = PetGenome & {
  mood: Mood;
  mouth: MouthStyle;
  aura: AuraStyle;
  arms: ArmStyle;
  tears: boolean; sweat: boolean;
  sat: number; lum: number; // colour: 1 = as is, lower = paler / darker (a sad pet loses its colour)
  energy: number; // how lively it bobs and blinks
  droop: number; // 0..1, how much it sags
};

/** a stable 32-bit number from a string (FNV-1a) */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
/** like pick, but the first entries are more likely: a plain face is more common than a hat, so the hats stay special */
const pickWeighted = <T,>(r: () => number, list: readonly [T, number][]): T => {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of list) { x -= w; if (x <= 0) return v; }
  return list[list.length - 1][0];
};

const HUES = [0, 0.04, 0.09, 0.14, 0.2, 0.27, 0.33, 0.4, 0.47, 0.54, 0.6, 0.67, 0.74, 0.8, 0.86, 0.93] as const;
const ACCENTS = ["#3b82f6", "#ec4899", "#22c55e", "#a855f7", "#f5f5f7", "#1f2937", "#facc15", "#14b8a6"] as const;
const BODIES = [[1, 1], [1.07, 0.95], [0.94, 1.08], [1.12, 0.92], [0.97, 1.03], [1.04, 1]] as const;

/**
 * The pet's identity. `seed` is the account (its id), so the same person always gets the same pet; `st` (your trades) unlocks the earned parts.
 * Counted without the mood: 16 colours x 6 bodies x 4 hems x 5 eyes x 3 brows x 4 cheeks x 13 hats x 5 things held x 5 marks x 8 accents, about sixty million
 * ways before any mood (and seven moods on top), so two pets are almost never alike.
 */
export function genomeOf(seed: string, st: PetStats | null): PetGenome {
  const r = rng(hash32(seed || "wraith"));
  const hue = pick(r, HUES);
  const accent = pick(r, ACCENTS);
  const [bodyX, bodyY] = pick(r, BODIES);
  const lobes = pick(r, [4, 5, 5, 6, 7] as const);
  const eyes = pick(r, ["oval", "oval", "tall", "wide", "dot", "droop"] as const);
  const brows = pick(r, ["none", "none", "soft", "thick"] as const);
  const cheeks = pick(r, ["none", "blush", "blush", "freckles", "whiskers"] as const);
  let hat: HatStyle = pickWeighted<HatStyle>(r, [["none", 5], ["beanie", 2], ["cap", 2], ["bow", 2], ["bunny", 1.4], ["cat", 1.4], ["sprout", 1.4], ["antenna", 1.2], ["party", 1.2], ["horns", 1]]);
  const prop = pickWeighted<PropStyle>(r, [["none", 4], ["coin", 2], ["star", 1.5], ["gem", 1.5], ["flag", 1.2]]);
  const emblem = pickWeighted<EmblemStyle>(r, [["none", 3], ["star", 1.5], ["bolt", 1.5], ["diamond", 1.2], ["ring", 1.2]]);

  // what the trades unlock, and how big it has grown
  const earned: string[] = [];
  const closed = st?.closed ?? 0;
  if (st && ((st.rank !== null && st.rank <= 10) || (st.topPct !== null && st.topPct <= 5))) { hat = "crown"; earned.push("Crowned"); }
  else if (st && st.bestPct >= 900) { hat = "wizard"; earned.push("Moonshot wizard"); }
  else if (st && closed >= 10 && (st.winRate ?? 0) >= 65) { hat = "halo"; earned.push("Sharp eyed"); }
  if (st && st.bestPct >= 200 && !earned.includes("Moonshot wizard")) earned.push("Big hitter");
  if (closed >= 25) earned.push("Veteran");
  const size = closed <= 0 ? 0.84 : Math.min(1.08, 0.88 + Math.min(closed, 60) / 60 * 0.2);
  return { hue, accent, bodyX, bodyY, lobes, eyes, brows, cheeks, hat, prop, emblem, size, earned };
}

export type MoodRead = { mood: Mood; title: string; line: string };

/** How the pet feels: decided by the money in the wallet, this week's profit or loss, the win rate and the place on the board. */
export function moodOf(st: PetStats | null, fmtMoney?: (sol: number) => string, voice: "you" | "they" = "you"): MoodRead {
  const money = fmtMoney ?? ((n: number) => `${n.toFixed(2)} SOL`);
  if (!st || st.closed <= 0) return { mood: "sleepy", title: "Asleep", line: voice === "you" ? "Make your first trade to wake it up." : "Asleep until their first trade." };
  const cash = st.cashUsd;
  if (cash !== null && cash < 1) return { mood: "hungry", title: "Hungry", line: "The cash is nearly gone. Add some to keep it fed." };
  const p = st.pnlSol;
  const deep = p <= -0.5 || (p < -0.05 && st.winRate !== null && st.winRate < 35);
  if (deep) return { mood: "rekt", title: "Rekt", line: `Down ${money(Math.abs(p))} this week. Breathe, the next trade is a new one.` };
  if (p < -0.02) return { mood: "worried", title: "Worried", line: `Down ${money(Math.abs(p))} this week. One good trade turns it around.` };
  const top = st.topPct !== null && st.topPct <= 10 && st.of >= 5;
  if (p > 0.02 && (top || st.bestPct >= 500)) return { mood: "euphoric", title: "On top of the world", line: top ? `Up ${money(p)} this week, in the top ${st.topPct}% of traders.` : `Up ${money(p)} this week with a ${Math.round(st.bestPct)}% best trade.` };
  if (p > 0.02) return { mood: "happy", title: "Happy", line: `Up ${money(p)} this week${st.winRate !== null ? `, winning ${Math.round(st.winRate)}% of ${voice === "you" ? "your" : "their"} trades` : ""}.` };
  return { mood: "chill", title: "Chilling", line: "Flat this week. Waiting for the next setup." };
}

/** The genome with a mood on top of it: the face, the arms, the weather around it. */
export function lookOf(g: PetGenome, mood: Mood, st: PetStats | null): PetLook {
  const rich = (st?.cashUsd ?? 0) >= 1000;
  const base: PetLook = { ...g, mood, mouth: "smile", aura: "none", arms: "down", tears: false, sweat: false, sat: 1, lum: 1, energy: 1, droop: 0 };
  switch (mood) {
    case "sleepy": return { ...base, eyes: "closed", brows: "none", mouth: "tiny", aura: "zzz", arms: "down", energy: 0.45, droop: 0.2, sat: 0.9 };
    case "hungry": return { ...base, eyes: "droop", brows: "worried", mouth: "flat", arms: "hug", energy: 0.6, droop: 0.55, sat: 0.82, lum: 0.94 };
    case "chill": return { ...base, mouth: "smile", arms: "down", energy: 0.85, aura: rich ? "coins" : "none" };
    case "happy": return { ...base, eyes: g.eyes === "droop" ? "oval" : g.eyes, mouth: "grin", cheeks: g.cheeks === "none" ? "blush" : g.cheeks, arms: "up", aura: rich ? "coins" : "hearts", energy: 1.25 };
    case "euphoric": return { ...base, eyes: "star", brows: "none", mouth: "grin", cheeks: "blush", arms: "cheer", aura: rich ? "coins" : "sparkles", energy: 1.7, sat: 1.12 };
    case "worried": return { ...base, eyes: "wide", brows: "worried", mouth: "wavy", sweat: true, arms: "shrug", energy: 0.95, sat: 0.92 };
    case "rekt": return { ...base, eyes: "spiral", brows: "worried", mouth: "frown", tears: true, aura: "rain", arms: "down", energy: 0.5, droop: 0.95, sat: 0.5, lum: 0.88 };
  }
}

/** A short text key to remember a scene by: same look, same scene. */
export function petKey(l: PetLook): string {
  return [l.hue, l.accent, l.bodyX, l.bodyY, l.lobes, l.eyes, l.brows, l.cheeks, l.hat, l.prop, l.emblem, l.size.toFixed(2), l.mood, l.mouth, l.aura, l.arms, l.tears ? 1 : 0, l.sweat ? 1 : 0, l.sat, l.lum, l.energy, l.droop].join("|");
}
