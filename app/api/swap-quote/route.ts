import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { quoteLimiter, checkLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

// Thin proxy to LI.FI so an API key (LIFI_API_KEY) can be added later without touching the client.
export const dynamic = "force-dynamic";
const OK = new Set(["fromChain", "toChain", "fromToken", "toToken", "fromAmount", "fromAddress", "toAddress", "slippage", "skipSimulation", "order", "denyExchanges", "denyBridges"]);

export async function GET(req: NextRequest) {
  // quotes spend our LI.FI quota (and carry the platform fee), so they are budgeted per account
  const session = await getAppSession().catch(() => null);
  const rl = await checkLimit(quoteLimiter, session?.user?.id ?? `ip:${clientIp(req)}`);
  if (!rl.success) return NextResponse.json({ error: "Too many quote requests" }, { status: 429 });
  const incoming = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of incoming) if (OK.has(k) && v.length < 80) q.set(k, v);
  if (!q.get("fromChain") || !q.get("toChain") || !q.get("fromToken") || !q.get("toToken") || !q.get("fromAmount") || !q.get("fromAddress")) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }
  if (incoming.get("status")) q.set("status", "1");
  // Platform fee on every EVM trade, collected by LI.FI into the Wraith fee wallet (set up once in the LI.FI partner portal).
  // OFF until BOTH env vars exist, so nothing changes by accident:
  //   LIFI_INTEGRATOR   = your integrator name registered at portal.li.fi (this is where the fee wallet is configured)
  //   PLATFORM_FEE_BPS  = fee in basis points, e.g. 100 = 1%, 150 = 1.5%
  // The fee is decided here on the server, so a browser can't ask for a lower one.
  const integrator = process.env.LIFI_INTEGRATOR;
  const feeBps = Number(process.env.PLATFORM_FEE_BPS);
  if (integrator && Number.isFinite(feeBps) && feeBps > 0 && feeBps <= 500) {
    q.set("integrator", integrator);
    q.set("fee", String(feeBps / 10_000));
  }
  try {
    const res = await fetch(`https://li.quest/v1/quote?${q}`, {
      headers: { accept: "application/json", ...(process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "quote service unreachable" }, { status: 502 });
  }
}
