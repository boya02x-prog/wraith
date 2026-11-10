import path from "path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), payment=(), interest-cohort=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  // dev only: lets the Android emulator (which reaches this computer as 10.0.2.2) load the dev server
  allowedDevOrigins: ["10.0.2.2"],
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses are per-user or live data: never let a CDN/browser share-cache them by accident (routes can still override)
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  // Turbopack's on-disk dev cache gets corrupted on Windows (every route 404s until .next is deleted); keep it in memory only.
  experimental: { turbopackFileSystemCacheForDev: false },
  // native canvas for the Telegram banner route; its fonts live in assets/fonts and must ship with the function
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingIncludes: { "/api/banner": ["./assets/fonts/**/*", "./lib/shareCard.ts"] },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
