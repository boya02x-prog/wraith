// A face for every wallet. Deterministic from the address (no storage, no lookup), so the same wallet always gets the same
// Wraith-style name and avatar everywhere. The type comes from measured behaviour (see scripts/analyze-wallets.ts).

export type WalletKind = "sniper" | "flipper" | "holder" | "whale" | "volume-bot" | "regular";

export const KIND_INFO: Record<WalletKind, { label: string; emoji: string; color: string; blurb: string }> = {
  sniper: { label: "Sniper", emoji: "🎯", color: "#ef4444", blurb: "Usually buys within 3 seconds of launch" },
  flipper: { label: "Flipper", emoji: "⚡", color: "#f59e0b", blurb: "Sells within minutes of buying" },
  holder: { label: "Holder", emoji: "💎", color: "#22c55e", blurb: "Usually still holding 30 minutes in" },
  whale: { label: "Whale", emoji: "🐋", color: "#38bdf8", blurb: "Buys in large size" },
  "volume-bot": { label: "Volume bot", emoji: "🤖", color: "#a78bfa", blurb: "Touches a fifth of all launches: automated" },
  regular: { label: "Regular", emoji: "👤", color: "#94a3b8", blurb: "No strong pattern" },
};

const ADJ = ["Pale", "Hollow", "Silent", "Ashen", "Cursed", "Veiled", "Restless", "Frozen", "Burning", "Grim", "Lost", "Wicked", "Fading", "Haunted", "Cold", "Pallid", "Twilight", "Ember", "Shrouded", "Wandering"];
const NOUN = ["Wisp", "Specter", "Moth", "Shade", "Phantom", "Banshee", "Revenant", "Lantern", "Raven", "Ghoul", "Wraith", "Husk", "Fog", "Crypt", "Cinder", "Omen", "Spirit", "Hex", "Totem", "Reaper"];

/** small, stable 32-bit hash of the address */
export function hashAddr(a: string): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) { h ^= a.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function walletName(addr: string): string {
  const h = hashAddr(addr);
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >>> 8) % NOUN.length]}`;
}

/** hue 0..359 for the ghost body */
export function walletHue(addr: string): number {
  return (hashAddr(addr) >>> 4) % 360;
}

export const asKind = (k: unknown): WalletKind => (typeof k === "string" && k in KIND_INFO ? (k as WalletKind) : "regular");
