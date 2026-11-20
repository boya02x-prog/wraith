// The documentation is plain data: a list of pages, each a list of blocks. app/docs renders it. To change the docs, edit the files in lib/docs and nothing else.
// Inside text: **bold**, `code` and [label](/docs/some-page) links work.
export type Block =
  | { t: "p"; text: string }
  | { t: "h2"; text: string }
  | { t: "h3"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "steps"; items: { title: string; text: string }[] }
  | { t: "callout"; kind: "note" | "tip" | "warn"; title?: string; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "code"; text: string };

export type DocPage = {
  slug: string;
  title: string;
  /** one or two sentences under the title; also what the search shows */
  lead: string;
  group: string;
  blocks: Block[];
};
