import type { DocPage } from "./types";
import { START } from "./start";
import { MONEY } from "./money";
import { DISCOVER } from "./discover";
import { TRADE } from "./trade";
import { YOU } from "./you";
import { SAFETY } from "./safety";
import { HELP } from "./help";

export type { Block, DocPage } from "./types";

/** Every page in reading order. The sidebar, the previous/next links, the search (lib/docs/search.ts) and the sitemap all come from this list. */
export const DOCS: DocPage[] = [...START, ...MONEY, ...DISCOVER, ...TRADE, ...YOU, ...SAFETY, ...HELP];

export const GROUPS: string[] = Array.from(new Set(DOCS.map((d) => d.group)));

export const bySlug = (slug: string): DocPage | undefined => DOCS.find((d) => d.slug === slug);

export function neighbours(slug: string): { prev: DocPage | null; next: DocPage | null } {
  const i = DOCS.findIndex((d) => d.slug === slug);
  return { prev: i > 0 ? DOCS[i - 1] : null, next: i >= 0 && i < DOCS.length - 1 ? DOCS[i + 1] : null };
}
