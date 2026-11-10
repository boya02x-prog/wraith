// GET /api/signal-stats → Wraith's real call record, computed from every tracked call (peak vs. market cap when spotted).
import { NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { getDb } from "@/lib/mongoClient";
import type { SignalCall } from "@/lib/signalCalls";

export const dynamic = "force-dynamic";
let cache: { ts: number; body: unknown } | null = null;
const DAY = 86_400_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < 30_000) return edge(NextResponse.json(cache.body), 30, 120);
  try {
    const db = await getDb();
    const all = await db.collection<SignalCall>("signal_calls").find({ spottedAt: { $gt: Date.now() - 30 * DAY }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2 }).toArray();
    const peak = (c: SignalCall) => Math.max(c.peakMcap, c.lastMcap) / c.spottedMcap;
    const windowOf = (ms: number) => {
      const rows = all.filter((c) => c.spottedAt > Date.now() - ms);
      const n = rows.length;
      const hit = (x: number) => rows.filter((c) => peak(c) >= x).length;
      const sorted = rows.map(peak).sort((a, b) => a - b);
      return {
        calls: n,
        hit15: hit(1.5), hit2: hit(2), hit5: hit(5), hit10: hit(10),
        rate2: n ? Math.round((hit(2) / n) * 1000) / 10 : 0,
        rate15: n ? Math.round((hit(1.5) / n) * 1000) / 10 : 0,
        medianPeak: n ? Math.round(sorted[Math.floor(n / 2)] * 100) / 100 : 0,
        best: n ? Math.round(sorted[n - 1] * 100) / 100 : 0,
      };
    };
    const top = [...all].sort((a, b) => peak(b) - peak(a)).slice(0, 8).map((c) => ({
      address: c.address, chain: c.chain ?? "solana", symbol: c.symbol, imageUrl: c.imageUrl ?? null,
      x: Math.round(peak(c) * 100) / 100, spottedMcap: c.spottedMcap, peakMcap: Math.max(c.peakMcap, c.lastMcap), spottedAt: c.spottedAt,
    }));
    const body = { d1: windowOf(DAY), d7: windowOf(7 * DAY), d30: windowOf(30 * DAY), top, updatedAt: Date.now() };
    cache = { ts: Date.now(), body };
    return edge(NextResponse.json(body), 30, 120);
  } catch (e) {
    console.error("[signal-stats]", e);
    return NextResponse.json({ error: "stats unavailable" }, { status: 500 });
  }
}
