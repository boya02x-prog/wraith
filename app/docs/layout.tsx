import type { Metadata } from "next";
import DocsShell from "@/components/docs/DocsShell";
import { DOCS, GROUPS } from "@/lib/docs";
import "./docs.css";

export const metadata: Metadata = {
  title: { default: "Docs", template: "%s | Wraith docs" },
  description: "How Wraith works and how to use it properly: deposits, scanner, trading, exits, alerts, profile, safety and more.",
  alternates: { canonical: "/docs" },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  // only the titles go to the menu (a few KB); the text of the pages stays in the pages, and the search index loads when the search opens
  const nav = GROUPS.map((group) => ({ group, items: DOCS.filter((d) => d.group === group).map((d) => ({ slug: d.slug, title: d.title })) }));
  return <DocsShell nav={nav}>{children}</DocsShell>;
}
