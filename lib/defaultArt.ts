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

/** Seeded ghost avatar on a dark disc. */
export function defaultAvatar(seed: string): string {
  const h = hash(seed || "wraith");
  const [bright, mid, deep] = PALETTES[h % PALETTES.length];
  const look = (h >> 5) % 3; // eye style
  const eyes = look === 0
    ? `<circle cx="26" cy="29" r="3.6" fill="#0a0a0b"/><circle cx="38" cy="29" r="3.6" fill="#0a0a0b"/>`
    : look === 1
      ? `<rect x="22.5" y="26" width="7" height="6" rx="3" fill="#0a0a0b"/><rect x="34.5" y="26" width="7" height="6" rx="3" fill="#0a0a0b"/>`
      : `<path d="M22 31l4-5 4 5zM34 31l4-5 4 5z" fill="#0a0a0b"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs>
<radialGradient id="b" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="#0a0a0b"/></radialGradient>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bright}"/><stop offset="1" stop-color="${mid}"/></linearGradient>
</defs>
<rect width="64" height="64" fill="url(#b)"/>
<ellipse cx="32" cy="60" rx="18" ry="4" fill="${mid}" opacity=".25"/>
<path d="M32 10c-10 0-17 7.5-17 17v24l5.6-4.6 5.7 4.6 5.7-4.6 5.7 4.6 5.7-4.6L49 51V27C49 17.5 42 10 32 10z" fill="url(#g)"/>
${eyes}
</svg>`;
  return svgUri(svg);
}
