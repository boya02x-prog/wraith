// ─── RECORD TOKEN SIGHTING ────────────────────────────────────────────────────
// Fire-and-forget helper called by MemeScanner when a token passes quality gates.
// 1. POSTs to /api/history to persist the sighting (isNew check)
// 2. If isNew → POSTs to /api/ai-score to score the token vs win history
// 3. If isNew → POSTs to /api/alert/telegram with score included
//
// KEY BEHAVIORS:
// - Entry alert fires ONLY on first sighting (isNew: true from history route)
// - AI score runs on every new token — 0-100, HOT/WATCH/SKIP tier
// - HOT (>=70) = loud alert, top of scanner, shows in Live Signals
// - WATCH (40-69) = shows in Live Signals only if twoXTier is HIGH/ULTRA + 2+ platforms
// - SKIP (<40) = recorded but no alert, never shows in Live Signals

interface ScanResultLike {
  keyword: string;
  contractAddress?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  celebMention?: string;
  onCeleb?: boolean;
  aiContext?: string;
  platforms?: string[];
  mcap?: number;
  twoXTier?: string;
  crossPlatforms?: number;
  priceChange24h?: number;
  liquidity?: number;
}

const MIN_TRACK_MCAP = 2_000;
const MIN_TRACK_LIQUIDITY = 300;
const MIN_24H_CHANGE = -85;
const MAX_LIQ_TO_MCAP_RATIO = 0.6;

function isGarbageKeyword(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  const vowels = (kw.match(/[aeiou]/gi) ?? []).length;
  if (kw.length >= 8 && vowels === 0) return true;
  return false;
}

export async function recordTokenSighting(
  result: ScanResultLike,
): Promise<void> {
  if (!result.contractAddress) return;
  if (isGarbageKeyword(result.keyword)) return;

  const mcap = result.mcap ?? 0;
  if (mcap > 0 && mcap < MIN_TRACK_MCAP) return;
  if (mcap > 500_000) return;

  const hasOnchain = (result.platforms ?? []).some((p) =>
    ["pumpfun", "dexscreener", "birdeye"].includes(p),
  );
  const isCeleb = !!(result.celebMention ?? result.onCeleb);
  if (!hasOnchain && !isCeleb) return;

  const tier = result.twoXTier;
  if (!isCeleb) {
    if (!tier || tier === "LOW" || tier === "SKIP") return;
    if (tier === "MEDIUM" && (result.crossPlatforms ?? 0) < 2) return;
  } else {
    if (tier === "SKIP") return;
    if (!hasOnchain && tier === "LOW") return;
  }

  if ((result.priceChange24h ?? 0) < MIN_24H_CHANGE) return;

  const liq = result.liquidity ?? 0;
  if (liq > 0 && liq < MIN_TRACK_LIQUIDITY) return;
  if (mcap > 0 && liq > 0 && liq / mcap > MAX_LIQ_TO_MCAP_RATIO) return;

  const crossPlatforms =
    result.crossPlatforms ?? (result.platforms ?? []).length;

  const payload = {
    keyword: result.keyword,
    displayName: result.tokenName,
    tokenSymbol: result.tokenSymbol,
    tokenImageUrl: result.tokenImageUrl,
    contractAddress: result.contractAddress,
    celebMention: result.celebMention,
    aiContext: result.aiContext,
    platforms: result.platforms ?? [],
    mcap,
    // ── quality fields — used by LiveSignalsBar to filter ────────────────────
    twoXTier: tier ?? "MEDIUM",
    crossPlatforms,
  };

  // ── 1. Persist to history ─────────────────────────────────────────────────
  let isNewToken = false;
  try {
    const res = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      isNewToken = data.isNew === true;
    }
  } catch {
    // Silent fail — never block scan UI
  }

  // ── 2. Only proceed on first-ever sighting ────────────────────────────────
  if (!isNewToken) return;

  // ── 3. Get AI score for this token ────────────────────────────────────────
  let aiScore = 50;
  let aiTier: "HOT" | "WATCH" | "SKIP" = "WATCH";
  let aiReason = "";

  try {
    const scoreRes = await fetch("/api/ai-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: result.keyword,
        contractAddress: result.contractAddress,
        mcap,
        tier: tier ?? "MEDIUM",
        platforms: result.platforms ?? [],
        celebMention: result.celebMention,
        aiContext: result.aiContext,
        liquidity: result.liquidity,
        priceChange24h: result.priceChange24h,
        crossPlatforms,
      }),
    });
    if (scoreRes.ok) {
      const scoreData = await scoreRes.json();
      if (typeof scoreData.score === "number") aiScore = scoreData.score;
      if (
        scoreData.tier === "HOT" ||
        scoreData.tier === "WATCH" ||
        scoreData.tier === "SKIP"
      ) {
        aiTier = scoreData.tier;
      }
      if (typeof scoreData.reason === "string") aiReason = scoreData.reason;
    }
  } catch {
    // Silent fail — still send alert with default score
  }

  // ── 4. Patch aiScore + aiTier back into the history entry ─────────────────
  // This is what LiveSignalsBar reads to decide if a signal is worth showing.
  // We update the existing MongoDB doc with the score that just came back.
  try {
    await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        aiScore,
        aiTier,
        // isNew will be false this time — that's fine, we just want the $set update
      }),
    });
  } catch {
    // Silent fail
  }

  // ── 5. SKIP tier = no alert, still tracked in DB ──────────────────────────
  if (aiTier === "SKIP") return;

  // ── 6. Fire ENTRY alert on Telegram (with AI score) ───────────────────────
  try {
    await fetch("/api/alert/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "entry",
        symbol: (result.tokenSymbol ?? result.keyword).toUpperCase(),
        keyword: result.keyword,
        mcap,
        contractAddress: result.contractAddress,
        celebMention: result.celebMention,
        aiContext: result.aiContext,
        platforms: result.platforms ?? [],
        twoXTier: tier ?? "MEDIUM",
        seenAt: Date.now(),
        aiScore,
        aiTier,
        aiReason,
      }),
    });
  } catch {
    // Silent fail
  }
}
