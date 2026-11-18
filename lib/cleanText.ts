/** Token names/symbols come from anyone who can launch a token. Strip control/zero-width chars,
 *  collapse whitespace/newlines and cap the length so a spam token cannot break the layout. */
/** Some token sources hand names over HTML-escaped ("Jason &amp; Lucia"). Show them as typed. React escapes text on render, so this is safe. */
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescapeEntities = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export function cleanText(v: unknown, max: number): string {
  const s = unescapeEntities(String(v ?? ""))
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max).trimEnd() + "..." : s;
}
export const cleanSym = (v: unknown) => cleanText(v, 12);
export const cleanName = (v: unknown) => cleanText(v, 28);
