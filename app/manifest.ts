import type { MetadataRoute } from "next";

// Makes WRAITH installable ("Add to Home Screen" / "Install app") on Android and iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wraith",
    short_name: "Wraith",
    description: "Scan new tokens, spot the ones with real upside, trade across seven chains.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0c0d",
    theme_color: "#0c0c0d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
