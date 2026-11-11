// lib/defaultArt.ts
// Wraith-native default cover + avatar for profiles that have not uploaded their own. Pure functions returning SVG data
// URIs, seeded from a stable id so every user gets their own look and it never changes between renders.

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const svgUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

// warm Wraith palettes: [bright, mid, deep]
const PALETTES: [string, string, string][] = [
  ["#ffb27a", "#ff7b3d", "#4a1a08"], // ember orange
  ["#ffd27a", "#ffa62b", "#4a2f06"], // amber
  ["#ff9a8a", "#ff5a4d", "#4a120e"], // red
  ["#ffc2a0", "#e8845a", "#3b1a0f"], // copper
  ["#f7c9ff", "#c26bff", "#2f1049"], // violet
  ["#9ff0d4", "#2fd0a0", "#07352a"], // mint
];

/** Dark terminal-style banner (16:5). Looks the same for a given seed. */
export function defaultCover(seed: string): string {
  const h = hash(seed || "wraith");
  const [bright, mid] = PALETTES[h % PALETTES.length];
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const addr = `0x${hex(h)}${hex(hash(seed + "a"))}`.slice(0, 14);
  const gx = 40 + (h % 40);
  const lines = [
    [`$ wraith --init ${addr}`, bright],
    ["[ok] chains online: sol · eth · base · bnb", "#7a7a80"],
    ["[ok] wallet flow engine ready", "#7a7a80"],
    ["> ghost mode: on", mid],
    ["> awaiting first trade_", bright],
  ];
  const text = lines.map(([t, c], i) => `<text x="64" y="${112 + i * 40}" fill="${c}" font-size="22" font-family="ui-monospace,Menlo,Consolas,monospace">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 320" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#09090a"/><stop offset="1" stop-color="#150b06"/></linearGradient>
<radialGradient id="gl" cx="${gx}%" cy="105%" r="70%"><stop offset="0" stop-color="${mid}" stop-opacity=".30"/><stop offset="1" stop-color="${mid}" stop-opacity="0"/></radialGradient>
<pattern id="gr" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern>
<pattern id="sl" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity=".28"/></pattern>
</defs>
<rect width="1600" height="320" fill="url(#bg)"/><rect width="1600" height="320" fill="url(#gr)"/><rect width="1600" height="320" fill="url(#gl)"/>
<g opacity=".9">${text}</g>
<g transform="translate(1230 36)" opacity=".16" fill="none" stroke="${bright}" stroke-width="3"><path d="M120 20c-44 0-76 34-76 76v110l25-21 25 21 26-21 26 21 25-21 25 21V96c0-42-32-76-76-76z" transform="scale(1.1)"/><circle cx="100" cy="100" r="9" fill="${bright}"/><circle cx="150" cy="100" r="9" fill="${bright}"/></g>
<rect width="1600" height="320" fill="url(#sl)"/>
</svg>`;
  return svgUri(svg);
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
