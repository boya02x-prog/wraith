// Best-effort caller IP for rate limiting anonymous endpoints. On Vercel the platform sets these headers itself (a client cannot
// forge them), elsewhere they are only as trustworthy as the proxy in front.
export function clientIp(req: Request): string {
  const h = req.headers;
  const ip = h.get("x-real-ip") || h.get("x-vercel-forwarded-for") || h.get("x-forwarded-for")?.split(",")[0] || "";
  return ip.trim().slice(0, 64) || "unknown";
}
