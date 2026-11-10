import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { Collection } from "mongodb";
import { ITokenHistory, TOKEN_HISTORY_COLLECTION } from "@/models/TokenHistory";
import { checkLimit, lightWriteLimiter } from "@/lib/ratelimit";

// ─── POST /api/ai-score ───────────────────────────────────────────────────────
// Scores a new token candidate against your historical win patterns.
//
// $0 BUDGET VERSION — the old flow called the Claude API on every single
// isNew:true sighting, which at meme-coin sighting velocity was a real,
// ongoing dollar cost for something a weighted heuristic does in <1ms for
// free. That LLM call has been removed entirely. This route is now pure
// heuristic scoring — no external API calls of any kind, no network cost,
// no per-token dollar cost, ever.
//
// It still learns from your win history (same win-definition logic as
// before: peakMcap >= 2x initialMcap, with the grace-period/current-price
// corroboration checks), it just uses that history to bias the heuristic
// weights slightly instead of feeding it into a prompt.
//
// Score 0–100:
//   >= 70 → HOT SIGNAL — louder Telegram alert, top of scanner
//   40–69 → WATCH — tracked silently, alert if it starts moving
//   < 40  → SKIP — still recorded but no alert
//
// Called from recordTokenSighting AFTER /api/history returns isNew: true.

interface ScoreRequest {
  keyword: string;
  contractAddress: string;
  mcap: number;
  tier: string; // twoXTier from scanner
  platforms: string[];
  celebMention?: string;
  aiContext?: string;
  liquidity?: number;
  priceChange24h?: number;
  crossPlatforms?: number;
}

interface ScoreResponse {
  score: number;
  tier: "HOT" | "WATCH" | "SKIP";
  reason: string;
}

function calcMultiplier(init: number, peak: number): number {
  return !init ? 0 : peak / init;
}

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkLimit(lightWriteLimiter, `score:${session.user.id}`);
  if (!rl.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: ScoreRequest;
  try { body = (await req.json()) as ScoreRequest; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (typeof body.keyword !== "string" || body.keyword.length > 80 || !body.contractAddress) {
    return NextResponse.json(
      { error: "keyword and contractAddress required" },
      { status: 400 },
    );
  }

  const userId = session.user.id;

  try {
    const db = await getDb();
    const col: Collection<ITokenHistory> = db.collection<ITokenHistory>(
      TOKEN_HISTORY_COLLECTION,
    );

    // ── 1. Fetch historical wins ──────────────────────────────────────────
    // Kept purely so the heuristic can lean on real win-rate stats (celeb
    // hit rate, mcap sweet spot) instead of guessed weights. Still zero
    // external cost — this is your own Mongo data.
    const PEAK_GRACE_MS = 5 * 60 * 1000;
    const allHistory = await col
      .find({ userId, initialMcap: { $gt: 0 }, peakMcap: { $gt: 0 } })
      .sort({ seenAt: -1 })
      .limit(200)
      .toArray();

    const wins = allHistory.filter((e) => {
      const mult = calcMultiplier(e.initialMcap, e.peakMcap);
      if (mult < 2) return false;
      if (e.peakMcapTs > e.seenAt + PEAK_GRACE_MS) return true;
      if (e.currentMcap >= e.initialMcap * 1.5) return true;
      if (e.peakMcapTs > 0 && e.peakMcap >= e.initialMcap * 1.5) return true;
      return false;
    });

    const result = heuristicScore(body, wins);
    await persistScore(col, userId, body.keyword, result);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai-score] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─── Persist aiScore + aiTier to token doc ────────────────────────────────────
async function persistScore(
  col: Collection<ITokenHistory>,
  userId: string,
  keyword: string,
  result: ScoreResponse,
) {
  try {
    await col.updateOne(
      { userId, keyword },
      {
        $set: {
          aiScore: result.score,
          aiTier: result.tier,
          updatedAt: Date.now(),
        },
      },
    );
  } catch {
    // silent — scoring is non-blocking
  }
}

// ─── Heuristic scorer (now the ONLY scorer) ───────────────────────────────────
// Same rule weights as the old fallback, plus a reason-string builder so you
// don't lose the "why" context that used to come from Claude's sentence.
// Every branch that adds/subtracts points also records a short reason
// fragment; the top contributing fragments get joined into the final reason.
function heuristicScore(c: ScoreRequest, wins: ITokenHistory[]): ScoreResponse {
  let score = 40;
  const reasons: { pts: number; text: string }[] = [];

  if (c.tier === "ULTRA") {
    score += 20;
    reasons.push({ pts: 20, text: "ULTRA tier" });
  } else if (c.tier === "HIGH") {
    score += 12;
    reasons.push({ pts: 12, text: "HIGH tier" });
  } else if (c.tier === "MEDIUM") {
    score += 4;
    reasons.push({ pts: 4, text: "MEDIUM tier" });
  }

  if (c.celebMention) {
    score += 15;
    reasons.push({ pts: 15, text: "celeb mention" });
  }

  if (c.mcap >= 3_000 && c.mcap <= 50_000) {
    score += 15;
    reasons.push({ pts: 15, text: "sweet-spot mcap" });
  } else if (c.mcap > 50_000 && c.mcap <= 150_000) {
    score += 5;
    reasons.push({ pts: 5, text: "decent mcap range" });
  } else if (c.mcap > 200_000) {
    score -= 10;
    reasons.push({ pts: -10, text: "mcap too high" });
  }

  const platCount = c.platforms.length;
  if (platCount >= 3) {
    score += 10;
    reasons.push({ pts: 10, text: `${platCount} platforms` });
  } else if (platCount === 2) {
    score += 5;
    reasons.push({ pts: 5, text: "2 platforms" });
  }

  if ((c.crossPlatforms ?? 0) >= 3) {
    score += 8;
    reasons.push({ pts: 8, text: "cross-platform confirmed" });
  }

  const p24 = c.priceChange24h ?? 0;
  if (p24 > 50 && p24 < 300) {
    score += 5;
    reasons.push({ pts: 5, text: "healthy momentum" });
  }
  if (p24 > 500) {
    score -= 10;
    reasons.push({ pts: -10, text: "likely already pumped" });
  }
  if (p24 < -50) {
    score -= 8;
    reasons.push({ pts: -8, text: "sharp drawdown" });
  }

  // ── Win-history bias — free, uses only your own Mongo data ─────────────
  // If you have enough win history, nudge the score based on how closely
  // this candidate's mcap/celeb profile matches what's actually worked.
  if (wins.length >= 3) {
    const celebWins = wins.filter((w) => !!w.celebMention).length;
    const celebHitRate = celebWins / wins.length;
    if (c.celebMention && celebHitRate > 0.5) {
      score += 5;
      reasons.push({ pts: 5, text: "matches your celeb win pattern" });
    }

    const avgWinMcap =
      wins.reduce((s, w) => s + w.initialMcap, 0) / wins.length;
    if (avgWinMcap > 0) {
      const ratio = c.mcap / avgWinMcap;
      if (ratio >= 0.3 && ratio <= 3) {
        score += 5;
        reasons.push({ pts: 5, text: "mcap near your avg win" });
      }
    }
  }

  score = Math.max(0, Math.min(100, score));
  const tier: "HOT" | "WATCH" | "SKIP" =
    score >= 70 ? "HOT" : score >= 40 ? "WATCH" : "SKIP";

  // Build reason from the top 2 contributing fragments by absolute weight.
  const topReasons = reasons
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, 2)
    .map((r) => r.text);
  const reason =
    topReasons.length > 0
      ? topReasons.join(" + ").slice(0, 100)
      : "Baseline heuristic score";

  return { score, tier, reason };
}
