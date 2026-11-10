import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import {
  ITokenHistory,
  McapSnapshot,
  TOKEN_HISTORY_COLLECTION,
} from "@/models/TokenHistory";
import { checkLimit, lightWriteLimiter } from "@/lib/ratelimit";

// ─── POST /api/history/refresh ────────────────────────────────────────────────
// Bulk-updates currentMcap + peakMcap for multiple tokens at once.
// Called by WinsPanel after fetching fresh prices from DexScreener.
// Body: { updates: { keyword: string; mcap: number }[] }
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkLimit(lightWriteLimiter, `refresh:${session.user.id}`);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let parsed: { updates?: { keyword: string; mcap: number }[] };
  try { parsed = (await req.json()) as { updates?: { keyword: string; mcap: number }[] }; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  // only well-formed rows, and a sane number of them per call
  const updates = (Array.isArray(parsed.updates) ? parsed.updates : [])
    .filter((u) => u && typeof u.keyword === "string" && u.keyword.length <= 80 && typeof u.mcap === "number" && Number.isFinite(u.mcap))
    .slice(0, 200);

  if (updates.length === 0)
    return NextResponse.json({ ok: true, updated: 0 });

  const userId = session.user.id;
  const now = Date.now();

  const db = await getDb();
  const col = db.collection<ITokenHistory>(TOKEN_HISTORY_COLLECTION);

  // Fetch all relevant existing docs in one query
  const keywords = updates.map((u) => u.keyword);
  const existing = await col
    .find({ userId, keyword: { $in: keywords } })
    .toArray();
  const existingMap = new Map(existing.map((e) => [e.keyword, e]));

  // Build individual updateOne ops — no bulkWrite abstraction needed
  const ops = await Promise.all(
    updates
      .filter((u) => u.mcap > 0)
      .map((u) => {
        const entry = existingMap.get(u.keyword);
        if (!entry) return null;

        const $set: Partial<ITokenHistory> & Record<string, unknown> = {
          currentMcap: u.mcap,
          lastChecked: now,
          updatedAt: now,
        };

        if (u.mcap > entry.peakMcap) {
          $set.peakMcap = u.mcap;
          $set.peakMcapTs = now;
        }

        const snaps: McapSnapshot[] = entry.snapshots ?? [];
        const last = snaps[snaps.length - 1] as McapSnapshot | undefined;
        const timeDiff = last ? now - last.ts : Infinity;
        const mcapChange = last
          ? Math.abs(u.mcap - last.mcap) / (last.mcap || 1)
          : 1;

        if (!last || timeDiff > 1_800_000 || mcapChange > 0.05) {
          const updated = [...snaps, { ts: now, mcap: u.mcap }];
          $set.snapshots = updated.length > 48 ? updated.slice(-48) : updated;
        }

        return col.updateOne({ userId, keyword: u.keyword }, { $set });
      }),
  );

  const updated = ops.filter(Boolean).length;
  return NextResponse.json({ ok: true, updated });
}
