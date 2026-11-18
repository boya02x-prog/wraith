// GET /api/tape → Wraith's own live tape: top signals, recent winners, and the 7-day call record. 20s cache.
import { after, NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { getDb } from "@/lib/mongoClient";
import type { SignalCall } from "@/lib/signalCalls";
import type { Signal } from "@/app/api/signals/route";
import { callGet } from "@/lib/internalCall";

let cache: { ts: number; body: unknown } | null = null;
let building: Promise<unknown> | null = null;
const FRESH_MS = 20_000;
const KEEP_MS = 10 * 60_000; // an answer up to 10 minutes old is still better than making a visitor wait 5-12 seconds

export async function GET(req: NextRequest) {
  // Stale-while-revalidate: the bar answers instantly from the last result; ONE rebuild runs in the background when it is older than 20 s.
  if (cache && Date.now() - cache.ts < KEEP_MS) {
    if (Date.now() - cache.ts >= FRESH_MS && !building) {
      building = build(req.nextUrl.origin).catch(() => undefined).finally(() => { building = null; });
      after(() => building ?? undefined);
    }
    return edge(NextResponse.json(cache.body), 20, 60);
  }
  const body = await build(req.nextUrl.origin);
  return edge(NextResponse.json(body), 20, 60);
}

async function build(origin: string): Promise<unknown> {
  let signals: Signal[] = [];
  try {
    // in-process: a server-side fetch to our own URL has no session cookie and gets a 401 from the sign-in gate
    signals = (await callGet<{ signals?: Signal[] }>(() => import("@/app/api/signals/route"), `${origin}/api/signals`, 20_000)).signals ?? [];
  } catch { /* tape still shows wins */ }

  let wins: { address: string; chain: string; symbol: string; x: number; mcap: number }[] = [];
  let stats = { calls: 0, hit2: 0, rate: 0 };
  try {
    const db = await getDb();
    const calls = await db.collection<SignalCall>("signal_calls").find({ spottedAt: { $gt: Date.now() - 7 * 86_400_000 }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2 }).toArray();
    const px = (c: SignalCall) => c.peakMcap / c.spottedMcap;
    const hit2 = calls.filter((c) => px(c) >= 2).length;
    stats = { calls: calls.length, hit2, rate: calls.length ? Math.round((hit2 / calls.length) * 100) : 0 };
    wins = calls
      .filter((c) => px(c) >= 1.5 && c.spottedAt > Date.now() - 48 * 3_600_000)
      .sort((a, b) => px(b) - px(a))
      .slice(0, 6)
      .map((c) => ({ address: c.address, chain: c.chain ?? "solana", symbol: c.symbol, x: Math.round(px(c) * 100) / 100, mcap: c.lastMcap }));
  } catch { /* db optional */ }

  const body = {
    signals: signals.slice(0, 10).map((s) => ({ address: s.token.address, chain: s.token.chain ?? "solana", symbol: s.token.symbol, imageUrl: s.token.imageUrl, score: s.score, tier: s.tier, mcap: s.token.mcap, h1: s.token.change.h1 })),
    wins,
    stats,
  };
  cache = { ts: Date.now(), body };
  return body;
}
