import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: "https://www.wraith.farm", lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: "https://www.wraith.farm/privacy", lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: "https://www.wraith.farm/terms", lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
