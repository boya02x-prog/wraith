// lib/defaultArt.ts
// Wraith-native default cover + avatar for profiles that have not uploaded their own, seeded from a stable id so every user gets their own
// look and it never changes between renders (the cover is one of the 3D pictures in public/covers, the avatar an SVG data URI).

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

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

// avatar backgrounds: [light, dark] of one hue, so the white ghost always reads clearly on top
const AVATAR_BG: [string, string][] = [
  ["#ff9a52", "#e8501a"], // ember (brand)
  ["#ffc24a", "#f08a00"], // amber
  ["#ff7d8e", "#e0355a"], // rose
  ["#c58bff", "#7a3fe0"], // violet
  ["#6fb6ff", "#2a6fe8"], // blue
  ["#4fe0c0", "#0f9f86"], // teal
  ["#8fe36a", "#3aa83a"], // green
  ["#ff8fd0", "#d640a0"], // pink
];

/** Default profile picture: a white Wraith ghost on a bright colour, different face and colour per account, same every time. */
export function defaultAvatar(seed: string): string {
  const h = hash(seed || "wraith");
  const [light, dark] = AVATAR_BG[h % AVATAR_BG.length];
  const look = (h >>> 5) % 4; // face
  const ink = "#1a1420";
  const eyes = look === 0
    ? `<ellipse cx="25.5" cy="29" rx="3.4" ry="4.4" fill="${ink}"/><ellipse cx="38.5" cy="29" rx="3.4" ry="4.4" fill="${ink}"/><circle cx="26.7" cy="27.3" r="1.2" fill="#fff"/><circle cx="39.7" cy="27.3" r="1.2" fill="#fff"/>`
    : look === 1
      ? `<path d="M21.5 29.5q4-4.6 8 0M34.5 29.5q4-4.6 8 0" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`
      : look === 2
        ? `<ellipse cx="25.5" cy="29" rx="3.4" ry="4.4" fill="${ink}"/><circle cx="26.7" cy="27.3" r="1.2" fill="#fff"/><path d="M34.5 29.5h8" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`
        : `<rect x="21" y="26" width="9" height="6.4" rx="3.2" fill="${ink}"/><rect x="34" y="26" width="9" height="6.4" rx="3.2" fill="${ink}"/><rect x="29" y="27.8" width="6" height="1.8" fill="${ink}"/>`;
  const mouth = ((h >>> 9) % 3) === 0
    ? `<ellipse cx="32" cy="37.5" rx="2.2" ry="2.8" fill="${ink}"/>`
    : ((h >>> 9) % 3) === 1
      ? `<path d="M28.5 36.5q3.5 3.4 7 0" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
<radialGradient id="s" cx="28%" cy="18%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ece6f2"/></linearGradient>
</defs>
<rect width="64" height="64" fill="url(#b)"/><rect width="64" height="64" fill="url(#s)"/>
<ellipse cx="32" cy="58" rx="15" ry="3.2" fill="#000" opacity=".18"/>
<path d="M32 11c-10.5 0-18 7.8-18 17.8V53l6-4.8 6 4.8 6-4.8 6 4.8 6-4.8 6 4.8V28.8C50 18.8 42.5 11 32 11z" fill="url(#g)"/>
<ellipse cx="21.5" cy="34.5" rx="2.6" ry="1.5" fill="#ff8fa3" opacity=".55"/><ellipse cx="42.5" cy="34.5" rx="2.6" ry="1.5" fill="#ff8fa3" opacity=".55"/>
${eyes}${mouth}
</svg>`;
  return svgUri(svg);
}
