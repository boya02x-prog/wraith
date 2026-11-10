/** Token names/symbols come from anyone who can launch a token. Strip control/zero-width chars,
 *  collapse whitespace/newlines and cap the length so a spam token cannot break the layout. */
export function cleanText(v: unknown, max: number): string {
  const s = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max).trimEnd() + "..." : s;
}
export const cleanSym = (v: unknown) => cleanText(v, 12);
export const cleanName = (v: unknown) => cleanText(v, 28);
