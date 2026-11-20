import { NextRequest, NextResponse } from "next/server";
import { HUMAN_COOKIE, HUMAN_HOURS, humanGateOn, signHuman, verifyTurnstile } from "@/lib/humanGate";
import { checkLimit, humanCheckLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

// The browser sends the token the Cloudflare widget produced; if Cloudflare says it is real, this browser gets the "passed" cookie (lib/humanGate.ts).
export async function POST(request: NextRequest) {
  if (!humanGateOn()) return NextResponse.json({ ok: true, off: true });
  const ip = clientIp(request);
  const rl = await checkLimit(humanCheckLimiter, `human:${ip}`);
  if (!rl.success) return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });

  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.slice(0, 2048) : "";
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!(await verifyTurnstile(token, ip))) return NextResponse.json({ error: "The check did not pass. Try again." }, { status: 403 });

  const cookie = await signHuman();
  if (!cookie) return NextResponse.json({ error: "The check is not set up on the server." }, { status: 500 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(HUMAN_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: HUMAN_HOURS * 3600 });
  return res;
}
