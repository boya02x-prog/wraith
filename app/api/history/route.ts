import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { checkLimit, lightWriteLimiter } from "@/lib/ratelimit";
import {
  ITokenHistory,
  McapSnapshot,
  TOKEN_HISTORY_COLLECTION,
} from "@/models/TokenHistory";

export const PEAK_GRACE_MS = 5 * 60 * 1000;

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const entries = await db
    .collection<ITokenHistory>(TOKEN_HISTORY_COLLECTION)
    .find({ userId: session.user.id })
    .sort({ seenAt: -1 })
    .limit(300)
    .toArray();

  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkLimit(lightWriteLimiter, `history:${session.user.id}`);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json();
  const {
    keyword,
    displayName,
    tokenSymbol,
    tokenImageUrl,
    contractAddress,
    celebMention,
    aiContext,
    platforms,
    mcap,
    // ── NEW quality fields ───────────────────────────────────────────────────
    twoXTier,
    aiScore,
    aiTier,
    crossPlatforms,
  } = body as {
    keyword: string;
    displayName?: string;
    tokenSymbol?: string;
    tokenImageUrl?: string;
    contractAddress?: string;
    celebMention?: string;
    aiContext?: string;
    platforms?: string[];
    mcap?: number;
    twoXTier?: string;
    aiScore?: number;
    aiTier?: "HOT" | "WATCH" | "SKIP";
    crossPlatforms?: number;
  };

  if (!keyword || typeof keyword !== "string" || keyword.length > 80)
    return NextResponse.json({ error: "keyword required" }, { status: 400 });

  const userId = session.user.id;
  const now = Date.now();
  const safeMcap = typeof mcap === "number" && mcap > 0 ? mcap : 0;

  const db = await getDb();
  const col = db.collection<ITokenHistory>(TOKEN_HISTORY_COLLECTION);

  const existing = await col.findOne({ userId, keyword });

  if (!existing) {
    // ── FIRST SIGHTING ───────────────────────────────────────────────────────
    const doc: ITokenHistory = {
      userId,
      keyword,
      displayName,
      tokenSymbol,
      tokenImageUrl,
      seenAt: now,
      contractAddress,
      celebMention,
      aiContext,
      platforms: platforms ?? [],
      initialMcap: safeMcap,
      peakMcap: safeMcap,
      peakMcapTs: now,
      currentMcap: safeMcap,
      snapshots: safeMcap > 0 ? [{ ts: now, mcap: safeMcap }] : [],
      lastChecked: now,
      createdAt: now,
      updatedAt: now,
      // ── quality fields saved on first sighting ───────────────────────────
      twoXTier: twoXTier ?? undefined,
      aiScore: typeof aiScore === "number" ? aiScore : undefined,
      aiTier: aiTier ?? undefined,
      crossPlatforms:
        typeof crossPlatforms === "number"
          ? crossPlatforms
          : (platforms?.length ?? 0),
    };
    await col.insertOne(doc);
    return NextResponse.json({ ok: true, isNew: true });
  } else {
    // ── RE-SIGHTING ──────────────────────────────────────────────────────────
    const $set: Partial<ITokenHistory> & Record<string, unknown> = {
      lastChecked: now,
      updatedAt: now,
    };

    if (safeMcap > 0) {
      $set.currentMcap = safeMcap;

      // FIX: Only update peak if the mcap is realistic relative to liquidity (if known)
      // or if it's not a massive outlier spike (>5x previous peak in one go)
      const isOutlier = existing.peakMcap > 0 && safeMcap > existing.peakMcap * 5 && (now - existing.peakMcapTs < 300000);
      
      if (safeMcap > existing.peakMcap && !isOutlier) {
        $set.peakMcap = safeMcap;
        $set.peakMcapTs = now;
      }

      const snaps: McapSnapshot[] = existing.snapshots ?? [];
      const last = snaps[snaps.length - 1] as McapSnapshot | undefined;
      const timeDiff = last ? now - last.ts : Infinity;
      const mcapChange = last
        ? Math.abs(safeMcap - last.mcap) / (last.mcap || 1)
        : 1;

      if (!last || timeDiff > 1_800_000 || mcapChange > 0.05) {
        const updated = [...snaps, { ts: now, mcap: safeMcap }];
        $set.snapshots = updated.length > 48 ? updated.slice(-48) : updated;
      }
    }

    if (displayName && !existing.displayName) $set.displayName = displayName;
    if (tokenSymbol && !existing.tokenSymbol) $set.tokenSymbol = tokenSymbol;
    if (tokenImageUrl && !existing.tokenImageUrl)
      $set.tokenImageUrl = tokenImageUrl;
    if (celebMention && !existing.celebMention)
      $set.celebMention = celebMention;
    if (aiContext && !existing.aiContext) $set.aiContext = aiContext;
    if (contractAddress && !existing.contractAddress)
      $set.contractAddress = contractAddress;

    await col.updateOne({ userId, keyword }, { $set });
    return NextResponse.json({ ok: true, isNew: false });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword");
  if (!keyword)
    return NextResponse.json({ error: "keyword required" }, { status: 400 });

  const db = await getDb();
  await db
    .collection<ITokenHistory>(TOKEN_HISTORY_COLLECTION)
    .deleteOne({ userId: session.user.id, keyword });

  return NextResponse.json({ ok: true });
}
