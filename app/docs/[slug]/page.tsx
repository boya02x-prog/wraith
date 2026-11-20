import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Article from "@/components/docs/Article";
import { DOCS, bySlug } from "@/lib/docs";

export const dynamicParams = false; // only the pages in lib/docs exist; anything else is a 404

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = bySlug(slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.lead,
    alternates: { canonical: `/docs/${page.slug}` },
    openGraph: { type: "article", title: `${page.title} | Wraith docs`, description: page.lead, url: `/docs/${page.slug}`, siteName: "Wraith" },
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = bySlug(slug);
  if (!page) notFound();
  return <Article key={page.slug} page={page} />;
}
