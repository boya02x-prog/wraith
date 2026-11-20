import type { Block, DocPage } from "./types";

export type Heading = { id: string; text: string; level: 2 | 3; at: number };

/** Remove the inline marks (**bold**, *italic*, `code`, [label](link)) and keep the words. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export function slugify(text: string): string {
  return (
    plain(text)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** Every h2 and h3 on a page, with a stable, unique id and the index of its block. The article and the "On this page" lists both read this. */
export function headingsOf(page: DocPage): Heading[] {
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  page.blocks.forEach((b: Block, at) => {
    if (b.t !== "h2" && b.t !== "h3") return;
    const base = slugify(b.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ id: n ? `${base}-${n + 1}` : base, text: plain(b.text), level: b.t === "h2" ? 2 : 3, at });
  });
  return out;
}
