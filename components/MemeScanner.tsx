"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cleanSym, cleanName } from "@/lib/cleanText";
import { createPortal } from "react-dom";
import axios from "axios";
import { MemeTrend } from "@/app/app/page";
import { getTokenPrice } from "@/lib/getTokenPrice";
import { C } from "@/lib/theme";
import { prefetchCandles } from "@/lib/candleCache";
import { TokenIcon } from "@/components/TokenIcon";
import { QuickBuyButton } from "@/components/QuickBuyButton";
import { Flame, Zap, Sparkles, Star, AlertTriangle } from "lucide-react";
import { HOVER_DELAY_MS, TokenHoverPreview } from "@/components/TokenHoverChart";

interface ScanResult extends MemeTrend {
  platforms?: string[];
  isNewCoin?: boolean;
  ageLabel?: string;
  ageMinutes?: number;
  ageDays?: number;
  mcap?: number;
  volume?: number;
  liquidity?: number;
  topHolderPct?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  contractAddress?: string;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  rugDetails?: string;
  onTwitter?: boolean;
  onTelegram?: boolean;
  onDex?: boolean;
  onCeleb?: boolean;
  onAI?: boolean;
  celebMention?: string;
  aiContext?: string;
  isViralTrend?: boolean;
  tokenName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  // conviction fields from route
  twoXTier?: "ULTRA" | "HIGH" | "MEDIUM" | "LOW" | "SKIP";
  twoXScore?: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
}

interface McapSnapshot {
  ts: number;
  mcap: number;
}

interface HistoryEntry {
  keyword: string;
  displayName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  seenAt: number;
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
  platforms: string[];
  preMigration?: boolean;
  initialMcap: number;
  peakMcap: number;
  currentMcap: number;
  snapshots: McapSnapshot[];
  lastChecked: number;
  tookProfitAt?: number;
  twoXTier?: string;
  twoXScore?: number;
  crossPlatforms?: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
}

export const HISTORY_KEY = "wraith_token_history_v2";

export function loadHistory(): Record<string, HistoryEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveHistory(h: Record<string, HistoryEntry>) {
  if (typeof window === "undefined") return;
  try {
    const MAX_BYTES = 4 * 1024 * 1024; // 4MB guard — browser limit is 5MB
    let serialized = JSON.stringify(h);

    // If over limit, trim oldest 20% of entries until under limit
    if (serialized.length > MAX_BYTES) {
      const entries = Object.entries(h).sort(
        ([, a], [, b]) => a.seenAt - b.seenAt, // oldest first
      );
      const trimCount = Math.max(1, Math.floor(entries.length * 0.2));
      console.warn(
        `[saveHistory] localStorage near limit (${(serialized.length / 1024).toFixed(0)}KB) — trimming ${trimCount} oldest entries`,
      );
      const trimmed = Object.fromEntries(entries.slice(trimCount));
      serialized = JSON.stringify(trimmed);
    }

    localStorage.setItem(HISTORY_KEY, serialized);
  } catch (err) {
    console.error("[saveHistory] failed to write localStorage:", err);
  }
}

// ─── STALE TOKEN CLEANUP ──────────────────────────────────────────────────────
// Called at the top of every fetchTrends() to keep localStorage clean.
// Only removes tokens that: are >40min old AND haven't moved meaningfully.
// Winners (2x+), active movers, and celeb tokens are ALWAYS preserved.
function pruneStaleTokens() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    const now = Date.now();
    const SCAN_STALE_MS = 40 * 60 * 1000; // 40 min — prune window for dead tokens
    const MAX_KEEP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days — hard cap for everything
    let pruned = 0;
    for (const [key, v] of Object.entries(raw)) {
      const e = v as Record<string, unknown>;
      const seenAt = typeof e.seenAt === "number" ? e.seenAt : 0;
      const initialMcap = typeof e.initialMcap === "number" ? e.initialMcap : 0;
      const currentMcap = typeof e.currentMcap === "number" ? e.currentMcap : 0;
      const peakMcap = typeof e.peakMcap === "number" ? e.peakMcap : 0;
      const celebMention = !!e.celebMention;
      const age = now - seenAt;

      // Hard cap: nothing lives longer than 3 days
      if (age > MAX_KEEP_MS) {
        delete raw[key];
        pruned++;
        continue;
      }

      // Keep everything under 40min
      if (age <= SCAN_STALE_MS) continue;

      // Always keep winners (1.5x+ current or 2x+ peak)
      if (initialMcap > 0) {
        if (currentMcap >= initialMcap * 1.5) continue;
        if (peakMcap >= initialMcap * 2.0) continue;
      }

      // Always keep celeb tokens — they can pump days later
      if (celebMention) continue;

      // Token is >40min old with no meaningful price movement — prune it
      delete raw[key];
      pruned++;
    }
    if (pruned > 0) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(raw));
    }
  } catch {}
}

interface TokenMeta {
  name: string;
  symbol: string;
  imageUrl?: string;
}
const metaCache = new Map<string, TokenMeta | null>();

export async function fetchTokenMeta(ca: string): Promise<TokenMeta | null> {
  if (metaCache.has(ca)) return metaCache.get(ca)!;
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) {
      metaCache.set(ca, null);
      return null;
    }
    const data = await res.json();
    const pairs = (data?.pairs || [])
      .filter((p: { chainId: string }) => p.chainId === "solana")
      .sort(
        (
          a: { liquidity?: { usd?: number } },
          b: { liquidity?: { usd?: number } },
        ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
      );
    if (!pairs.length) {
      metaCache.set(ca, null);
      return null;
    }
    const best = pairs[0];
    const meta: TokenMeta = {
      name: cleanName(best.baseToken?.name || best.baseToken?.symbol || ""),
      symbol: cleanSym((best.baseToken?.symbol || "").toUpperCase()),
      imageUrl: best.info?.imageUrl ?? undefined,
    };
    metaCache.set(ca, meta);
    return meta;
  } catch {
    metaCache.set(ca, null);
    return null;
  }
}

// Delegates to the shared getTokenPrice() module (lib/getTokenPrice.ts) so
// WinsPanel reads the exact same mcap TokenPanel and PaperTrader read for the
// same token — previously this was DexScreener-only with no Jupiter overlay
// and no pump.fun fallback, which is why WinsPanel's "NOW" could disagree
// with TokenPanel's market cap for the same token at the same moment.
export async function fetchCurrentMcap(
  ca: string,
  bulk = false,
): Promise<number | null> {
  const d = await getTokenPrice(ca, { skipJupiter: bulk });
  return d.mcap && d.mcap > 0 ? d.mcap : null;
}

function isGarbageKeyword(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  const vowels = (kw.match(/[aeiou]/gi) || []).length;
  if (kw.length >= 8 && vowels === 0) return true;
  return false;
}

const MIN_TRACK_MCAP = 2_000;
const MIN_TRACK_LIQUIDITY = 300;
const MIN_24H_CHANGE = -85;
const MAX_LIQ_TO_MCAP_RATIO = 0.6;

export function recordTokenSighting(result: ScanResult) {
  if (!result.contractAddress) return;
  if (isGarbageKeyword(result.keyword)) return;

  const mcap = result.mcap || 0;
  if (mcap > 0 && mcap < MIN_TRACK_MCAP) return;
  if (mcap > 500_000) return;

  const hasOnchain = (result.platforms || []).some((p) =>
    ["pumpfun", "dexscreener", "birdeye"].includes(p),
  );
  const isCeleb = !!result.celebMention || result.onCeleb;
  if (!hasOnchain && !isCeleb) return;

  const tier = result.twoXTier;
  if (!isCeleb) {
    if (tier === "MEDIUM" && (result.crossPlatforms ?? 0) < 2) return;
    if (!tier || tier === "LOW" || tier === "SKIP") return;
  } else {
    if (tier === "SKIP") return;
    if (!hasOnchain && tier === "LOW") return;
  }

  if ((result.priceChange24h ?? 0) < MIN_24H_CHANGE) return;

  if (
    (result.liquidity ?? 0) > 0 &&
    (result.liquidity ?? 0) < MIN_TRACK_LIQUIDITY
  )
    return;

  if (mcap > 0 && (result.liquidity ?? 0) > 0) {
    const liqRatio = (result.liquidity ?? 0) / mcap;
    if (liqRatio > MAX_LIQ_TO_MCAP_RATIO) return;
  }

  const h = loadHistory();
  const key = result.keyword;
  const now = Date.now();
  const crossPlatforms =
    result.crossPlatforms ?? (result.platforms || []).length;

  if (!h[key]) {
    h[key] = {
      keyword: key,
      displayName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      tokenImageUrl: result.tokenImageUrl,
      seenAt: now,
      contractAddress: result.contractAddress,
      celebMention: result.celebMention,
      aiContext: result.aiContext,
      platforms: result.platforms || [],
      initialMcap: mcap,
      peakMcap: mcap,
      currentMcap: mcap,
      snapshots: mcap > 0 ? [{ ts: now, mcap }] : [],
      lastChecked: now,
      twoXTier: tier,
      twoXScore: result.twoXScore,
      aiScore: result.aiScore,
      aiTier: result.aiTier,
      crossPlatforms,
      preMigration:
        (result.platforms || []).includes("pumpfun") &&
        !(result.platforms || []).some((p) =>
          ["dexscreener", "birdeye"].includes(p),
        ), // spotted only on bonding curve, before any real DEX pair existed
    };
  } else {
    if (mcap > 0) {
      if (mcap > h[key].peakMcap) h[key].peakMcap = mcap;
      h[key].currentMcap = mcap;
      h[key].lastChecked = now;
      const snaps = h[key].snapshots;
      const lastSnap = snaps[snaps.length - 1];
      if (!lastSnap) {
        h[key].initialMcap = mcap;
        h[key].snapshots = [{ ts: now, mcap }];
      } else {
        const timeDiff = now - lastSnap.ts;
        const mcapChange =
          Math.abs(mcap - lastSnap.mcap) / (lastSnap.mcap || 1);
        if (timeDiff > 1800000 || mcapChange > 0.05) {
          h[key].snapshots = [...snaps, { ts: now, mcap }];
          if (h[key].snapshots.length > 48) h[key].snapshots.shift();
        }
      }
    }
    if (tier) h[key].twoXTier = tier;
    if (result.twoXScore !== undefined) h[key].twoXScore = result.twoXScore;
    if (result.aiScore !== undefined) h[key].aiScore = result.aiScore;
    if (result.aiTier !== undefined) h[key].aiTier = result.aiTier;
    h[key].crossPlatforms = Math.max(
      h[key].crossPlatforms ?? 0,
      crossPlatforms,
    );

    if (result.celebMention && !h[key].celebMention)
      h[key].celebMention = result.celebMention;
    if (result.aiContext && !h[key].aiContext)
      h[key].aiContext = result.aiContext;
    if (result.tokenName && !h[key].displayName)
      h[key].displayName = result.tokenName;
    if (result.tokenSymbol && !h[key].tokenSymbol)
      h[key].tokenSymbol = result.tokenSymbol;
    if (result.tokenImageUrl && !h[key].tokenImageUrl)
      h[key].tokenImageUrl = result.tokenImageUrl;
  }
  saveHistory(h);

  postToServerHistory(result, mcap, tier, crossPlatforms);
}

async function postToServerHistory(
  result: ScanResult,
  mcap: number,
  tier: string | undefined,
  crossPlatforms: number,
) {
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
    twoXTier: tier ?? "MEDIUM",
    crossPlatforms,
  };

  // ── Retry helper — 2 attempts with 2s delay ──────────────────────────────
  async function fetchWithRetry(
    url: string,
    options: RequestInit,
    attempts = 2,
    delayMs = 2000,
  ): Promise<Response | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;
        console.warn(
          `[postToServerHistory] ${url} attempt ${i + 1} returned HTTP ${res.status}`,
        );
      } catch (err) {
        console.warn(
          `[postToServerHistory] ${url} attempt ${i + 1} network error:`,
          err,
        );
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    console.error(
      `[postToServerHistory] ${url} failed after ${attempts} attempts — token ${result.keyword} not recorded`,
    );
    return null;
  }

  // ── 1. Post to /api/history ───────────────────────────────────────────────
  let isNewToken = false;
  const historyRes = await fetchWithRetry("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!historyRes) return; // both attempts failed — bail out

  try {
    const data = await historyRes.json();
    isNewToken = data.isNew === true;
  } catch (err) {
    console.error(
      "[postToServerHistory] failed to parse /api/history response:",
      err,
    );
    return;
  }

  // Older entries were written before AI scoring was added, and the server
  // correctly reports them as existing. Backfill only entries that still lack
  // a score; otherwise they remain permanently score-less in localStorage.
  const existingHistory = loadHistory()[result.keyword];
  if (!isNewToken && typeof existingHistory?.aiScore === "number") return;

  // ── 2. AI scoring ─────────────────────────────────────────────────────────
  let aiScore = 50;
  let aiTier: "HOT" | "WATCH" | "SKIP" = "WATCH";
  let aiReason = "";

  const scoreRes = await fetchWithRetry("/api/ai-score", {
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

  if (scoreRes) {
    try {
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
    } catch (err) {
      console.error(
        "[postToServerHistory] failed to parse /api/ai-score response:",
        err,
      );
    }
  }

  // ── 3. Update localStorage with AI score ─────────────────────────────────
  const h = loadHistory();
  if (h[result.keyword]) {
    h[result.keyword].aiScore = aiScore;
    h[result.keyword].aiTier = aiTier;
    saveHistory(h);
  }

  // ── 4. Persist AI score back to server ───────────────────────────────────
  await fetchWithRetry("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, aiScore, aiTier }),
  });

  if (aiTier === "SKIP") return;

  // ── 5. Telegram alert ─────────────────────────────────────────────────────
  await fetchWithRetry("/api/alert/telegram", {
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
}

function getAgeDisplay(ageMinutes: number | undefined) {
  if (ageMinutes === undefined)
    return { label: "", color: "#555", isStale: false, isFresh: false };
  const days = ageMinutes / 1440;
  if (days > 14)
    return {
      label: `${Math.floor(days)}d — STALE`,
      color: C.red,
      isStale: true,
      isFresh: false,
    };
  if (days > 7)
    return {
      label: `${Math.floor(days)}d old`,
      color: "#ff6600",
      isStale: false,
      isFresh: false,
    };
  if (days > 3)
    return {
      label: `${Math.floor(days)}d old`,
      color: C.amber,
      isStale: false,
      isFresh: false,
    };
  if (ageMinutes > 1440)
    return {
      label: `${Math.floor(days)}d old`,
      color: "#888",
      isStale: false,
      isFresh: false,
    };
  if (ageMinutes > 360)
    return {
      label: `${Math.floor(ageMinutes / 60)}h old`,
      color: C.green,
      isStale: false,
      isFresh: true,
    };
  return {
    label: `${ageMinutes}m old`,
    color: C.green,
    isStale: false,
    isFresh: true,
  };
}

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  celebrity: { label: "CELEB", color: C.yellow },
  ai: { label: "AI", color: C.orange },
  pumpfun: { label: "PUMP", color: C.purple },
  dexscreener: { label: "DEX", color: C.blue },
  twitter: { label: "X", color: "#e2e8f0" },
  coingecko: { label: "CGK", color: "#8dc63f" },
  reddit: { label: "RED", color: "#ff4500" },
  "google-trends": { label: "TREND", color: "#4285f4" },
  "google-news": { label: "NEWS", color: "#4285f4" },
  youtube: { label: "YT", color: "#ff0000" },
  kym: { label: "KYM", color: "#00b300" },
  hackernews: { label: "HN", color: "#ff6600" },
  telegram: { label: "TG", color: "#26a5e4" },
};

const RUG_COLOR: Record<string, string> = {
  low: C.green,
  medium: C.amber,
  high: "#ff2222",
  unknown: "#555",
};

function ConvictionBadge({ tier, score }: { tier?: string; score?: number }) {
  if (!tier || tier === "SKIP" || tier === "LOW") return null;
  const cfg =
    tier === "ULTRA"
      ? { label: "ULTRA", color: C.yellow, Icon: Flame }
      : tier === "HIGH"
        ? { label: "HIGH", color: C.green, Icon: Zap }
        : { label: "MED", color: C.amber, Icon: Sparkles };
  const Icon = cfg.Icon;
  return (
    <span
      className="wx-badge"
      style={{
        fontSize: 8,
        color: cfg.color,
        background: `${cfg.color}12`,
        border: `1px solid ${cfg.color}44`,
        gap: 3,
        animation: tier === "ULTRA" ? "wraithScan 2.2s ease-in-out infinite" : undefined,
      }}
    >
      <Icon size={8} color={cfg.color} />
      {cfg.label}
      {score !== undefined ? ` ${score}` : ""}
    </span>
  );
}

function DecisionChain({ item }: { item: ScanResult }) {
  const platforms = item.platforms || [];
  const signals: { label: string; color: string; reason: string }[] = [];

  if (item.onCeleb || platforms.includes("celebrity"))
    signals.push({
      label: "CELEBRITY TRIGGER",
      color: C.yellow,
      reason: item.celebMention
        ? `${item.celebMention} mentioned this`
        : "Celebrity/influencer mention detected",
    });
  if (item.onAI || platforms.includes("ai"))
    signals.push({
      label: "AI CONTEXT MATCH",
      color: C.orange,
      reason: item.aiContext
        ? item.aiContext.slice(0, 100)
        : "Gemini AI confirmed viral potential",
    });
  if (platforms.includes("pumpfun") || platforms.includes("dexscreener"))
    signals.push({
      label: "ON-CHAIN ACTIVITY",
      color: C.blue,
      reason: item.mcap
        ? `Mcap $${item.mcap >= 1000 ? (item.mcap / 1000).toFixed(0) + "K" : item.mcap}${item.liquidity ? " · Liq $" + (item.liquidity / 1000).toFixed(0) + "K" : ""}`
        : "Active trading on Solana",
    });
  if (platforms.some((p) => ["google-trends", "youtube", "kym"].includes(p)))
    signals.push({
      label: "VIRAL INTERNET TREND",
      color: C.amber,
      reason: `Trending on: ${platforms
        .filter((p) => ["google-trends", "youtube", "kym"].includes(p))
        .map((p) => PLATFORM_META[p]?.label || p)
        .join(", ")}`,
    });
  if (platforms.includes("reddit"))
    signals.push({
      label: "REDDIT BUZZ",
      color: "#ff4500",
      reason: "Hot posts on crypto/meme subreddits",
    });
  if (platforms.some((p) => ["google-news", "twitter"].includes(p)))
    signals.push({
      label: "NEWS / SOCIAL SIGNAL",
      color: "#4285f4",
      reason: "In Google News or X trending",
    });

  const backendScore = item.twoXScore;
  const backendTier = item.twoXTier;

  let confidence: number;
  let confidenceLabel: string;
  let confidenceColor: string;

  if (backendScore !== undefined && backendTier && backendTier !== "SKIP") {
    confidence = backendScore;
    if (backendTier === "ULTRA") {
      confidenceLabel = "ULTRA HIGH";
      confidenceColor = C.yellow;
    } else if (backendTier === "HIGH") {
      confidenceLabel = "HIGH";
      confidenceColor = C.green;
    } else if (backendTier === "MEDIUM") {
      confidenceLabel = "MODERATE";
      confidenceColor = C.amber;
    } else {
      confidenceLabel = "LOW";
      confidenceColor = "#ff6600";
    }
  } else {
    const hasCeleb = item.onCeleb;
    const hasAI = item.onAI;
    const hasOnchain = platforms.some((p) =>
      ["pumpfun", "dexscreener"].includes(p),
    );
    const hasSocial = platforms.some((p) =>
      ["reddit", "twitter", "google-trends", "youtube", "kym"].includes(p),
    );
    const platformCount = platforms.length;

    confidence = 20;
    confidenceLabel = "SPECULATIVE";
    confidenceColor = C.red;

    if (hasCeleb && hasOnchain) {
      confidence = 95;
      confidenceLabel = "EXTREMELY HIGH";
      confidenceColor = C.yellow;
    } else if (hasCeleb && hasSocial) {
      confidence = 88;
      confidenceLabel = "VERY HIGH";
      confidenceColor = C.yellow;
    } else if (hasAI && hasOnchain && hasSocial && platformCount >= 4) {
      confidence = 82;
      confidenceLabel = "HIGH";
      confidenceColor = C.green;
    } else if (hasAI && hasOnchain && platformCount >= 3) {
      confidence = 70;
      confidenceLabel = "GOOD";
      confidenceColor = C.green;
    } else if (hasOnchain && hasSocial) {
      confidence = 58;
      confidenceLabel = "MODERATE";
      confidenceColor = C.amber;
    } else if (hasOnchain && platformCount >= 2) {
      confidence = 45;
      confidenceLabel = "LOW-MODERATE";
      confidenceColor = C.amber;
    } else if (hasCeleb) {
      confidence = 40;
      confidenceLabel = "LOW (no coin yet)";
      confidenceColor = "#ff6600";
    }
  }

  if (item.rugRisk === "medium") confidence = Math.max(confidence - 15, 5);

  return (
    <div className="wx-scan-why">
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="wx-kicker" style={{ fontSize: 8 }}>WRAITH CONFIDENCE</span>
          <span style={{ color: confidenceColor, fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono), monospace" }}>
            {confidenceLabel} · {confidence}%
          </span>
        </div>
        <div className="wx-scan-why-bar">
          <div className="wx-scan-why-fill" style={{ width: `${confidence}%`, background: `linear-gradient(90deg, ${confidenceColor}88, ${confidenceColor})` }} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span className="wx-kicker" style={{ fontSize: 8 }}>WHY WRAITH FOUND THIS</span>
        {signals.map((sig, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: sig.color, flexShrink: 0, marginTop: 3 }} />
            <div>
              <div style={{ color: sig.color, fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono), monospace", letterSpacing: "0.08em" }}>{sig.label}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono), monospace", lineHeight: 1.5, marginTop: 1 }}>{sig.reason}</div>
            </div>
          </div>
        ))}
        {signals.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono), monospace" }}>
            Weak signal — insufficient cross-platform confirmation
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {platforms.filter((p) => PLATFORM_META[p]).map((p) => (
          <span key={p} className="wx-badge" style={{ fontSize: 8, color: PLATFORM_META[p].color, background: `${PLATFORM_META[p].color}10`, border: `1px solid ${PLATFORM_META[p].color}30` }}>
            {PLATFORM_META[p].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── 10 MINUTE SCAN INTERVAL ──────────────────────────────────────────────────
const REFRESH_INTERVAL = 600; // 10 minutes (was 90s)

// Module-level cache — NOT React state, so it survives a component
// unmount/remount from client-side navigation (e.g. clicking a token to view
// its chart, then hitting Back). Without this, every remount re-ran
// fetchTrends() from a blank slate — full "Fetching Pump.fun launches..."
// animation and an empty list — even if the last scan was seconds old.
// A hard page reload still clears it, which is the correct "start fresh"
// case, since this only lives in memory for the current tab session.
let scannerCache: {
  trends: ScanResult[];
  lastScan: string | null;
  scannedAtMs: number;
} | null = null;

interface Props {
  onSelectMeme: (meme: MemeTrend) => void;
  selectedMeme: MemeTrend | null;
}

export default function MemeScanner({ onSelectMeme, selectedMeme }: Props) {
  const [trends, setTrends] = useState<ScanResult[]>(
    () => scannerCache?.trends ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(
    () => scannerCache?.lastScan ?? null,
  );
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [autoScan, setAutoScan] = useState(false); // deep scan spends API credits: manual unless switched on
  const [filter, setFilter] = useState<
    | "all"
    | "celeb"
    | "new"
    | "viral"
    | "social"
    | "onchain"
    | "safe"
    | "fresh"
    | "ultra"
    | "ideas"
  >("all");
  const [enriching, setEnriching] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hoveredKeyword, setHoveredKeyword] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ token: ScanResult; top: number; left: number } | null>(null);
  const hoverPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPreviewCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPrefetchRef = useRef<ScanResult[] | null>(null);

  const handleRowMouseEnter = useCallback((keyword: string) => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredKeyword(keyword);
    }, HOVER_DELAY_MS);
  }, []);

  const handleRowMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Small grace period — lets the cursor travel from the row into the
    // popup itself (there's a few px gap) without the card slamming shut
    // mid-move. Telemetry's own hover card has the same forgiveness.
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoveredKeyword(null);
    }, 180);
  }, []);
  const handleTokenPreviewEnter = useCallback((event: React.MouseEvent, token: ScanResult) => {
    if (!token.contractAddress || window.matchMedia("(hover: none)").matches) return;
    if (hoverPreviewCloseRef.current) clearTimeout(hoverPreviewCloseRef.current);
    if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    hoverPreviewTimerRef.current = setTimeout(() => {
      const left = rect.right + 10 + 340 < window.innerWidth
        ? rect.right + 10
        : Math.max(8, rect.left - 350);
      setHoverPreview({
        token,
        top: Math.max(8, Math.min(rect.top, window.innerHeight - 390)),
        left,
      });
    }, HOVER_DELAY_MS);
  }, []);

  const handleTokenPreviewLeave = useCallback(() => {
    if (hoverPreviewTimerRef.current) clearTimeout(hoverPreviewTimerRef.current);
    if (hoverPreviewCloseRef.current) clearTimeout(hoverPreviewCloseRef.current);
    hoverPreviewCloseRef.current = setTimeout(() => setHoverPreview(null), 180);
  }, []);

  const loadingRef = useRef(false);

  const enrichWithTokenMeta = useCallback(
    async (results: ScanResult[]): Promise<ScanResult[]> => {
      const toEnrich = results.filter(
        (r) => r.contractAddress && !r.tokenImageUrl,
      );
      if (!toEnrich.length) return results;
      setEnriching(true);
      for (let i = 0; i < toEnrich.length; i += 12) {
        await Promise.all(
          toEnrich.slice(i, i + 12).map(async (r) => {
            const meta = await fetchTokenMeta(r.contractAddress!);
            if (meta) {
              r.tokenName = meta.name;
              r.tokenSymbol = meta.symbol;
              r.tokenImageUrl = meta.imageUrl;
            }
          }),
        );
      }
      setEnriching(false);
      return [...results];
    },
    [],
  );

  const fetchTrends = useCallback(
    async (silent = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);

      // ─── PRUNE STALE TOKENS BEFORE EACH SCAN ──────────────────────────────
      pruneStaleTokens();

      if (!silent) {
        setError("");
        setScanLog([]);
      }
      setProgress(0);

      const ticker = setInterval(
        () => setProgress((p) => Math.min(p + 1.0, 88)),
        400,
      );
      [
        "Scanning Elon, Trump, CZ on X...",
        "Fetching Pump.fun launches...",
        "Scanning DexScreener pairs...",
        "CoinGecko trending...",
        "Google Trends + YouTube...",
        "Reddit subs...",
        "KYM + Hacker News...",
        "Rugcheck...",
        "Age filtering + scoring...",
      ].forEach((msg, i) =>
        setTimeout(() => setScanLog((l) => [...l.slice(-6), msg]), i * 2000),
      );

      try {
        const res = await axios.get<{
          results: ScanResult[];
          logs: string[];
          scannedAt: string;
        }>("/api/scan", { timeout: 120000 });
        clearInterval(ticker);
        setProgress(100);
        const { results, logs } = res.data;
        const enriched = await enrichWithTokenMeta(results);
        enriched.forEach(recordTokenSighting);
        const scanTime = new Date().toLocaleTimeString();
        setScanLog([...logs.slice(-8)]);
        setTrends(enriched);
        setLastScan(scanTime);
        setError("");
        setCountdown(REFRESH_INTERVAL);
        scannerCache = {
          trends: enriched,
          lastScan: scanTime,
          scannedAtMs: Date.now(),
        };
        try {
          // survives new tabs / reloads so the list shows instantly while a fresh scan runs
          localStorage.setItem("wraith_scan_cache_v1", JSON.stringify({ ...scannerCache, trends: enriched.slice(0, 80) }));
        } catch { /* storage full or blocked: in-memory cache still works */ }
      } catch (err) {
        clearInterval(ticker);
        const status = axios.isAxiosError(err) ? err.response?.status : null;
        const apiMsg = axios.isAxiosError(err) ? err.response?.data?.error : null;
        if (status === 401 || status === 403) {
          setError("Not authenticated — sign in to use the scanner");
          setAutoScan(false);
        } else if (status === 429) {
          setError("Rate limit — wait a few minutes before next scan");
          setAutoScan(false);
        } else if (status && status >= 500) {
          setError(apiMsg || `Server error (${status}) — try again shortly`);
        } else {
          const msg = axios.isAxiosError(err) ? (apiMsg || err.message) : "Unknown error";
          setError(`Scan failed: ${msg}`);
        }
      } finally {
        setLoading(false);
        loadingRef.current = false;
        setTimeout(() => setProgress(0), 600);
      }
    },
    [selectedMeme, onSelectMeme, enrichWithTokenMeta],
  );

  useEffect(() => {
    // If a fresh-enough scan is already cached from before this remount
    // (e.g. navigating to a token page and back), skip the fetch entirely —
    // trends/lastScan were already hydrated from it in the useState
    // initializers above, so re-fetching would just blank the list and
    // replay the whole scan animation for no reason. Only fall through to a
    // real fetch when there's no cache or it's aged past the refresh window.
    if (!scannerCache) {
      try {
        const raw = localStorage.getItem("wraith_scan_cache_v1");
        const c = raw ? JSON.parse(raw) : null;
        // show a previous scan instantly (up to 6h old); the fresh scan below replaces it
        if (c && Array.isArray(c.trends) && c.trends.length && Date.now() - Number(c.scannedAtMs) < 6 * 3600 * 1000) {
          scannerCache = c;
          setTrends(c.trends);
          setLastScan(c.lastScan ?? null);
        }
      } catch { /* ignore corrupt cache */ }
    }
    const ageMs = scannerCache
      ? Date.now() - scannerCache.scannedAtMs
      : Infinity;
    if (scannerCache && ageMs < REFRESH_INTERVAL * 1000) {
      setCountdown(Math.max(1, REFRESH_INTERVAL - Math.floor(ageMs / 1000)));
      return;
    }
    fetchTrends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (autoScan && !loadingRef.current) fetchTrends(true);
          return REFRESH_INTERVAL;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoScan, fetchTrends]);

  const getSignal = (item: ScanResult) => {
    const p = item.platforms || [];
    const hasCeleb = p.includes("celebrity") || item.onCeleb;
    const hasSocial = p.some((x) =>
      ["reddit", "google-trends", "youtube", "kym"].includes(x),
    );
    const hasChain = p.some((x) => ["pumpfun", "dexscreener"].includes(x));
    const count = item.crossPlatforms ?? 0;
    if (hasCeleb && hasChain) return { label: "CELEB+CHAIN", color: C.yellow };
    if (hasCeleb && hasSocial) return { label: "CELEB+VIRAL", color: C.yellow };
    if (hasCeleb) return { label: "CELEB SIGNAL", color: C.yellow };
    if (hasSocial && hasChain && count >= 3)
      return { label: "VIRAL+CHAIN", color: "#ff2020" };
    if (hasSocial && hasChain)
      return { label: "SOCIAL+CHAIN", color: "#ff6600" };
    if (hasSocial && count >= 4)
      return { label: "MEGA VIRAL", color: "#ffcc00" };
    if (hasSocial && count >= 3) return { label: "VIRAL", color: "#ffcc00" };
    if (hasChain && item.isNewCoin)
      return { label: "NEW COIN", color: C.purple };
    if (hasChain) return { label: "ON-CHAIN", color: C.green };
    if (item.hasTicker && hasSocial)
      return { label: "TRENDING", color: C.orange };
    return { label: "WATCH", color: "#555" };
  };

  // A "real" result is a token that exists on-chain with a market cap. Everything else is only a keyword guessed from
  // headlines / social posts (no contract, no price), so it is kept out of the main lists and shown under IDEAS.
  const isReal = (t: MemeTrend) => !!t.contractAddress && (t.mcap ?? 0) > 0;
  const filtered = trends.filter((t) => {
    const p = t.platforms || [];
    if (filter === "ideas") return !isReal(t);
    if (!isReal(t)) return false;
    if (filter === "celeb") return t.onCeleb || p.includes("celebrity");
    if (filter === "new") return t.isNewCoin;
    if (filter === "fresh") return (t.ageMinutes || Infinity) < 1440;
    if (filter === "ultra")
      return t.twoXTier === "ULTRA" || t.twoXTier === "HIGH";
    if (filter === "viral")
      return (
        t.isViralTrend ||
        p.some((x) => ["google-trends", "youtube", "kym"].includes(x))
      );
    if (filter === "social")
      return p.some((x) =>
        ["reddit", "google-trends", "google-news"].includes(x),
      );
    if (filter === "onchain")
      return p.some((x) => ["pumpfun", "dexscreener"].includes(x));
    if (filter === "safe") return t.rugRisk === "low";
    return true;
  }).sort((a, b) => b.score - a.score);

  const celebCount = trends.filter((t) => t.onCeleb).length;
  const viralCount = trends.filter((t) => t.isViralTrend).length;
  const freshCount = trends.filter(
    (t) => (t.ageMinutes || Infinity) < 1440,
  ).length;
  const ultraCount = trends.filter(
    (t) => t.twoXTier === "ULTRA" || t.twoXTier === "HIGH",
  ).length;

  const TABS: {
    key: typeof filter;
    label: string;
    color?: string;
    Icon?: typeof Flame;
  }[] = [
    { key: "all", label: "ALL" },
    { key: "ultra", label: "TOP SETUPS", color: C.yellow, Icon: Flame },
    { key: "celeb", label: "CELEB", color: C.yellow, Icon: Star },
    { key: "fresh", label: "FRESH", color: C.green, Icon: Zap },
    { key: "new", label: "NEW" },
    { key: "viral", label: "VIRAL" },
    { key: "social", label: "SOCIAL" },
    { key: "onchain", label: "ON-CHAIN" },
    { key: "safe", label: "SAFE" },
    { key: "ideas", label: `IDEAS ${trends.filter((t) => !isReal(t)).length}` },
  ];

  const SCAN_SOURCES = [
    "Celeb/X",
    "Pump.fun",
    "DexScreener",
    "CoinGecko",
    "Trends/YT",
    "Reddit",
    "KYM/HN",
    "Rugcheck",
    "Age filter",
  ];

  // Format countdown as mm:ss for 10min display
  const countdownDisplay =
    countdown >= 60
      ? `${Math.floor(countdown / 60)}m ${countdown % 60}s`
      : `${countdown}s`;

  return (
    <div className="wx-board wraith-scanner">
      <style>{`
        @keyframes wraithScan {
          0%   { box-shadow: 0 0 0 0 #ffd70055, inset 0 0 0 0 #ffd70000; }
          50%  { box-shadow: 0 0 10px 1px #ffd70055, inset 0 0 6px 0 #ffd70022; }
          100% { box-shadow: 0 0 0 0 #ffd70055, inset 0 0 0 0 #ffd70000; }
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="wx-board-bar ms-bar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ms-stats">
            <span className="ms-state" data-state={loading || enriching ? "busy" : error ? "err" : "ok"}>
              <i />{loading ? "Scanning" : enriching ? "Enriching" : error ? "Retry" : "Live"}
            </span>
            {!loading && ultraCount > 0 && <span className="ms-chip hot"><Flame size={10} /> {ultraCount} hot</span>}
            {!loading && celebCount > 0 && <span className="ms-chip"><Star size={10} /> {celebCount} celeb</span>}
            {!loading && freshCount > 0 && <span className="ms-chip"><Zap size={10} /> {freshCount} fresh</span>}
            {!loading && viralCount > 0 && <span className="ms-chip"><Flame size={10} /> {viralCount} viral</span>}
          </div>
          <div className="ms-sub">
            {loading
              ? scanLog[scanLog.length - 1] || "Initializing..."
              : enriching
                ? "Fetching token names + images..."
                : lastScan
                  ? `${lastScan} · ${trends.length} signals · next in ${countdownDisplay}`
                  : "Social + celebrity + Pump.fun signals"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className={`sg-btn${autoScan ? " on" : ""}`} onClick={() => setAutoScan((v) => !v)}>
            Auto {autoScan ? "on" : "off"}
          </button>
          <button type="button" className="sg-btn primary" onClick={() => fetchTrends()} disabled={loading}>
            {loading ? "Scanning…" : "Scan now"}
          </button>
        </div>
      </div>

      {/* ── Progress ────────────────────────────────────────────────────── */}
      {loading && (
        <div className="wx-scan-progress">
          <div className="wx-scan-progress-track">
            <div className="wx-scan-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {SCAN_SOURCES.map((label, i) => {
              const step = Math.floor(progress / (100 / SCAN_SOURCES.length));
              return (
                <span key={label} style={{ fontSize: 9, fontFamily: "var(--font-mono), monospace", color: step === i ? "var(--accent-text)" : "var(--text-dim)", opacity: step > i ? 0.35 : 1 }}>
                  {step === i ? ">" : "·"} {label.toUpperCase()}
                </span>
              );
            })}
          </div>
          {scanLog.slice(-1).map((line, idx) => (
            <div key={idx} style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono), monospace", marginTop: 4 }}>
              &gt; {line}
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div style={{ padding: "8px 14px", color: "var(--loss)", fontSize: 10, fontFamily: "var(--font-mono), monospace", borderBottom: "1px solid var(--border)" }}>
          {error}
        </div>
      )}

      {/* ── Filter tabs ─────────────────────────────────────────────────── */}
      <div className="wx-board-bar" style={{ padding: "6px 10px", flexWrap: "wrap" }}>
        <div className="wx-seg sm" role="tablist">
          {TABS.map(({ key, label, color, Icon }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "on" : ""}
                onClick={() => setFilter(key)}
                style={active && color ? { color, boxShadow: `inset 0 0 0 1px ${color}44`, background: `${color}12` } : undefined}
              >
                {Icon && <Icon size={9} />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {filtered.length === 0 && !loading && (
        <div className="wx-empty">
          <span className="wx-kicker" style={{ fontSize: 16, opacity: 0.12, letterSpacing: "0.3em" }}>WRAITH</span>
          <strong>
            {error
              ? "Scan interrupted"
              : trends.length === 0
                ? "No signals yet"
                : filter === "celeb"
                  ? "No celeb signals"
                  : filter === "safe"
                    ? "No safe tokens"
                    : filter === "fresh"
                      ? "No fresh tokens yet"
                      : filter === "ultra"
                        ? "No top setups yet"
                        : filter === "ideas"
                          ? "No keyword ideas"
                          : "No verified tokens yet"}
          </strong>
          {error ? (
            <>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11, opacity: 0.7 }}>{error}</span>
              <button type="button" className="wx-btn primary" onClick={() => fetchTrends()}>Retry scan</button>
            </>
          ) : trends.length === 0 ? (
            <>
              <span>Run a scan to detect trending tokens from social feeds.</span>
              <button type="button" className="wx-btn primary" onClick={() => fetchTrends()}>Start scan</button>
            </>
          ) : filter !== "all" ? (
            <button type="button" className="wx-btn" onClick={() => setFilter("all")}>Show all tokens</button>
          ) : (
            <>
              <span>Nothing on-chain matched this scan. {trends.length} keyword ideas have no token yet.</span>
              <button type="button" className="sg-btn" onClick={() => setFilter("ideas")}>View ideas</button>
            </>
          )}
        </div>
      )}

      {/* ── Token list ──────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <div className="wx-scan-list">
          {(() => {
            if (hoverPrefetchRef.current !== filtered) {
              hoverPrefetchRef.current = filtered;
              filtered.slice(0, 5).forEach((tk, i) => {
                if (tk.contractAddress)
                  setTimeout(() => prefetchCandles(tk.contractAddress!, "5m"), i * 800);
              });
            }
            return null;
          })()}
          {filtered.map((t, i) => {
            const sig = getSignal(t);
            const isSelected = selectedMeme?.keyword === t.keyword;
            const p = t.platforms || [];
            const isCeleb = t.onCeleb || p.includes("celebrity");
            const isExpanded = hoveredKeyword === t.keyword;
            const change1h =
              t.priceChange1h !== undefined
                ? { text: `${t.priceChange1h >= 0 ? "+" : ""}${t.priceChange1h.toFixed(0)}%`, color: t.priceChange1h >= 0 ? C.green : C.red }
                : null;
            const ageDisplay = getAgeDisplay(t.ageMinutes);
            const platformCount = p.length;
            const qualityWarning = platformCount < 2 && !isCeleb && !t.hasTicker;
            const displaySymbol = t.tokenSymbol || t.keyword.toUpperCase();
            const displayName =
              t.tokenName && t.tokenName.toLowerCase() !== t.keyword.toLowerCase()
                ? t.tokenName
                : null;

            return (
              <div key={t.keyword} className="wx-scan-item">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectMeme(t)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectMeme(t); } }}
                  className={`wx-scan-row${isSelected ? " selected" : ""}${isCeleb ? " celeb" : ""}`}
                  style={{ opacity: qualityWarning ? 0.6 : ageDisplay.isStale ? 0.4 : 1 }}
                  onMouseEnter={() => handleRowMouseEnter(t.keyword)}
                  onMouseLeave={() => handleRowMouseLeave()}
                >
                  <span className="wx-scan-rank">{String(i + 1).padStart(2, "0")}</span>

                  <span
                    style={{ flexShrink: 0, position: "relative", cursor: t.contractAddress ? "crosshair" : "default" }}
                    onMouseEnter={(event) => handleTokenPreviewEnter(event, t)}
                    onMouseLeave={handleTokenPreviewLeave}
                  >
                    <TokenIcon contractAddress={t.contractAddress} imageUrl={t.tokenImageUrl} symbol={displaySymbol} size={32} />
                  </span>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 2 }}>
                      <strong style={{ fontSize: 13, color: isCeleb ? "#ffd700" : ageDisplay.isStale ? "var(--text-dim)" : "var(--text)", fontFamily: "var(--font-mono), monospace" }}>
                        ${displaySymbol}
                      </strong>
                      {displayName && (
                        <small style={{ color: "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
                          {displayName}
                        </small>
                      )}
                      <ConvictionBadge tier={t.twoXTier} score={t.twoXScore} />
                      {ageDisplay.label && (
                        <span className="wx-badge" style={{ fontSize: 8, color: ageDisplay.color, background: `${ageDisplay.color}12`, border: `1px solid ${ageDisplay.color}30` }}>
                          {ageDisplay.isFresh ? <Zap size={7} /> : ageDisplay.isStale ? <AlertTriangle size={7} /> : null}
                          {ageDisplay.label}
                        </span>
                      )}
                      {isCeleb && (
                        <span className="wx-badge" style={{ fontSize: 8, color: "#ffd700", background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.22)" }}>
                          <Star size={7} color="#ffd700" /> {t.celebMention ? t.celebMention.split(" ")[0].toUpperCase() : "CELEB"}
                        </span>
                      )}
                      {t.isNewCoin && (
                        <span className="wx-badge" style={{ fontSize: 8, color: "#a855f7", background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)" }}>NEW</span>
                      )}
                      {qualityWarning && (
                        <span className="wx-badge muted" style={{ fontSize: 8 }}>WEAK</span>
                      )}
                      {p.filter((pl) => !["celebrity", "ai", "google-trends", "google-news", "hackernews"].includes(pl)).map((plat) => {
                        const pi = PLATFORM_META[plat];
                        return pi ? (
                          <span key={plat} className="wx-badge" style={{ fontSize: 8, color: pi.color, background: `${pi.color}10`, border: `1px solid ${pi.color}28` }}>{pi.label}</span>
                        ) : null;
                      })}
                      {t.rugRisk && t.rugRisk !== "unknown" && (
                        <span className="wx-badge" style={{ fontSize: 8, color: RUG_COLOR[t.rugRisk], background: `${RUG_COLOR[t.rugRisk]}10`, border: `1px solid ${RUG_COLOR[t.rugRisk]}28` }}>
                          {t.rugRisk === "low" ? "SAFE" : t.rugRisk === "medium" ? "MED" : "RUG"}
                        </span>
                      )}
                    </div>

                    {t.aiContext && (
                      <div style={{ fontSize: 9, color: isCeleb ? "rgba(255,215,0,0.5)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200, marginBottom: 2, fontFamily: "var(--font-mono), monospace" }}>
                        · {t.aiContext.slice(0, 55)}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {change1h && (
                        <span style={{ fontSize: 10, color: change1h.color, fontFamily: "var(--font-mono), monospace", fontWeight: 600 }}>1h {change1h.text}</span>
                      )}
                      {t.liquidity ? (
                        <span style={{ fontSize: 9, color: "var(--win)", fontFamily: "var(--font-mono), monospace" }}>${(t.liquidity / 1000).toFixed(0)}K liq</span>
                      ) : null}
                      {t.mcap ? (
                        <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono), monospace" }}>mc ${t.mcap >= 1000 ? (t.mcap / 1000).toFixed(0) + "K" : t.mcap}</span>
                      ) : null}
                      <span style={{ fontSize: 8, color: "var(--text-dim)", opacity: 0.5, fontFamily: "var(--font-mono), monospace" }}>{platformCount}src</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span className="wx-scan-sig" style={{ color: sig.color, border: `1px solid ${sig.color}40`, background: `${sig.color}0d` }}>
                      {sig.label}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: "var(--text-dim)", fontSize: 9, fontFamily: "var(--font-mono), monospace" }}>
                        {t.mcap ? `$${t.mcap >= 1000 ? (t.mcap / 1000).toFixed(0) + "K" : t.mcap}` : "—"}
                      </span>
                      {t.contractAddress && (
                        <span onClick={(e) => e.stopPropagation()} style={{ position: "relative", display: "inline-block", height: 26, width: 78, flexShrink: 0 }}>
                          <QuickBuyButton contractAddress={t.contractAddress} symbol={displaySymbol} amountSol={0.1} size="compact" />
                        </span>
                      )}
                    </div>
                    <span style={{ color: isExpanded ? "var(--accent-text)" : "var(--text-dim)", fontSize: 9, fontFamily: "var(--font-mono), monospace" }}>
                      {isExpanded ? "▲ WHY" : "▼ WHY"}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 3 }}>
                    <DecisionChain item={t} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {trends.length > 0 && (
        <div className="wx-scan-footer">
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--text-dim)" }}>hot {ultraCount}</span>
            <span style={{ color: "var(--text-dim)" }}>celeb {celebCount}</span>
            <span style={{ color: "var(--text-dim)" }}>fresh {freshCount}</span>
            <span style={{ color: "var(--text-dim)" }}>viral {viralCount}</span>
            <span style={{ color: "var(--text-dim)" }}>safe {trends.filter((t) => t.rugRisk === "low").length}</span>
          </div>
          <span style={{ color: autoScan ? "rgba(34,197,94,0.5)" : "var(--text-dim)" }}>
            {autoScan ? `AUTO ${countdownDisplay}` : "AUTO OFF"}
          </span>
        </div>
      )}

      {hoverPreview && typeof document !== "undefined" && createPortal(
        <div
          style={{ position: "fixed", top: hoverPreview.top, left: hoverPreview.left, zIndex: 1200 }}
          onMouseEnter={() => { if (hoverPreviewCloseRef.current) clearTimeout(hoverPreviewCloseRef.current); }}
          onMouseLeave={handleTokenPreviewLeave}
        >
          <TokenHoverPreview
            contractAddress={hoverPreview.token.contractAddress!}
            symbol={(hoverPreview.token.tokenSymbol || hoverPreview.token.keyword).toUpperCase()}
            name={hoverPreview.token.tokenName || hoverPreview.token.keyword}
            imageUrl={hoverPreview.token.tokenImageUrl}
            onTwitter={hoverPreview.token.onTwitter}
            onTelegram={hoverPreview.token.onTelegram}
            mcap={hoverPreview.token.mcap}
            liquidity={hoverPreview.token.liquidity}
            volume24h={hoverPreview.token.volume}
            priceChange24h={hoverPreview.token.priceChange24h}
            showPaperQuickBuy={false}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
