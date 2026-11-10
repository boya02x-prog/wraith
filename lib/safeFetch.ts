import { lookup } from "dns/promises";
import net from "net";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (v4 + v6). */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::" || l === "::1") return true;
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb") || l.startsWith("ff");
  }
  return true;
}

/** Parses a URL and rejects anything that is not plain public https/http (no creds, no odd ports, no private hosts). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad protocol");
  if (u.username || u.password) throw new Error("credentials in url");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("bad port");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("bad host");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("private address");
  } else {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("private address");
  }
  return u;
}

/**
 * Server-side image fetch that is safe to point at user-supplied URLs: public hosts only, redirects re-validated,
 * size capped, must be an image. Returns null on any failure.
 */
export async function safeFetchImage(
  raw: string,
  opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<{ buf: Buffer; type: string } | null> {
  const maxBytes = opts.maxBytes ?? 4_000_000;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 6000);
  try {
    let url = (await assertPublicUrl(raw)).toString();
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(url, { signal, redirect: "manual", headers: opts.headers });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = (await assertPublicUrl(new URL(loc, url).toString())).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!type.startsWith("image/") || type.includes("svg")) return null;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) return null;
      const reader = res.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) { await reader.cancel(); return null; }
        chunks.push(Buffer.from(value));
      }
      return { buf: Buffer.concat(chunks), type };
    }
    return null;
  } catch {
    return null;
  }
}
