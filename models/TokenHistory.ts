// ─── TOKEN HISTORY TYPES ──────────────────────────────────────────────────────
// Pure TypeScript interfaces for the native MongoDB driver.
// No Mongoose. Collection name: "tokenHistory"

import { ObjectId } from "mongodb";

export interface McapSnapshot {
  ts: number;
  mcap: number;
}

export interface ITokenHistory {
  _id?: ObjectId;
  userId: string;
  keyword: string;
  displayName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  seenAt: number;
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
  platforms: string[];
  initialMcap: number;
  peakMcap: number;
  // peakMcapTs: timestamp when peakMcap was last raised.
  // WinsPanel only counts a peak as "earned" if peakMcapTs > seenAt + 5 min.
  // This prevents pre-spotted pumps from inflating the win tracker.
  peakMcapTs: number;
  currentMcap: number;
  snapshots: McapSnapshot[];
  lastChecked: number;
  tookProfitAt?: number;
  createdAt?: number;
  updatedAt?: number;
  // ─── AI SCORER ───────────────────────────────────────────────────────────
  // Score 0–100 assigned by /api/ai-score at first sighting.
  // Based on pattern matching against your historical wins.
  // >= 70 = HOT SIGNAL, < 70 = WATCH
  aiScore?: number;
  // Tier tag from scorer: "HOT" | "WATCH" | "SKIP"
  aiTier?: "HOT" | "WATCH" | "SKIP";
  // ─── CONVICTION FIELDS ───────────────────────────────────────────────────
  // Saved at first sighting from the scanner's conviction scorer.
  // Used by LiveSignalsBar to filter — only HIGH/ULTRA + 2+ platforms show.
  twoXTier?: string;
  crossPlatforms?: number;
}

export const TOKEN_HISTORY_COLLECTION = "tokenHistory";
