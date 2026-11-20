import type { MetadataRoute } from "next";
import { DOCS } from "@/lib/docs";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: "https://www.wraith.farm", lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: "https://www.wraith.farm/docs", lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...DOCS.map((d) => ({ url: `https://www.wraith.farm/docs/${d.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: "https://www.wraith.farm/privacy", lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: "https://www.wraith.farm/terms", lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
