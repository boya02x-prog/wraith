import { DOCS } from "./index";
import { headingsOf, plain } from "./headings";
import type { Block } from "./types";

// The search index for the docs box. Loaded only when someone opens the search (see components/docs/DocsShell.tsx), so the article pages stay light.
// Each page is cut into one entry for the page itself and one for every heading, so a result opens the exact section, not just the page.
export type Entry = {
  slug: string;
  page: string;
  group: string;
  /** null for the entry that stands for the whole page */
  heading: string | null;
  id: string | null;
  text: string;
  /** lowercased page title + heading + text, what the search looks in */
  hay: string;
};

function textOfBlock(b: Block): string {
  switch (b.t) {
    case "p":
    case "code":
      return plain(b.text);
    case "ul":
    case "ol":
      return b.items.map(plain).join(" · ");
    case "steps":
      return b.items.map((s) => `${plain(s.title)}. ${plain(s.text)}`).join(" ");
    case "callout":
      return `${b.title ? plain(b.title) + ". " : ""}${plain(b.text)}`;
    case "table":
      return b.rows.map((r) => r.map(plain).join(": ")).join(" · ");
    default:
      return "";
  }
}

function build(): Entry[] {
  const out: Entry[] = [];
  for (const d of DOCS) {
    const hs = headingsOf(d);
    let cur: { heading: string | null; id: string | null; text: string[] } = { heading: null, id: null, text: [plain(d.lead)] };
    const flush = () => {
      const text = cur.text.filter(Boolean).join(" ");
      if (!text && !cur.heading) return;
      out.push({ slug: d.slug, page: d.title, group: d.group, heading: cur.heading, id: cur.id, text, hay: `${d.title} ${cur.heading ?? ""} ${text}`.toLowerCase() });
    };
    d.blocks.forEach((b, i) => {
      if (b.t === "h2" || b.t === "h3") {
        flush();
        const h = hs.find((x) => x.at === i);
        cur = { heading: h ? h.text : plain(b.text), id: h ? h.id : null, text: [] };
      } else cur.text.push(textOfBlock(b));
    });
    flush();
  }
  return out;
}

export const INDEX: Entry[] = build();

export type Hit = { entry: Entry; score: number };

/** Every word you type has to appear; titles and headings count for more than body text; at most three results per page. */
export function search(query: string, limit = 12): Hit[] {
  const terms = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const e of INDEX) {
    if (!terms.every((t) => e.hay.includes(t))) continue;
    const title = e.page.toLowerCase();
    const head = (e.heading ?? "").toLowerCase();
    const body = e.text.toLowerCase();
    const isPage = e.heading === null;
    let score = 0;
    for (const t of terms) {
      // the title belongs to the page entry; for a section it only counts a little (every section of the page shares it)
      if (title.startsWith(t)) score += isPage ? 20 : 4;
      else if (title.includes(t)) score += isPage ? 14 : 3;
      if (head.startsWith(t)) score += 12;
      else if (head.includes(t)) score += 8;
      let n = 0;
      let from = 0;
      while (n < 4 && (from = body.indexOf(t, from)) !== -1) { n++; from += t.length; }
      score += n;
    }
    if (isPage) score += 2; // the page itself ahead of one of its sections on a tie
    hits.push({ entry: e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const perPage = new Map<string, number>();
  const out: Hit[] = [];
  for (const h of hits) {
    const n = perPage.get(h.entry.slug) ?? 0;
    if (n >= 3) continue;
    perPage.set(h.entry.slug, n + 1);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** A short piece of the text around the first word that matched. */
export function snippet(text: string, query: string, width = 150): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const low = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = low.indexOf(t); if (i !== -1 && (at === -1 || i < at)) at = i; }
  if (text.length <= width) return text;
  const start = Math.max(0, (at === -1 ? 0 : at) - 40);
  const cut = text.slice(start, start + width).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + width < text.length ? "…" : ""}`;
}
