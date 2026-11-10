// app/api/signal-lab/route.ts
// Private calibration report. GET /api/signal-lab?key=CRON_SECRET
// For every tracked call (public + shadow) that has had time to play out, shows how often each indicator bucket reached 2x.
// Use it to see which indicators actually predict winners, and tune scoreToken / scoreIntel from data instead of guesses.

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Row = { tier?: string; shadow?: boolean; score: number; spottedMcap: number; peakMcap: number; lastMcap: number; features?: Record<string, number | null> };

const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.nextUrl.searchParams.get("key") !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const hours = Math.max(1, Math.min(168, Number(req.nextUrl.searchParams.get("matureHours")) || 4));
  const now = Date.now();
  const db = await getDb();
  const rows = (await db
    .collection<Row>("signal_calls")
    .find({ engine: 2, spottedMcap: { $gt: 0 }, spottedAt: { $lt: now - hours * 3_600_000 } }, { projection: { tier: 1, shadow: 1, score: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, features: 1 } })
    .limit(5000)
    .toArray()) as Row[];

  const mult = (r: Row) => Math.max(r.peakMcap, r.lastMcap) / r.spottedMcap;
  const summary = (list: Row[]) => {
    const wins = list.filter((r) => mult(r) >= 2).length;
    return { calls: list.length, hit2x: pct(wins, list.length), medianPeak: median(list.map(mult)) };
  };

  const features = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.features ?? {})) features.add(k);
  const byFeature: Record<string, { range: string; calls: number; hit2x: number | null; medianPeak: number | null }[]> = {};
  for (const f of features) {
    const have = rows.filter((r) => typeof r.features?.[f] === "number");
    if (have.length < 20) continue;
    const vals = have.map((r) => r.features![f] as number).sort((a, b) => a - b);
    const cuts = [0.25, 0.5, 0.75].map((q) => vals[Math.floor(vals.length * q)]);
    const buckets: Row[][] = [[], [], [], []];
    for (const r of have) {
      const v = r.features![f] as number;
      buckets[v < cuts[0] ? 0 : v < cuts[1] ? 1 : v < cuts[2] ? 2 : 3].push(r);
    }
    const edges = [vals[0], ...cuts, vals[vals.length - 1]];
    byFeature[f] = buckets.map((b, i) => ({ range: `${edges[i]}..${edges[i + 1]}`, ...summary(b) }));
  }

  return NextResponse.json({
    matureHours: hours,
    all: summary(rows),
    public: summary(rows.filter((r) => !r.shadow)),
    shadow: summary(rows.filter((r) => r.shadow)),
    byScore: [40, 50, 60, 70, 80].map((lo) => ({ scoreFrom: lo, ...summary(rows.filter((r) => r.score >= lo)) })),
    byFeature,
    note: "Quartile buckets of each indicator at call time vs. share that reached 2x. Needs ~100+ matured calls to mean anything.",
  });
}
