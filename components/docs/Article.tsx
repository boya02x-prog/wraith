import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight, Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { DocPage } from "@/lib/docs/types";
import { headingsOf } from "@/lib/docs/headings";
import { neighbours } from "@/lib/docs";
import Inline from "./Inline";
import Toc from "./Toc";

const CALLOUT_ICON = { note: Info, tip: Lightbulb, warn: TriangleAlert } as const;

/** One documentation page: breadcrumb, title, lead, the blocks, then Previous / Next. Server-rendered, so every page is plain HTML. */
export default function Article({ page }: { page: DocPage }) {
  const heads = headingsOf(page);
  const idAt = new Map(heads.map((h) => [h.at, h.id]));
  const { prev, next } = neighbours(page.slug);
  return (
    <>
      <article className="dx-article">
        <nav className="dx-crumb" aria-label="Breadcrumb">
          <Link href="/docs">Docs</Link>
          <ChevronRight size={14} aria-hidden="true" />
          <span>{page.group}</span>
        </nav>
        <h1 className="dx-h1">{page.title}</h1>
        <p className="dx-lead">{page.lead}</p>

        {heads.filter((h) => h.level === 2).length > 1 && (
          <details className="dx-mtoc">
            <summary>On this page</summary>
            <ul>
              {heads.map((h) => (
                <li key={h.id} className={h.level === 3 ? "sub" : undefined}><a href={`#${h.id}`}>{h.text}</a></li>
              ))}
            </ul>
          </details>
        )}

        {page.blocks.map((b, i) => {
          switch (b.t) {
            case "p":
              return <p key={i}><Inline text={b.text} /></p>;
            case "h2":
              return (
                <h2 key={i} id={idAt.get(i)} className="dx-h2">
                  <Inline text={b.text} />
                  <a className="dx-hash" href={`#${idAt.get(i)}`} aria-label="Link to this section">#</a>
                </h2>
              );
            case "h3":
              return (
                <h3 key={i} id={idAt.get(i)} className="dx-h3">
                  <Inline text={b.text} />
                  <a className="dx-hash" href={`#${idAt.get(i)}`} aria-label="Link to this section">#</a>
                </h3>
              );
            case "ul":
              return <ul key={i} className="dx-ul">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
            case "ol":
              return <ol key={i} className="dx-ol">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
            case "steps":
              return (
                <ol key={i} className="dx-steps">
                  {b.items.map((s, j) => (
                    <li key={j}>
                      <strong><Inline text={s.title} /></strong>
                      <span><Inline text={s.text} /></span>
                    </li>
                  ))}
                </ol>
              );
            case "callout": {
              const Icon = CALLOUT_ICON[b.kind];
              return (
                <aside key={i} className={`dx-callout ${b.kind}`}>
                  <Icon size={18} aria-hidden="true" />
                  <div>
                    {b.title && <strong>{b.title}</strong>}
                    <p><Inline text={b.text} /></p>
                  </div>
                </aside>
              );
            }
            case "table":
              return (
                <div key={i} className="dx-table" tabIndex={0}>
                  <table>
                    <thead><tr>{b.head.map((h, j) => <th key={j} scope="col">{h}</th>)}</tr></thead>
                    <tbody>
                      {b.rows.map((r, j) => (
                        <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            case "code":
              return <pre key={i} className="dx-pre"><code>{b.text}</code></pre>;
          }
        })}

        <nav className="dx-pn" aria-label="Previous and next page">
          {prev ? (
            <Link href={`/docs/${prev.slug}`} className="prev"><small><ArrowLeft size={14} aria-hidden="true" /> Previous</small><b>{prev.title}</b></Link>
          ) : <span />}
          {next ? (
            <Link href={`/docs/${next.slug}`} className="next"><small>Next <ArrowRight size={14} aria-hidden="true" /></small><b>{next.title}</b></Link>
          ) : <span />}
        </nav>

        <p className="dx-foot">
          Wraith shows facts and readings, not advice. Tokens are high risk and you can lose everything you put in. See{" "}
          <Link href="/docs/risk">Risk and good habits</Link>.
        </p>
      </article>
      <Toc heads={heads} />
    </>
  );
}
