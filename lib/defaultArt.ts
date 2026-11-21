// lib/defaultArt.ts
// Wraith-native default cover + avatar for profiles that have not uploaded their own, seeded from a stable id so every user gets their own
// look and it never changes between renders (the cover is one of the 3D pictures in public/covers, the avatar one of the 3D portraits in public/avatars).

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The cover of anyone who has not uploaded one: Wraith's own 3D ghost in a different colour and a different action (king, wave, asleep,
 * shocked, cheering, dancing, spinning, hopping), one of eight pictures in public/covers, chosen by the account so it never changes.
 * Every picture is composed the same way: 1600x500, the ghost left of centre (so it is close to the profile photo, which overlaps the cover's lower
 * left), turned toward that photo, about 60% of the height, with its own props (speech bubble, moon, music notes ...). Rendered from lib/wraith3d.ts
 * with the yaw / lift options plus a little 2D painting. HotShots.tsx shows the same picture smaller on its tall posters.
 */
export const DEFAULT_COVERS = ["king", "wave", "sleep", "oops", "cheer", "dance", "spin", "hop"] as const;
export function defaultCover(seed: string): string {
  return `/covers/${DEFAULT_COVERS[hash(seed || "wraith") % DEFAULT_COVERS.length]}.webp`;
}

/**
 * Default profile picture: one of ten 3D portraits of the Wraith ghost (public/avatars, 384px): a different colour, expression or little extra each
 * (headphones, halo, party hat, hearts, a sleepy crowned one, a shocked one ...), chosen by the account so it never changes. They replace the first
 * set, a flat white ghost on a coloured square, which nobody liked. Rendered with the same scene as the covers (lib/wraith3d.ts).
 */
export const DEFAULT_AVATARS = ["ember", "azure", "violet", "rose", "mint", "teal", "fuchsia", "gold", "ice", "lime"] as const;
export function defaultAvatar(seed: string): string {
  return `/avatars/${DEFAULT_AVATARS[hash(seed || "wraith") % DEFAULT_AVATARS.length]}.webp`;
}
