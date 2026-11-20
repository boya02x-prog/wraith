"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
import type { Hit } from "@/lib/docs/search";

type Mod = typeof import("@/lib/docs/search");
export type NavGroup = { group: string; items: { slug: string; title: string }[] };

const POPULAR = ["quickstart", "deposit", "buying-selling", "exits", "security", "faq"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// the index is a separate chunk: it is fetched the first time the box opens, not with every page, and kept after that
let loaded: Mod | null = null;

function Marked({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.map(esc).join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

/** The search box: opens over the page, finds sections as you type, and jumps to the exact heading. Mounted only while it is open. */
export default function DocsSearch({ onClose, nav }: { onClose: () => void; nav: NavGroup[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const [mod, setMod] = useState<Mod | null>(loaded);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    if (!loaded) void import("@/lib/docs/search").then((m) => { loaded = m; setMod(m); });
    // the page behind does not scroll while the box is open
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { window.clearTimeout(t); root.style.overflow = was; };
  }, []);

  const terms = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const hits: Hit[] = useMemo(() => (mod && terms.length ? mod.search(q) : []), [mod, q, terms.length]);
  const popular = useMemo(() => {
    const all = nav.flatMap((g) => g.items);
    return POPULAR.map((s) => all.find((i) => i.slug === s)).filter((i): i is { slug: string; title: string } => !!i);
  }, [nav]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest" });
  }, [cur, hits]);

  const hrefOf = (h: Hit) => `/docs/${h.entry.slug}${h.entry.id ? `#${h.entry.id}` : ""}`;
  const go = (href: string) => { onClose(); router.push(href); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(c + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && hits[cur]) { e.preventDefault(); go(hrefOf(hits[cur])); }
  };

  return (
    <div className="dx-find-wrap" role="dialog" aria-modal="true" aria-label="Search the docs" onKeyDown={onKey}>
      <div className="dx-find-scrim" onClick={onClose} />
      <div className="dx-find-box">
        <div className="dx-find-in">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCur(0); }}
            placeholder="Search the docs"
            inputMode="search"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search the docs"
          />
          <button type="button" className="dx-find-x" onClick={onClose} aria-label="Close search"><X size={18} /></button>
        </div>

        <div className="dx-find-body">
          {!terms.length && (
            <>
              <p className="dx-find-label">Popular</p>
              <ul className="dx-find-pop">
                {popular.map((p) => (
                  <li key={p.slug}><button type="button" onClick={() => go(`/docs/${p.slug}`)}>{p.title}</button></li>
                ))}
              </ul>
            </>
          )}
          {!!terms.length && !mod && <p className="dx-find-empty">Loading…</p>}
          {!!terms.length && !!mod && !hits.length && (
            <p className="dx-find-empty">Nothing found for “{q.trim()}”. Try a shorter or different word, or browse the menu.</p>
          )}
          {!!hits.length && (
            <ul className="dx-find-list" ref={listRef} role="listbox">
              {hits.map((h, i) => {
                const e = h.entry;
                return (
                  <li key={`${e.slug}#${e.id ?? ""}`} role="option" aria-selected={i === cur}>
                    <button
                      type="button"
                      className={i === cur ? "on" : undefined}
                      onMouseMove={(ev) => { if (ev.movementX || ev.movementY) setCur(i); /* a still pointer under a list that just changed must not steal the arrow-key selection */ }}
                      onClick={() => go(hrefOf(h))}
                    >
                      <span className="t"><Marked text={e.heading ?? e.page} terms={terms} /></span>
                      <span className="p">{e.heading ? `${e.group} · ${e.page}` : e.group}</span>
                      {e.text && mod && <span className="s"><Marked text={mod.snippet(e.text, q)} terms={terms} /></span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="dx-find-keys" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd><CornerDownLeft size={11} /></kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
