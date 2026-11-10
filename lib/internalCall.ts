// lib/internalCall.ts  (server only)
// Call another route's GET handler in-process. A server-side fetch() to our own public URL goes through proxy.ts with no
// session cookie and comes back 401 (that is why the scanner's market lane, the tape and the Telegram alert cron were
// silently empty). Calling the handler directly skips the network, the auth gate and an extra cold function.
import { NextRequest } from "next/server";

type GetModule = { GET: (req: NextRequest) => Promise<Response> };

export async function callGet<T>(load: () => Promise<GetModule>, url: string, ms = 15_000): Promise<T> {
  const mod = await load();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      // the header tells a route "a server job is calling you, not a browser": the scanner then finishes its database
      // writes before answering, so the Telegram cron sees the calls it just recorded
      mod.GET(new NextRequest(url, { headers: { "x-wraith-internal": "1" } })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); }),
    ]);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
