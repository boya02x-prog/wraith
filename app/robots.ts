import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/privacy", "/terms"], disallow: ["/api/", "/app", "/login", "/access"] }],
    sitemap: "https://www.wraith.farm/sitemap.xml",
    host: "https://www.wraith.farm",
  };
}
