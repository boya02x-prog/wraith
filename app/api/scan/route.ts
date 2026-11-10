import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { scanLimiter, checkLimit } from "@/lib/ratelimit";

// ═══════════════════════════════════════════════════════════════════════════
// WRAITH SCANNER v24 — HARDENED
//
// SECURITY FIXES:
//   - Auth check: requires valid NextAuth session
//   - Rate limiting: 6 scans per 10 min via Upstash
//   - Module-level state race fixed: all maps moved inside GET()
//   - Score overflow cap: activityScore capped at 10,000,000
//   - Rugcheck expanded: now checks top 15 by TOTAL score
//   - Prompt injection: context values sliced + sanitized before Gemini
//   - SSRF: safeFetch validates host against allowlist before connecting
//   - TWITTER_BEARER: safe decode — never throws URIError on bad encoding
//   - Response size cap: aiContext/narrativeStory trimmed, logs capped at 50
//   - Concurrency limit: Reddit subs capped at 8 concurrent fetches
//   - Env vars: sourced from lib/env.ts with startup validation
// ═══════════════════════════════════════════════════════════════════════════

import { env } from "@/lib/env";
import { aiText, aiAvailable } from "@/lib/ai";
import { getSmartMoneyIntel, type SmartWallet } from "@/lib/getWalletStats";
import {
  recordWalletObservations,
  getWalletReputationBoost,
} from "@/lib/walletReputation";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, Accept: "*/*" };

const PUMP_HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "sec-ch-ua":
    '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  Connection: "keep-alive",
};

// ─── ENV VARS (sourced from validated lib/env.ts) ─────────────────────────


// FIX 5.5: safe decode — never throws URIError on bad encoding
function safeDecodeBearer(raw: string): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    console.warn(
      "[Twitter] TWITTER_BEARER_TOKEN contains invalid URI encoding — using raw value",
    );
    return raw;
  }
}
const TWITTER_BEARER = safeDecodeBearer(env.TWITTER_BEARER_TOKEN);
const TELEGRAM_RSS_BASE = env.TELEGRAM_RSS_BASE;
const REDDIT_USER_AGENT = env.REDDIT_USER_AGENT;
const BIRDEYE_API_KEY = env.BIRDEYE_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MCAP = 500_000;
const MAX_AGE_DAYS = 3;
const MAX_AGE_MINUTES = MAX_AGE_DAYS * 1440;
const MAX_1H_CHANGE = 300;
const MAX_24H_CHANGE = 600;
const MIN_24H_CHANGE = -85;
const MIN_LIQUIDITY = 300;
const MAX_LIQ_MCAP_RATIO = 0.8;
const MIN_VOL_MCAP_RATIO = 0.05;
const CONFIRMATION_MATRIX_THRESHOLD = 2;
const GOLDEN_WINDOW_MIN = 3;
const GOLDEN_WINDOW_MAX = 360;
const GRADUATION_THRESHOLD_MCAP = 50_000;
const ACTIVITY_SCORE_CAP = 10_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2.4 / SSRF: safeFetch host allowlist
// Only these hostnames may ever be fetched. Any URL whose hostname is not in
// this set is rejected before a connection is opened.
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_FETCH_HOSTS = new Set([
  "www.reddit.com",
  "oauth.reddit.com",
  "news.google.com",
  "www.youtube.com",
  "feeds.youtube.com",
  "api.dexscreener.com",
  "api.rugcheck.xyz",
  "frontend-api-v3.pump.fun",
  "frontend-api.pump.fun",
  "public-api.birdeye.so",
  "pro-api.coinmarketcap.com",
  "api.coinmarketcap.com",
  "api.coingecko.com",
  "t.me",
  "rsshub.app",
  "rss.app",
  "tginfo.me",
  "hnrss.org",
  "hacker-news.firebaseio.com",
  "nitter.privacyredirect.com",
  "nitter.poast.org",
  "nitter.net",
  "trends.google.com",
  "knowyourmeme.com",
  "api.twitter.com",
  "api.coinmarketcap.com",
  "www.coinmarketcap.com",
]);

// ─────────────────────────────────────────────────────────────────────────────
// GEOS + CHANNELS
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_TRENDS_GEOS = [
  "US",
  "GB",
  "PH",
  "IN",
  "AU",
  "BR",
  "KR",
  "JP",
  "NG",
  "ZA",
  "CA",
  "MX",
  "ID",
  "TH",
  "VN",
];

const TELEGRAM_CHANNELS = [
  "solana",
  "solanameme",
  "pump_fun",
  "cryptomoonshots",
  "solananews",
  "memecoinsnews",
  "solanadegens",
  "cryptopumpnews",
  "defi_solana",
  "solana_ecosystem",
  "solanaalphagroup",
  "pumpfunalerts",
  "solana_gem_alerts",
  "memecoin_calls",
];

const CELEBS = [
  "Elon Musk",
  "Donald Trump",
  "Vitalik Buterin",
  "CZ Binance",
  "Sam Altman",
  "Marc Andreessen",
  "Snoop Dogg",
  "Kanye West",
  "MrBeast",
  "Kai Cenat",
  "Logan Paul",
  "Jake Paul",
  "Andrew Tate",
  "Pokimane",
  "xQc",
  "Ninja",
  "Shroud",
  "Valkyrae",
  "Lil Pump",
  "Soulja Boy",
  "Cristiano Ronaldo",
  "LeBron James",
  "Stephen Curry",
  "Lionel Messi",
  "Neymar",
  "Addison Rae",
  "Charli DAmelio",
  "Khaby Lame",
  "Zach King",
  "David Dobrik",
  "Bella Poarch",
  "Hasbulla",
  "Adin Ross",
  "IShowSpeed",
  "Duke Dennis",
];

const ANIMAL_VIRAL_SIGNALS = [
  "cat",
  "dog",
  "puppy",
  "kitten",
  "hamster",
  "bunny",
  "rabbit",
  "penguin",
  "duck",
  "frog",
  "fish",
  "parrot",
  "owl",
  "bear",
  "panda",
  "monkey",
  "gorilla",
  "chimp",
  "sloth",
  "raccoon",
  "squirrel",
  "otter",
  "seal",
  "capybara",
  "axolotl",
  "quokka",
  "hedgehog",
  "ferret",
  "chinchilla",
  "meerkat",
  "catto",
  "doggo",
  "pupper",
  "borker",
  "floofer",
  "chonk",
];

const TWITTER_QUERIES = [
  "pump.fun new coin solana -is:retweet lang:en",
  "$solana meme coin launched -is:retweet lang:en",
  "solana viral token new -is:retweet lang:en",
  "pump fun gem solana -is:retweet lang:en",
  "new solana meme coin -is:retweet lang:en",
  "viral animal meme coin -is:retweet lang:en",
  "solana token pump moon -is:retweet lang:en",
  "just launched solana pump fun -is:retweet lang:en",
  "100x potential solana -is:retweet lang:en",
  "viral meme token solana -is:retweet lang:en",
  "low cap gem solana -is:retweet lang:en",
  "trending meme coin pump -is:retweet lang:en",
];

const NITTER_INSTANCES = [
  "https://nitter.privacyredirect.com",
  "https://nitter.poast.org",
  "https://nitter.net",
];

const NITTER_SEARCHES = [
  "solana pump fun new coin",
  "solana meme coin launched",
  "pump fun gem solana",
  "viral solana token",
];

const REDDIT_SUBS = [
  { name: "CryptoMoonShots", tier: 6 },
  { name: "SatoshiStreetBets", tier: 6 },
  { name: "memecoinsmoonshots", tier: 6 },
  { name: "pumpfun", tier: 7 },
  { name: "solana", tier: 5 },
  { name: "memes", tier: 5 },
  { name: "dankmemes", tier: 4 },
  { name: "funny", tier: 3 },
  { name: "videos", tier: 4 },
  { name: "MemeEconomy", tier: 5 },
  { name: "CryptoCurrency", tier: 4 },
  { name: "aww", tier: 6 },
  { name: "AnimalsBeingBros", tier: 5 },
  { name: "nextfuckinglevel", tier: 5 },
  { name: "PublicFreakout", tier: 4 },
  { name: "WTF", tier: 3 },
  { name: "tiktokcringe", tier: 6 },
  { name: "interestingasfuck", tier: 5 },
  { name: "HolUp", tier: 4 },
  { name: "Unexpected", tier: 4 },
  { name: "rarepuppers", tier: 6 },
  { name: "Eyebleach", tier: 5 },
  { name: "CatsAreAssholes", tier: 5 },
  { name: "dogswithjobs", tier: 5 },
  { name: "AbsoluteUnits", tier: 5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// BLACKLIST
// NOTE: This intentionally suppresses known large-cap tokens (DOGE, PEPE,
// TRUMP, etc.) and political names. This is a product decision — WRAITH
// targets micro-cap launches, not established tokens. If you want to track
// established tokens, remove them from this set.
// ─────────────────────────────────────────────────────────────────────────────
const BLACKLIST = new Set([
  "you",
  "the",
  "they",
  "them",
  "this",
  "that",
  "these",
  "those",
  "his",
  "her",
  "its",
  "our",
  "your",
  "their",
  "who",
  "what",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "then",
  "too",
  "very",
  "got",
  "get",
  "has",
  "had",
  "did",
  "does",
  "was",
  "were",
  "are",
  "been",
  "have",
  "said",
  "says",
  "can",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "let",
  "set",
  "put",
  "run",
  "use",
  "see",
  "try",
  "ask",
  "add",
  "end",
  "now",
  "just",
  "even",
  "also",
  "back",
  "away",
  "way",
  "much",
  "many",
  "well",
  "made",
  "make",
  "like",
  "time",
  "know",
  "take",
  "come",
  "good",
  "give",
  "live",
  "work",
  "call",
  "man",
  "men",
  "guy",
  "bro",
  "one",
  "two",
  "three",
  "day",
  "new",
  "old",
  "big",
  "after",
  "under",
  "about",
  "above",
  "across",
  "along",
  "among",
  "around",
  "before",
  "behind",
  "below",
  "beside",
  "between",
  "beyond",
  "during",
  "except",
  "inside",
  "into",
  "near",
  "off",
  "onto",
  "out",
  "over",
  "past",
  "since",
  "through",
  "toward",
  "until",
  "upon",
  "within",
  "without",
  "lol",
  "lmao",
  "wtf",
  "omg",
  "ngl",
  "imo",
  "afk",
  "brb",
  "edit",
  "update",
  "removed",
  "deleted",
  "comment",
  "post",
  "thread",
  "link",
  "image",
  "photo",
  "video",
  "gif",
  "reddit",
  "mods",
  "karma",
  "upvote",
  "downvote",
  "crypto",
  "bitcoin",
  "ethereum",
  "blockchain",
  "token",
  "coins",
  "nft",
  "defi",
  "web3",
  "solana",
  "wallet",
  "trade",
  "trading",
  "invest",
  "investing",
  "market",
  "price",
  "pump",
  "dump",
  "moon",
  "bull",
  "bear",
  "whale",
  "hodl",
  "sell",
  "buy",
  "hold",
  "stake",
  "real",
  "fake",
  "true",
  "false",
  "high",
  "low",
  "hot",
  "cold",
  "fast",
  "slow",
  "long",
  "short",
  "full",
  "empty",
  "open",
  "closed",
  "right",
  "wrong",
  "hard",
  "soft",
  "free",
  "usd",
  "sol",
  "eth",
  "btc",
  "usdc",
  "usdt",
  "bnb",
  "ape",
  "not",
  "but",
  "for",
  "and",
  "its",
  "yes",
  "non",
  "via",
  "per",
  "etc",
  "amp",
  "top",
  "sub",
  "due",
  "hit",
  "won",
  "web",
  "app",
  "bot",
  "api",
  "dev",
  "net",
  "org",
  "com",
  "gov",
  "edu",
  "pro",
  "post",
  "https",
  "http",
  "www",
  "html",
  "css",
  "jpg",
  "png",
  "based",
  "ratio",
  "cope",
  "slay",
  "fire",
  "valid",
  "facts",
  "cap",
  "vibe",
  "vibes",
  "cringe",
  "mid",
  "lit",
  "bussin",
  "sus",
  "bet",
  "fam",
  "bruh",
  "oof",
  "yikes",
  "rip",
  "idk",
  "idc",
  "tbh",
  "nvm",
  "smh",
  "ffs",
  "launch",
  "launched",
  "launching",
  "alpha",
  "early",
  "signal",
  "signals",
  "telegram",
  "twitter",
  "discord",
  "tg",
  "ann",
  "news",
  "info",
  "soon",
  "live",
  "tonight",
  "morning",
  "night",
  "week",
  "month",
  "year",
  "hours",
  "mins",
  "minutes",
  "seconds",
  "ago",
  "later",
  "last",
  "first",
  "second",
  "third",
  "once",
  "twice",
  "always",
  "never",
  "maybe",
  "sure",
  "fine",
  "great",
  "best",
  "worst",
  "scam",
  "rug",
  "rugged",
  "coin",
  "gem",
  "calls",
  "group",
  "chat",
  "channel",
  "join",
  "send",
  "mint",
  "follow",
  "share",
  "repost",
  "retweet",
  "reply",
  "click",
  "check",
  "watch",
  "people",
  "thing",
  "things",
  "going",
  "doing",
  "think",
  "want",
  "need",
  "look",
  "feel",
  "seen",
  "here",
  "there",
  "still",
  "same",
  "another",
  "every",
  "nothing",
  "something",
  "everything",
  "everyone",
  "someone",
  "anyone",
  "using",
  "making",
  "being",
  "having",
  "getting",
  "putting",
  "trying",
  "seeing",
  "with",
  "from",
  "over",
  "have",
  "show",
  "shows",
  "goes",
  "told",
  "next",
  "home",
  "city",
  "street",
  "country",
  "state",
  "house",
  "room",
  "door",
  "hand",
  "head",
  "face",
  "eyes",
  "life",
  "love",
  "death",
  "war",
  "peace",
  "money",
  "game",
  "play",
  "win",
  "lose",
  "team",
  "club",
  "cup",
  "gold",
  "star",
  "king",
  "queen",
  "million",
  "billion",
  "thousand",
  "hundred",
  "percent",
  "number",
  "point",
  "place",
  "world",
  "maga",
  "trump",
  "make",
  "again",
  "doge",
  "pepe",
  "shib",
  "bonk",
  "wif",
  "floki",
  "brett",
  "andy",
  "popcat",
  "samo",
  "orca",
  "mngo",
  "ray",
  "srm",
  "ftt",
  "luna",
  "ust",
  "avax",
  "matic",
  "arb",
  "op",
  "astr",
  "asteroid",
  "biden",
  "harris",
  "elon",
  "obama",
  "putin",
  "modi",
  "zelensky",
  "republican",
  "democrat",
  "liberal",
  "conservative",
  "election",
  "vote",
  "voting",
  "president",
  "senator",
  "congress",
  "politician",
  "policy",
  "government",
  "federal",
  "trump2024",
  "trump2025",
  "maga2024",
  "maga2025",
  "potus",
  "flotus",
  "inflation",
  "recession",
  "gdp",
  "fed",
  "fomc",
  "rates",
  "interest",
  "dollar",
  "euro",
  "bank",
  "banks",
  "stock",
  "stocks",
  "shares",
  "nasdaq",
  "nyse",
  "sp500",
  "dow",
  "jones",
  "portfolio",
  "hedge",
  "fund",
  "etf",
  "ipo",
  "sec",
  "cftc",
  "regulation",
  "lawsuit",
  "hack",
  "exploit",
  "breach",
  "security",
  "password",
  "phishing",
  "scammer",
  "scammers",
  "breaking",
  "alert",
  "latest",
  "report",
  "official",
  "announced",
  "confirmed",
  "sources",
  "leaked",
  "exclusive",
  "urgent",
  "warning",
  "disclaimer",
]);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function cleanTicker(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValidKeyword(k: string): boolean {
  if (!k || k.length < 2 || k.length > 16) return false;
  if (BLACKLIST.has(k.toLowerCase())) return false;
  if (/^\d+$/.test(k)) return false;
  if (!/^[a-z][a-z0-9]*$/.test(k.toLowerCase())) return false;
  return true;
}

// Sanitize user-controlled strings before embedding in Gemini prompts.
// Strips injection characters as defence-in-depth.
function sanitizeForPrompt(input: string, maxLength = 200): string {
  return input
    .slice(0, maxLength)
    .replace(/[`"\\]/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\0/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3.5: Concurrency limiter for outbound fetches
// Prevents a single scan from opening unlimited parallel connections.
// ─────────────────────────────────────────────────────────────────────────────
async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2.4 / SSRF: safeFetch with host allowlist + HTTPS enforcement
// ─────────────────────────────────────────────────────────────────────────────
async function safeFetch(
  url: string,
  extraHeaders: Record<string, string> = {},
  ms = 9000,
  retries = 1,
): Promise<Response | null> {
  // Validate URL and enforce host allowlist before making any connection
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    console.warn("[safeFetch] Invalid URL rejected:", url);
    return null;
  }

  if (parsedUrl.protocol !== "https:") {
    console.warn("[safeFetch] Non-HTTPS URL rejected:", url);
    return null;
  }

  if (!ALLOWED_FETCH_HOSTS.has(parsedUrl.hostname)) {
    console.warn(
      "[safeFetch] Host not in allowlist, blocked:",
      parsedUrl.hostname,
    );
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, {
        headers: { ...HEADERS, ...extraHeaders },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!r.ok) {
        if (r.status === 429 && attempt < retries) {
          await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
          continue;
        }
        return null;
      }
      return r;
    } catch {
      clearTimeout(t);
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVICTION SCORER
// ─────────────────────────────────────────────────────────────────────────────
interface ConvictionInput {
  mcap?: number;
  liquidity?: number;
  volume24h?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  ageMinutes?: number;
  replyCount?: number;
  crossPlatforms?: number;
  hasNarrative?: boolean;
  narrativeFreshH?: number;
  hasCeleb?: boolean;
  hasAnimal?: boolean;
  hasOnchain?: boolean;
  nearGraduation?: boolean;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  confirmationSources?: number;
  topHolderPct?: number;
  smartMoneyScore?: number;
}

interface ConvictionResult {
  score: number;
  tier: "ULTRA" | "HIGH" | "MEDIUM" | "LOW" | "SKIP";
  reasons: string[];
  killers: string[];
}

function calcConviction(input: ConvictionInput): ConvictionResult {
  const reasons: string[] = [];
  const killers: string[] = [];
  let score = 0;

  if (input.rugRisk === "high")
    return { score: 0, tier: "SKIP", reasons: [], killers: ["High rug risk"] };
  if (input.mcap !== undefined && input.mcap > MAX_MCAP)
    return { score: 0, tier: "SKIP", reasons: [], killers: ["Mcap too high"] };

  // NEW: Dead token filter (Mobius Strip heuristic)
  // If a token has high mcap but zero liquidity relative to it, it's a dead end.
  if (input.mcap && input.liquidity) {
    const liqToMcap = input.liquidity / input.mcap;
    if (liqToMcap < 0.005 && input.mcap > 50000) {
      return {
        score: 0,
        tier: "SKIP",
        reasons: [],
        killers: ["Dead liquidity ratio (<0.5%)"],
      };
    }
  }

  // Holder concentration — graduated, not just the >50% binary that rugRisk
  // already enforces upstream. One wallet holding a third of supply is a
  // near-certain dump/rug even if it's under the "high risk" cutoff, so this
  // scales the penalty instead of treating 10% and 49% the same.
  if (input.topHolderPct !== undefined && input.topHolderPct > 0) {
    if (input.topHolderPct > 0.4) {
      return {
        score: 0,
        tier: "SKIP",
        reasons: [],
        killers: [
          `Top holder owns ${(input.topHolderPct * 100).toFixed(0)}% — near-certain dump risk`,
        ],
      };
    } else if (input.topHolderPct > 0.25) {
      score -= 15;
      killers.push(
        `Top holder owns ${(input.topHolderPct * 100).toFixed(0)}% — high concentration`,
      );
    } else if (input.topHolderPct > 0.12) {
      score -= 6;
      killers.push(`Top holder owns ${(input.topHolderPct * 100).toFixed(0)}%`);
    } else {
      score += 4;
      reasons.push("Holders well distributed");
    }
  }
  if (input.priceChange1h !== undefined && input.priceChange1h > MAX_1H_CHANGE)
    return {
      score: 0,
      tier: "SKIP",
      reasons: [],
      killers: [`Already up ${input.priceChange1h.toFixed(0)}% in 1h`],
    };
  if (
    input.priceChange24h !== undefined &&
    input.priceChange24h < MIN_24H_CHANGE
  )
    return {
      score: 0,
      tier: "SKIP",
      reasons: [],
      killers: ["Down too much 24h"],
    };
  if (
    input.liquidity !== undefined &&
    input.liquidity > 0 &&
    input.liquidity < MIN_LIQUIDITY
  )
    return {
      score: 0,
      tier: "SKIP",
      reasons: [],
      killers: [`Only $${input.liquidity.toFixed(0)} liq`],
    };

  if (input.liquidity) {
    if (input.liquidity >= 50000) {
      score += 15;
      reasons.push(`$${(input.liquidity / 1000).toFixed(0)}K liq — deep`);
    } else if (input.liquidity >= 20000) {
      score += 12;
      reasons.push(`$${(input.liquidity / 1000).toFixed(0)}K liq — solid`);
    } else if (input.liquidity >= 10000) {
      score += 9;
      reasons.push(`$${(input.liquidity / 1000).toFixed(0)}K liq — ok`);
    } else if (input.liquidity >= 2000) {
      score += 6;
      reasons.push(`$${(input.liquidity / 1000).toFixed(1)}K liq`);
    } else if (input.liquidity >= MIN_LIQUIDITY) {
      score += 3;
      killers.push(`Low liq $${input.liquidity.toFixed(0)}`);
    } else {
      score += 1;
      killers.push("Very low liq");
    }
  } else {
    score += 4;
  }

  if (input.mcap) {
    if (input.mcap < 5000) {
      score += 20;
      reasons.push(`$${(input.mcap / 1000).toFixed(1)}K mcap — ultra early`);
    } else if (input.mcap < 15000) {
      score += 18;
      reasons.push(`$${(input.mcap / 1000).toFixed(1)}K mcap — very early`);
    } else if (input.mcap < 40000) {
      score += 15;
      reasons.push(`$${(input.mcap / 1000).toFixed(0)}K mcap — early`);
    } else if (input.mcap < 80000) {
      score += 10;
      reasons.push(`$${(input.mcap / 1000).toFixed(0)}K mcap — reasonable`);
    } else if (input.mcap < 200000) {
      score += 6;
      reasons.push(`$${(input.mcap / 1000).toFixed(0)}K mcap`);
    } else if (input.mcap < 350000) {
      score += 3;
      killers.push(`$${(input.mcap / 1000).toFixed(0)}K mcap — limited upside`);
    } else {
      score += 1;
      killers.push(`$${(input.mcap / 1000).toFixed(0)}K mcap — high cap`);
    }
  } else {
    score += 8;
    reasons.push("No mcap yet — possibly just launching");
  }

  if (input.ageMinutes !== undefined) {
    if (
      input.ageMinutes >= GOLDEN_WINDOW_MIN &&
      input.ageMinutes <= GOLDEN_WINDOW_MAX
    ) {
      score += 20;
      reasons.push(`${input.ageMinutes}m old — golden window ⚡`);
    } else if (input.ageMinutes < GOLDEN_WINDOW_MIN) {
      score += 14;
      reasons.push(`${input.ageMinutes}m old — ultra fresh`);
    } else if (input.ageMinutes <= 720) {
      score += 10;
      reasons.push(`${Math.floor(input.ageMinutes / 60)}h old — still early`);
    } else if (input.ageMinutes <= 1440) {
      score += 5;
    } else {
      score += 1;
      killers.push(`${Math.floor(input.ageMinutes / 1440)}d old — stale`);
    }
  }

  if (input.volume24h && input.mcap && input.mcap > 0) {
    const ratio = input.volume24h / input.mcap;
    if (ratio >= 5) {
      score += 15;
      reasons.push(`Vol ${ratio.toFixed(0)}x mcap — EXPLOSIVE`);
    } else if (ratio >= 2) {
      score += 12;
      reasons.push(`Vol ${ratio.toFixed(1)}x mcap — strong`);
    } else if (ratio >= 1) {
      score += 9;
      reasons.push("Vol > mcap — active");
    } else if (ratio >= MIN_VOL_MCAP_RATIO) {
      score += 5;
    }
  }
  if (!input.volume24h) score += 3;

  if (input.hasNarrative) {
    const freshBonus =
      input.narrativeFreshH !== undefined && input.narrativeFreshH < 6 ? 5 : 0;
    score += 10 + freshBonus;
    reasons.push(
      freshBonus > 0 ? "Fresh narrative < 6h" : "Narrative confirmed",
    );
  }
  if (input.hasCeleb) {
    score += 15;
    reasons.push("Celebrity trigger");
  }
  if (input.hasAnimal) {
    score += 8;
    reasons.push("Viral animal meme");
  }
  if (input.nearGraduation) {
    score += 10;
    reasons.push("Near pump.fun graduation");
  }

  const confirmSources = input.confirmationSources || input.crossPlatforms || 0;
  if (confirmSources >= 5) {
    score += 10;
    reasons.push(`${confirmSources} independent sources`);
  } else if (confirmSources >= 3) {
    score += 8;
    reasons.push(`${confirmSources} sources`);
  } else if (confirmSources >= 2) {
    score += 5;
    reasons.push(`${confirmSources} sources`);
  }

  if (
    input.priceChange1h !== undefined &&
    input.priceChange1h > 20 &&
    input.priceChange1h <= 150
  ) {
    score += 5;
    reasons.push(`+${input.priceChange1h.toFixed(0)}% 1h — organic pump`);
  }

  if (input.rugRisk === "low") {
    score += 5;
    reasons.push("Passed rugcheck");
  } else if (input.rugRisk === "medium") {
    score -= 5;
    killers.push("Medium rug risk");
  }

  if (input.smartMoneyScore !== undefined && input.smartMoneyScore > 0) {
    if (input.smartMoneyScore >= 60) {
      score += 15;
      reasons.push("Confirmed-winning wallets buying in");
    } else if (input.smartMoneyScore >= 30) {
      score += 8;
      reasons.push("Some smart money present");
    }
  }

  score = Math.max(0, Math.min(100, score));
  const tier: ConvictionResult["tier"] =
    score >= 70
      ? "ULTRA"
      : score >= 45
        ? "HIGH"
        : score >= 25
          ? "MEDIUM"
          : score >= 10
            ? "LOW"
            : "SKIP";

  return { score, tier, reasons, killers };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLIERS
// ─────────────────────────────────────────────────────────────────────────────
function mcapMultiplier(mcap: number | undefined): number {
  if (!mcap || mcap === 0) return 1.5;
  if (mcap > MAX_MCAP) return 0;
  if (mcap < 3_000) return 15.0;
  if (mcap < 8_000) return 12.0;
  if (mcap < 20_000) return 8.0;
  if (mcap < 50_000) return 5.5;
  if (mcap < 100_000) return 3.5;
  if (mcap < 200_000) return 2.0;
  if (mcap < 350_000) return 1.3;
  return 1.0;
}

function ageMultiplier(ageMinutes: number | undefined): number {
  if (ageMinutes === undefined) return 0.5;
  const days = ageMinutes / 1440;
  if (days > MAX_AGE_DAYS) return 0;
  if (days > 2) return 0.3;
  if (days > 1) return 0.6;
  if (ageMinutes > 720) return 1.2;
  if (ageMinutes > 360) return 2.0;
  if (ageMinutes > 120) return 3.5;
  if (ageMinutes > 60) return 5.0;
  if (ageMinutes > 15) return 7.0;
  if (ageMinutes > 3) return 6.0;
  return 4.0;
}

function velocityMultiplier(
  score: number,
  ageMinutes: number | undefined,
): number {
  if (!ageMinutes || ageMinutes === 0) return 1.0;
  const velocity = score / Math.max(ageMinutes, 1);
  if (velocity > 10000) return 4.0;
  if (velocity > 5000) return 3.0;
  if (velocity > 1000) return 2.0;
  if (velocity > 500) return 1.5;
  return 1.0;
}

function volumeSpikeMultiplier(
  volume: number | undefined,
  mcap: number | undefined,
): number {
  if (!volume || !mcap || mcap === 0) return 1.0;
  const ratio = volume / mcap;
  if (ratio > 10) return 5.0;
  if (ratio > 5) return 3.5;
  if (ratio > 2) return 2.0;
  if (ratio > 1) return 1.5;
  return 1.0;
}

function getAnimalBoost(keyword: string, context: string): number {
  const combined = `${keyword} ${context}`.toLowerCase();
  for (const animal of ANIMAL_VIRAL_SIGNALS) {
    if (combined.includes(animal)) return 2.5;
  }
  return 1.0;
}

function generateTickerVariants(
  primaryTicker: string,
  emotionWords: string[],
  headline: string,
): string[] {
  const variants = new Set<string>();
  const primary = cleanTicker(primaryTicker);
  if (isValidKeyword(primary)) variants.add(primary);
  for (const w of emotionWords) {
    const clean = cleanTicker(w);
    if (isValidKeyword(clean)) variants.add(clean);
  }
  for (const w of emotionWords.slice(0, 4)) {
    const clean = cleanTicker(w);
    if (!clean || clean.length < 2) continue;
    const fwd = cleanTicker(primary + clean);
    const bwd = cleanTicker(clean + primary);
    if (fwd.length <= 12 && isValidKeyword(fwd)) variants.add(fwd);
    if (bwd.length <= 12 && isValidKeyword(bwd)) variants.add(bwd);
  }
  const animalWords =
    headline
      .toLowerCase()
      .match(
        /\b(cat|dog|monkey|bear|frog|fish|bird|duck|pig|cow|fox|wolf|lion|tiger|panda|koala|bunny|rabbit|hamster|penguin|owl|eagle|hawk|shark|whale|dolphin|horse|goat|sheep|chicken|gorilla|chimp|ape|seal|otter|deer|mouse|rat|snake|turtle|crab|octopus|parrot|sloth|raccoon|squirrel|capybara|axolotl|quokka|hedgehog)\b/g,
      ) || [];
  for (const animal of animalWords) {
    if (isValidKeyword(animal)) variants.add(animal);
  }
  return Array.from(variants).slice(0, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// STORY REGISTRY (types only — instances created inside GET)
// ─────────────────────────────────────────────────────────────────────────────
interface ViralStory {
  id: string;
  headline: string;
  archetypeType: string;
  coinabilityScore: number;
  predictedTickers: string[];
  confirmedTicker?: string;
  confirmedMcap?: number;
  confirmedAge?: number;
  confirmedCA?: string;
  source: string;
  impressions?: number;
  emotionWords: string[];
  hasFanCommunity?: boolean;
  fanCommunitySize?: number;
  postedAt?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TWITTER SCANNER
// ─────────────────────────────────────────────────────────────────────────────
async function scanTwitter(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
): Promise<{
  results: { keyword: string; score: number; context: string }[];
  rawTexts: string[];
  count: number;
  logs: string[];
}> {
  const results: { keyword: string; score: number; context: string }[] = [];
  const rawTexts: string[] = [];
  const logs: string[] = [];
  const wordMap = new Map<string, { score: number; context: string }>();

  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );

  let twitterApiWorked = false;

  if (TWITTER_BEARER) {
    const twitterHeaders = {
      Authorization: `Bearer ${TWITTER_BEARER}`,
      "Content-Type": "application/json",
      "x-twitter-client-language": "en",
      "x-twitter-active-environment": "production",
    };
    let totalTweets = 0;
    let successCount = 0;

    // Fired in parallel instead of one-after-another — each request already
    // has its own 10s timeout via safeFetch, so the worst-case wait for all
    // 6 queries drops from ~60s (sequential) to ~10s (parallel).
    const twitterSettled = await Promise.allSettled(
      TWITTER_QUERIES.slice(0, 6).map(async (query) => {
        const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100&tweet.fields=public_metrics,created_at&expansions=author_id`;
        const r = await safeFetch(url, twitterHeaders, 10000);
        if (!r) {
          return { query, ok: false as const, status: 0 };
        }
        if (!r.ok) {
          return { query, ok: false as const, status: r.status };
        }
        const data = await r.json();
        return { query, ok: true as const, tweets: data?.data || [] };
      }),
    );

    for (const settled of twitterSettled) {
      if (settled.status !== "fulfilled") {
        logs.push(
          `[Twitter] ✗ query failed: ${String(settled.reason).slice(0, 60)}`,
        );
        continue;
      }
      const outcome = settled.value;
      if (!outcome.ok) {
        if ("status" in outcome && outcome.status === 0) {
          logs.push(
            `[Twitter] ✗ "${outcome.query.slice(0, 30)}" — blocked or failed`,
          );
        } else {
          logs.push(
            `[Twitter] ✗ "${outcome.query.slice(0, 30)}" HTTP ${outcome.status}`,
          );
        }
        continue;
      }
      try {
        twitterApiWorked = true;
        const tweets = outcome.tweets;
        totalTweets += tweets.length;
        successCount++;
        for (const tweet of tweets) {
          const text = (tweet.text || "").toLowerCase();
          const metrics = tweet.public_metrics || {};
          const likes = metrics.like_count || 0;
          const retweets = metrics.retweet_count || 0;
          const replies = metrics.reply_count || 0;
          const impressions = metrics.impression_count || 0;
          const quotes = metrics.quote_count || 0;
          const createdAt = tweet.created_at
            ? new Date(tweet.created_at).getTime()
            : Date.now();
          const ageH = (Date.now() - createdAt) / 3600000;
          const recencyMult =
            ageH < 1
              ? 5.0
              : ageH < 3
                ? 3.0
                : ageH < 6
                  ? 2.0
                  : ageH < 24
                    ? 1.5
                    : 1.0;
          const engagementRate =
            (replies + quotes) / Math.max(impressions / 1000, 1);
          const socialProofMult =
            engagementRate > 5 ? 2.0 : engagementRate > 2 ? 1.5 : 1.0;
          const engagement =
            (likes * 2 +
              retweets * 4 +
              replies * 3 +
              quotes * 2 +
              impressions * 0.001) *
            recencyMult *
            socialProofMult;
          rawTexts.push(text.slice(0, 200));
          for (const m of text.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
            const ticker = cleanTicker(m[1]);
            if (isValidKeyword(ticker)) {
              const ex = wordMap.get(ticker);
              wordMap.set(ticker, {
                score: (ex?.score || 0) + engagement * 5,
                context: ex?.context || text.slice(0, 100),
              });
              registerViralWord(
                ticker,
                `Twitter: "${text.slice(0, 80)}"`,
                "twitter",
              );
            }
          }
          if (engagement > 500) {
            const properNouns =
              tweet.text?.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
            for (const noun of properNouns) {
              const clean = cleanTicker(noun);
              if (isValidKeyword(clean)) {
                const ex = wordMap.get(clean);
                wordMap.set(clean, {
                  score: (ex?.score || 0) + engagement * 1.5,
                  context: ex?.context || text.slice(0, 100),
                });
                registerViralWord(
                  clean,
                  `Twitter trending: "${text.slice(0, 60)}"`,
                  "twitter",
                );
              }
            }
          }
        }
      } catch (e) {
        logs.push(`[Twitter] ✗ query failed: ${String(e).slice(0, 60)}`);
      }
    }
    if (twitterApiWorked) {
      logs.push(
        `[Twitter API] ✓ ${totalTweets} tweets from ${successCount} queries`,
      );
    }
  } else {
    logs.push("[Twitter] No bearer token — using Nitter fallback");
  }

  if (!twitterApiWorked) {
    logs.push("[Nitter] Attempting RSS fallback...");
    let nitterWorked = false;
    // All instance×query combos (12 total) fired in parallel instead of
    // nested sequential loops. Each request already carries its own 8s
    // timeout via safeFetch, so the worst-case wait drops from ~96s
    // (3 instances x 4 queries, sequential) to ~8s (all at once).
    const nitterCombos = NITTER_INSTANCES.flatMap((instance) =>
      NITTER_SEARCHES.map((query) => ({ instance, query })),
    );
    const nitterSettled = await Promise.allSettled(
      nitterCombos.map(async ({ instance, query }) => {
        const url = `${instance}/search/rss?q=${encodeURIComponent(query)}&f=tweets`;
        const r = await safeFetch(
          url,
          { Accept: "application/rss+xml, text/xml" },
          8000,
        );
        if (!r) return { instance, ok: false as const };
        const xml = await r.text();
        if (!xml.includes("<item>")) return { instance, ok: false as const };
        return { instance, ok: true as const, xml };
      }),
    );

    const instanceSuccessCount = new Map<string, number>();
    for (const settled of nitterSettled) {
      if (settled.status !== "fulfilled" || !settled.value.ok) continue;
      const { instance, xml } = settled.value;
      nitterWorked = true;
      instanceSuccessCount.set(
        instance,
        (instanceSuccessCount.get(instance) || 0) + 1,
      );
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 30)) {
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
        const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const text = ((titleMatch?.[1] || "") + " " + (descMatch?.[1] || ""))
          .replace(/<!\[CDATA\[|\]\]>/g, "")
          .replace(/<[^>]+>/g, "")
          .toLowerCase()
          .trim();
        if (!text || text.length < 10) continue;
        let recencyMult = 1.0;
        if (pubDateMatch?.[1]) {
          const ageH =
            (Date.now() - new Date(pubDateMatch[1]).getTime()) / 3600000;
          recencyMult = ageH < 1 ? 4.0 : ageH < 3 ? 3.0 : ageH < 6 ? 2.0 : 1.5;
        }
        rawTexts.push(text.slice(0, 200));
        for (const m of text.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
          const ticker = cleanTicker(m[1]);
          if (isValidKeyword(ticker)) {
            const ex = wordMap.get(ticker);
            wordMap.set(ticker, {
              score: (ex?.score || 0) + 3000 * recencyMult,
              context: ex?.context || text.slice(0, 100),
            });
            registerViralWord(
              ticker,
              `Nitter: "${text.slice(0, 80)}"`,
              "twitter",
            );
          }
        }
      }
    }
    for (const [instance, count] of instanceSuccessCount) {
      logs.push(`[Nitter] ✓ ${instance} — ${count} queries worked`);
    }
    if (!nitterWorked) {
      logs.push("[Nitter] All instances failed — no Twitter data");
    }
  }

  for (const [keyword, { score, context }] of wordMap.entries())
    results.push({ keyword, score: score * 600, context });
  logs.push(
    `[Twitter] TOTAL: ${rawTexts.length} texts, ${results.length} signals`,
  );
  return {
    results: results.sort((a, b) => b.score - a.score),
    rawTexts,
    count: results.length,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM SCANNER
// ─────────────────────────────────────────────────────────────────────────────
async function scanTelegram(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
): Promise<{
  results: { keyword: string; score: number; context: string }[];
  rawTexts: string[];
  count: number;
  logs: string[];
}> {
  const results: { keyword: string; score: number; context: string }[] = [];
  const rawTexts: string[] = [];
  const logs: string[] = [];
  const wordMap = new Map<string, { score: number; context: string }>();
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );

  const rssProxies = [
    (ch: string) => `${TELEGRAM_RSS_BASE}/${ch}`,
    (ch: string) => `https://rsshub.app/telegram/channel/${ch}`,
    (ch: string) => `https://rss.app/feeds/_telegram_${ch}.xml`,
    (ch: string) => `https://tginfo.me/rss/${ch}/`,
  ];

  await Promise.all(
    TELEGRAM_CHANNELS.map(async (channel) => {
      let success = false;
      for (const proxyFn of rssProxies) {
        if (success) break;
        try {
          const url = proxyFn(channel);
          const r = await safeFetch(
            url,
            { Accept: "application/rss+xml, text/xml, application/xml" },
            8000,
          );
          if (!r) continue;
          const xml = await r.text();
          if (!xml.includes("<item>") && !xml.includes("<entry>")) continue;
          success = true;
          const items =
            xml.match(/<item>[\s\S]*?<\/item>/g) ||
            xml.match(/<entry>[\s\S]*?<\/entry>/g) ||
            [];
          let postsProcessed = 0;
          for (const item of items.slice(0, 20)) {
            const titleMatch = item.match(/<title[^>]*>([\s\S]*?)<\/title>/);
            const descMatch = item.match(
              /<(?:description|content)[^>]*>([\s\S]*?)<\/(?:description|content)>/,
            );
            const pubDateMatch = item.match(
              /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/,
            );
            if (pubDateMatch?.[1]) {
              const postAge =
                (Date.now() - new Date(pubDateMatch[1]).getTime()) / 60000;
              if (postAge > MAX_AGE_MINUTES) continue;
            }
            const rawText = (
              (titleMatch?.[1] || "") +
              " " +
              (descMatch?.[1] || "")
            )
              .replace(/<!\[CDATA\[|\]\]>/g, "")
              .replace(/<[^>]+>/g, "")
              .trim();
            const text = rawText.toLowerCase();
            if (!text || text.length < 10) continue;
            rawTexts.push(text.slice(0, 200));
            postsProcessed++;
            let recencyMult = 1.0;
            if (pubDateMatch?.[1]) {
              const ageH =
                (Date.now() - new Date(pubDateMatch[1]).getTime()) / 3600000;
              recencyMult =
                ageH < 1
                  ? 5.0
                  : ageH < 3
                    ? 3.5
                    : ageH < 6
                      ? 2.5
                      : ageH < 24
                        ? 1.5
                        : 1.0;
            }
            const channelTier =
              channel.includes("pump") ||
              channel.includes("alert") ||
              channel.includes("gem")
                ? 3.5
                : channel.includes("alpha")
                  ? 3.0
                  : 2.0;
            for (const m of text.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
              const ticker = cleanTicker(m[1]);
              if (isValidKeyword(ticker)) {
                const ex = wordMap.get(ticker);
                wordMap.set(ticker, {
                  score: (ex?.score || 0) + 8000 * recencyMult * channelTier,
                  context: ex?.context || text.slice(0, 100),
                });
                registerViralWord(
                  ticker,
                  `Telegram @${channel}: "${text.slice(0, 60)}"`,
                  "telegram",
                );
              }
            }
          }
          logs.push(`[Telegram] @${channel}: ${postsProcessed} posts ✓`);
        } catch {
          continue;
        }
      }

      if (!success) {
        try {
          const r = await safeFetch(
            `https://t.me/s/${channel}`,
            { Accept: "text/html,*/*", "Cache-Control": "no-cache" },
            8000,
          );
          if (r) {
            const html = await r.text();
            const msgBlocks =
              html.match(
                /<div class="tgme_widget_message_bubble"[\s\S]*?<\/div>\s*<\/div>/g,
              ) || [];
            const blocks =
              msgBlocks.length > 0
                ? msgBlocks
                : html.match(
                    /<div class="tgme_widget_message_text[^"]*"[^>]*>[\s\S]*?<\/div>/g,
                  ) || [];
            let scraped = 0;
            for (const block of blocks.slice(0, 15)) {
              const dtMatch = block.match(/<time[^>]+datetime="([^"]+)"/);
              if (dtMatch?.[1]) {
                const postAgeMinutes =
                  (Date.now() - new Date(dtMatch[1]).getTime()) / 60000;
                if (postAgeMinutes > MAX_AGE_MINUTES) continue;
              }
              const text = block
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
              if (!text || text.length < 10) continue;
              let recencyMult = 1.0;
              if (dtMatch?.[1]) {
                const ageH =
                  (Date.now() - new Date(dtMatch[1]).getTime()) / 3600000;
                recencyMult =
                  ageH < 1
                    ? 5.0
                    : ageH < 3
                      ? 3.5
                      : ageH < 6
                        ? 2.5
                        : ageH < 24
                          ? 1.5
                          : 1.0;
              }
              rawTexts.push(text.slice(0, 200));
              scraped++;
              for (const m of text.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
                const ticker = cleanTicker(m[1]);
                if (isValidKeyword(ticker)) {
                  const ex = wordMap.get(ticker);
                  wordMap.set(ticker, {
                    score: (ex?.score || 0) + 5000 * recencyMult,
                    context: ex?.context || text.slice(0, 100),
                  });
                  registerViralWord(
                    ticker,
                    `Telegram @${channel} (scraped)`,
                    "telegram",
                  );
                }
              }
            }
            if (scraped > 0) {
              logs.push(
                `[Telegram] @${channel}: ${scraped} posts (web scrape) ✓`,
              );
              success = true;
            }
          }
        } catch {
          /* skip */
        }
      }

      if (!success) {
        logs.push(`[Telegram] @${channel}: all methods failed`);
      }
    }),
  );

  for (const [keyword, { score, context }] of wordMap.entries())
    results.push({ keyword, score, context });
  logs.push(
    `[Telegram] total: ${results.length} signals from ${rawTexts.length} posts`,
  );
  return {
    results: results.sort((a, b) => b.score - a.score),
    rawTexts,
    count: results.length,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUMP.FUN SCANNER
// ─────────────────────────────────────────────────────────────────────────────
type PumpResult = {
  keyword: string;
  score: number;
  isNew: boolean;
  ageMinutes: number;
  mcap: number;
  volume: number;
  contractAddress?: string;
  name?: string;
  description?: string;
  replyCount?: number;
  nearGraduation?: boolean;
};

async function scanPumpFun(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const results: PumpResult[] = [];
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );

  const endpoints = [
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=reply_count&order=DESC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=50&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=ASC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=100&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=market_cap&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins/king-of-the-hill?includeNsfw=false",
  ];

  const pumpLogs: string[] = [];
  const seen = new Set<string>();
  let totalSuccess = 0;

  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, {
        headers: PUMP_HEADERS,
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!r.ok) {
        pumpLogs.push(`[Pump.fun] ✗ ${url.slice(40, 80)} HTTP ${r.status}`);
        if (r.status === 403) {
          const r2 = await safeFetch(
            url,
            {
              Origin: "https://pump.fun",
              Referer: "https://pump.fun/board",
              "X-Requested-With": "XMLHttpRequest",
            },
            8000,
          );
          if (!r2) continue;
          const data2 = await r2.json();
          const coins2 = Array.isArray(data2) ? data2 : [data2];
          processPumpCoins(coins2, seen, results, pumpLogs, registerViralWord);
        }
        continue;
      }

      const data = await r.json();
      const coins = Array.isArray(data) ? data : [data];
      const added = processPumpCoins(
        coins,
        seen,
        results,
        pumpLogs,
        registerViralWord,
      );
      totalSuccess++;
      pumpLogs.push(`[Pump.fun] ✓ ${url.slice(40, 80)} — ${added} coins`);
    } catch (e) {
      pumpLogs.push(
        `[Pump.fun] ✗ ${url.slice(40, 80)} — ${String(e).slice(0, 60)}`,
      );
    }
  }

  if (totalSuccess === 0) {
    pumpLogs.push(
      "[Pump.fun] All endpoints failed — pulling new tokens from DexScreener fallback",
    );
    try {
      const r = await safeFetch(
        "https://api.dexscreener.com/token-profiles/latest/v1",
        {},
        8000,
      );
      if (r) {
        const data = await r.json();
        let added = 0;
        for (const token of (data || []).slice(0, 50)) {
          if (token.chainId !== "solana") continue;
          const sym = cleanTicker(
            token.symbol || token.baseToken?.symbol || "",
          );
          if (!sym || !isValidKeyword(sym) || seen.has(sym)) continue;
          const mcap = token.fdv || token.marketCap || 0;
          if (mcap >= MAX_MCAP && mcap > 0) continue;
          seen.add(sym);
          results.push({
            keyword: sym,
            score: 15000,
            isNew: true,
            ageMinutes: 60,
            mcap,
            volume: 0,
            contractAddress: token.tokenAddress,
            name: sym,
            description: "",
            replyCount: 0,
            nearGraduation: mcap >= GRADUATION_THRESHOLD_MCAP,
          });
          added++;
        }
        pumpLogs.push(`[DexScreener fallback] ${added} tokens`);
      }
    } catch {
      /* skip */
    }
  }

  return { results, logs: pumpLogs };
}

function processPumpCoins(
  coins: Record<string, unknown>[],
  seen: Set<string>,
  results: PumpResult[],
  _pumpLogs: string[],
  registerViralWord: (
    word: string,
    context: string,
    sourceType?: string,
  ) => void,
): number {
  let added = 0;
  for (const coin of coins) {
    const sym = cleanTicker((coin.symbol as string) || "");
    if (!isValidKeyword(sym) || seen.has(sym)) continue;
    const mcap = (coin.usd_market_cap as number) || 0;
    const replies = (coin.reply_count as number) || 0;
    const createdTs = (coin.created_timestamp as number) || Date.now();
    const ageMinutes = Math.floor((Date.now() - createdTs) / 60000);
    const volume = (coin.volume as number) || 0;
    const description = ((coin.description as string) || "").toLowerCase();
    const name = (coin.name as string) || "";

    if (mcap >= MAX_MCAP) continue;
    if (ageMinutes > MAX_AGE_MINUTES) continue;

    const ageMult = ageMultiplier(ageMinutes);
    const mcapMult = mcapMultiplier(mcap);
    if (ageMult === 0 || mcapMult === 0) continue;

    const volSpike = volumeSpikeMultiplier(volume, mcap);
    const freshBonus =
      ageMinutes < 5
        ? 10.0
        : ageMinutes < 15
          ? 8.0
          : ageMinutes < 30
            ? 7.0
            : ageMinutes < 120
              ? 4.5
              : ageMinutes < 360
                ? 2.5
                : ageMinutes < 1440
                  ? 1.5
                  : 1.0;
    const animalBoost = getAnimalBoost(sym, description + " " + name);
    const nearGraduation = mcap >= GRADUATION_THRESHOLD_MCAP && mcap < MAX_MCAP;
    const gradBonus = nearGraduation ? 2.5 : 1.0;

    const activityScore = Math.min(
      (replies * 900 +
        Math.max(Math.min(mcap, 100000) * 0.12, 50) +
        volume * 0.05) *
        freshBonus *
        ageMult *
        mcapMult *
        volSpike *
        animalBoost *
        gradBonus,
      ACTIVITY_SCORE_CAP,
    );

    seen.add(sym);
    results.push({
      keyword: sym,
      score: activityScore,
      isNew: ageMinutes < 1440,
      ageMinutes,
      mcap,
      volume,
      contractAddress: (coin.mint as string) || undefined,
      name,
      description,
      replyCount: replies,
      nearGraduation,
    });

    if (description.length > 10) {
      for (const w of description.split(/[\s\-_,.()/!?'"#@]+/)) {
        const clean = cleanTicker(w);
        if (isValidKeyword(clean) && clean.length >= 4 && clean !== sym)
          registerViralWord(
            clean,
            `Pump.fun desc: "${description.slice(0, 60)}"`,
            "pumpfun",
          );
      }
    }
    if (name.length > 2) {
      for (const w of name.toLowerCase().split(/[\s\-_]+/)) {
        const clean = cleanTicker(w);
        if (isValidKeyword(clean) && clean.length >= 4 && clean !== sym)
          registerViralWord(clean, `Pump.fun name: "${name}"`, "pumpfun");
      }
    }
    added++;
  }
  return added;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI
// ─────────────────────────────────────────────────────────────────────────────
interface GeminiStory {
  ticker: string;
  tickerVariants?: string[];
  headline: string;
  archetypeType: string;
  coinabilityScore: number;
  emotionWords: string[];
  platforms: string[];
  impressions?: number;
  coinAlreadyExists: boolean;
  coinMcap?: number;
  coinAgeDays?: number;
  narrativeContext: string;
  celebMention?: string;
  hasFanCommunity?: boolean;
  fanCommunitySize?: number;
}

async function geminiRequest(
  prompt: string,
  maxTokens: number,
  _retries = 3,
): Promise<string | null> {
  void _retries;
  return aiText(prompt, { maxTokens, temperature: 0.05, timeoutMs: 40000 });
}

async function analyzeWithGemini(rawData: {
  twitterTexts: string[];
  telegramTexts: string[];
  redditTitles: string[];
  googleNewsTitles: string[];
  trendingWords: string[];
  newPumpCoins: {
    name: string;
    description: string;
    symbol: string;
    mcap: number;
    ageMinutes: number;
  }[];
}): Promise<{ stories: GeminiStory[]; success: boolean; error?: string }> {
  if (!aiAvailable())
    return { stories: [], success: false, error: "No AI key (set GEMINI_API_KEY or GROQ_API_KEY)" };
  const today = new Date().toUTCString();

  // Sanitize all user-controlled strings before embedding in Gemini prompt
  const safeTwitterTexts = rawData.twitterTexts
    .slice(0, 40)
    .map((t) => sanitizeForPrompt(t, 200));
  const safeTelegramTexts = rawData.telegramTexts
    .slice(0, 30)
    .map((t) => sanitizeForPrompt(t, 200));
  const safeRedditTitles = rawData.redditTitles
    .slice(0, 25)
    .map((t) => sanitizeForPrompt(t, 150));
  const safeNewsTitles = rawData.googleNewsTitles
    .slice(0, 20)
    .map((t) => sanitizeForPrompt(t, 150));
  const safeTrendingWords = rawData.trendingWords
    .slice(0, 30)
    .map((t) => sanitizeForPrompt(t, 30));
  const safePumpCoins = rawData.newPumpCoins.slice(0, 20).map((c) => ({
    ...c,
    name: sanitizeForPrompt(c.name, 30),
    description: sanitizeForPrompt(c.description, 60),
    symbol: sanitizeForPrompt(c.symbol, 16),
  }));

  const prompt = `You are a meme coin 2x probability analyst for Solana. Today is ${today}.

Your ONLY job: find tokens/narratives where a buyer RIGHT NOW has >50% chance of 2x within 2-6 hours.

Focus on tokens that are:
1. CURRENTLY PUMPING with confirmed on-chain + social signal (the narrative just hit)
2. In the window: 3-360 minutes old, under $500K mcap
3. Have a SPECIFIC story (not vague — what EXACTLY is the meme and why now)
4. NOT already pumped 300%+ (don't buy tops)

═══ TWITTER/X POSTS ═══
${safeTwitterTexts.join("\n")}

═══ TELEGRAM ALPHA ═══
${safeTelegramTexts.join("\n")}

═══ REDDIT POSTS ═══
${safeRedditTitles.join("\n")}

═══ GOOGLE NEWS HEADLINES ═══
${safeNewsTitles.join("\n")}

═══ TRENDING WORDS ═══
${safeTrendingWords.join(", ")}

═══ NEW PUMP.FUN COINS (last 6h) ═══
${safePumpCoins.map((c) => `$${c.symbol} '${c.name}' mcap:$${Math.round(c.mcap)} age:${c.ageMinutes}min — ${c.description}`).join("\n")}

Return ONLY valid JSON:
{"stories":[{"ticker":"WORD","tickerVariants":["word","wordmeme"],"headline":"[SPECIFIC story driving this RIGHT NOW]","archetypeType":"viral_animal|celebrity_moment|underdog|cultural_moment|tech_viral|fan_community","coinabilityScore":88,"emotionWords":["word","meme"],"platforms":["twitter","telegram"],"impressions":50000,"coinAlreadyExists":true,"coinMcap":15000,"coinAgeDays":0.05,"narrativeContext":"[WHY 2x in next 2-6h]","celebMention":null,"hasFanCommunity":false,"fanCommunitySize":null}]}

RULES: MAX 15. coinabilityScore = 2x probability. Skip 300%+ pumped. coinMcap under 500000.`;

  const text = await geminiRequest(prompt, 4000);
  if (!text)
    return {
      stories: [],
      success: false,
      error: "Gemini 429 / timeout after retries",
    };

  try {
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    let parsed: { stories: GeminiStory[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return { stories: [], success: false, error: "Bad JSON" };
      parsed = JSON.parse(m[0]);
    }
    const stories = (parsed.stories || [])
      .filter((s: GeminiStory) => {
        if (!s.ticker || !isValidKeyword(cleanTicker(s.ticker))) return false;
        if (s.coinAgeDays !== undefined && s.coinAgeDays > MAX_AGE_DAYS)
          return false;
        if (s.coinMcap !== undefined && s.coinMcap >= MAX_MCAP) return false;
        if ((s.coinabilityScore || 0) < 55) return false;
        return true;
      })
      .map((s: GeminiStory) => ({
        ...s,
        ticker: cleanTicker(s.ticker),
        tickerVariants: [
          ...(s.tickerVariants || []).map(cleanTicker).filter(isValidKeyword),
          ...generateTickerVariants(s.ticker, s.emotionWords || [], s.headline),
        ].filter((v, i, arr) => arr.indexOf(v) === i),
      }));
    return { stories, success: true };
  } catch (e) {
    return { stories: [], success: false, error: String(e) };
  }
}

async function scanGeminiCelebStories(
  rawTexts: string[],
): Promise<{ stories: GeminiStory[]; success: boolean }> {
  if (!aiAvailable() || rawTexts.length === 0)
    return { stories: [], success: false };
  const relevantTexts = rawTexts
    .filter((t) =>
      CELEBS.some((c) =>
        t.toLowerCase().includes(c.toLowerCase().split(" ")[0].toLowerCase()),
      ),
    )
    .slice(0, 30)
    .map((t) => sanitizeForPrompt(t, 200));
  if (relevantTexts.length === 0) return { stories: [], success: false };
  const today = new Date().toUTCString();
  const prompt = `You are a crypto meme coin 2x analyst. Today is ${today}.
SOCIAL DATA MENTIONING CELEBRITIES:
${relevantTexts.join("\n")}
CELEBS TO WATCH: ${CELEBS.join(", ")}
Find celebrity posts with highest 2x probability for a meme coin in next 2-6h.
Return ONLY valid JSON:
{"stories":[{"ticker":"WORD","tickerVariants":["word"],"headline":"[celeb]: [what they said/did]","archetypeType":"celebrity_moment","coinabilityScore":88,"emotionWords":["word"],"platforms":["twitter"],"impressions":500000,"coinAlreadyExists":false,"coinMcap":null,"coinAgeDays":null,"narrativeContext":"[2x catalyst]","celebMention":"[Celeb Full Name]"}]}
Rules: MAX 8. Only with evidence in data above.`;
  const text = await geminiRequest(prompt, 2000);
  if (!text) return { stories: [], success: false };
  try {
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    let parsed: { stories: GeminiStory[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) return { stories: [], success: false };
      parsed = JSON.parse(m[0]);
    }
    const stories = (parsed.stories || [])
      .filter(
        (s: GeminiStory) => !s.ticker || isValidKeyword(cleanTicker(s.ticker)),
      )
      .map((s: GeminiStory) => ({
        ...s,
        ticker: cleanTicker(s.ticker),
        tickerVariants: [
          ...(s.tickerVariants || []).map(cleanTicker).filter(isValidKeyword),
          ...generateTickerVariants(s.ticker, s.emotionWords || [], s.headline),
        ].filter((v, i, arr) => arr.indexOf(v) === i),
      }));
    return { stories, success: true };
  } catch {
    return { stories: [], success: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REMAINING SCANNERS
// ─────────────────────────────────────────────────────────────────────────────
async function scanHackerNews(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const results: { keyword: string; score: number; context: string }[] = [];
  const logs: string[] = [];
  const wordMap = new Map<string, { score: number; context: string }>();
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );
  try {
    const r = await safeFetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      {},
      6000,
    );
    if (!r) {
      logs.push("[HN] fetch failed");
      return { results, logs };
    }
    const ids: number[] = await r.json();
    await Promise.all(
      ids.slice(0, 30).map(async (id) => {
        try {
          const sr = await safeFetch(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            {},
            4000,
          );
          if (!sr) return;
          const story = await sr.json();
          if (!story?.title || story.score < 50) return;
          const title = (story.title || "").toLowerCase();
          const heat = story.score + (story.descendants || 0) * 1.5;
          const properNouns =
            (story.title || "").match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean)) {
              const ex = wordMap.get(clean);
              wordMap.set(clean, {
                score: (ex?.score || 0) + heat * 300,
                context: ex?.context || title.slice(0, 80),
              });
              registerViralWord(
                clean,
                `HackerNews: "${title.slice(0, 60)}"`,
                "hackernews",
              );
            }
          }
        } catch {
          /* skip */
        }
      }),
    );
    for (const [keyword, { score, context }] of wordMap.entries())
      results.push({ keyword, score, context });
    logs.push(`[HN] ${results.length} signals from top stories`);
  } catch (e) {
    logs.push(`[HN] error: ${String(e).slice(0, 60)}`);
  }
  return { results, logs };
}

async function scanBirdeye(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const results: {
    keyword: string;
    score: number;
    mcap?: number;
    volume?: number;
    contractAddress?: string;
  }[] = [];
  const logs: string[] = [];
  if (!BIRDEYE_API_KEY) {
    logs.push("[Birdeye] No API key — skipping");
    return { results, logs };
  }
  try {
    const r = await safeFetch(
      `https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=50&min_liquidity=${MIN_LIQUIDITY}&chain=solana`,
      { "X-API-KEY": BIRDEYE_API_KEY, "x-chain": "solana" },
      8000,
    );
    if (!r) {
      logs.push("[Birdeye] fetch failed");
      return { results, logs };
    }
    const data = await r.json();
    const tokens = data?.data?.tokens || [];
    for (const token of tokens) {
      const sym = cleanTicker(token.symbol || "");
      const mcap = token.mc || token.realMc || 0;
      const vol = token.v24hUSD || 0;
      const address = token.address || "";
      if (!isValidKeyword(sym) || mcap >= MAX_MCAP) continue;
      const mcapMult = mcapMultiplier(mcap);
      if (mcapMult === 0) continue;
      const volSpike = volumeSpikeMultiplier(vol, mcap);
      results.push({
        keyword: sym,
        score: (vol * 0.5 + Math.min(mcap, 100000) * 0.1) * mcapMult * volSpike,
        mcap,
        volume: vol,
        contractAddress: address,
      });
    }
    logs.push(`[Birdeye] ${tokens.length} tokens — ${results.length} valid`);
  } catch (e) {
    logs.push(`[Birdeye] error: ${String(e).slice(0, 60)}`);
  }
  void viralWordSet;
  void viralWordContext;
  void sourceConfirmationMap;
  return { results, logs };
}

async function scanKnowYourMeme(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const results: { keyword: string; score: number; context: string }[] = [];
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );
  try {
    const r = await safeFetch(
      "https://knowyourmeme.com/memes/trending.json",
      { Accept: "application/json", Referer: "https://knowyourmeme.com/" },
      8000,
    );
    if (r) {
      const data = await r.json();
      const memes = data?.memes || data?.data || data || [];
      if (Array.isArray(memes) && memes.length > 0) {
        for (const meme of memes.slice(0, 20)) {
          const name = (meme.name || meme.title || "").trim();
          if (!name) continue;
          const compound = cleanTicker(name.replace(/\s+/g, ""));
          if (
            compound.length >= 3 &&
            compound.length <= 16 &&
            isValidKeyword(compound)
          ) {
            results.push({
              keyword: compound,
              score: 45000,
              context: `KYM trending: ${name}`,
            });
            registerViralWord(compound, `KYM trending meme: "${name}"`, "kym");
          }
          for (const w of name.split(/[\s\-_,.()/!?'"]+/)) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4) {
              results.push({
                keyword: clean,
                score: 25000,
                context: `KYM trending: ${name}`,
              });
              registerViralWord(clean, `KYM trending: "${name}"`, "kym");
            }
          }
        }
        return { results, count: results.length };
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const r = await safeFetch(
      "https://knowyourmeme.com/memes",
      { Accept: "text/html,*/*" },
      8000,
    );
    if (!r) return { results, count: 0 };
    const html = await r.text();
    const matches = [...html.matchAll(/data-entry-name="([^"]{3,40})"/g)];
    for (const match of matches.slice(0, 20)) {
      const name = (match[1] || "").replace(/<[^>]+>/g, "").trim();
      if (!name || name.length > 50) continue;
      const compound = cleanTicker(name.replace(/\s+/g, ""));
      if (
        compound.length >= 3 &&
        compound.length <= 16 &&
        isValidKeyword(compound)
      ) {
        results.push({
          keyword: compound,
          score: 40000,
          context: `KYM: ${name}`,
        });
        registerViralWord(compound, `KYM trending: "${name}"`, "kym");
      }
    }
  } catch {
    /* silent */
  }
  return { results, count: results.length };
}

async function scanDexScreener() {
  const results: {
    keyword: string;
    score: number;
    hasTicker: boolean;
    mcap?: number;
    liquidity?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    volume24h?: number;
    ageMinutes?: number;
    contractAddress?: string;
  }[] = [];
  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 50)) {
        if (token.chainId !== "solana") continue;
        const preMcap = token.fdv || token.marketCap || token.mc || 0;
        if (preMcap >= MAX_MCAP && preMcap > 0) continue;
        const sym = cleanTicker(token.symbol || token.baseToken?.symbol || "");
        if (sym && isValidKeyword(sym))
          results.push({
            keyword: sym,
            score: 20000,
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
      }
    }
  } catch {
    /* continue */
  }
  try {
    const r = await safeFetch(
      "https://api.dexscreener.com/token-boosts/top/v1",
    );
    if (r) {
      const data = await r.json();
      for (const token of (data || []).slice(0, 30)) {
        if (token.chainId !== "solana") continue;
        const preMcap = token.fdv || token.marketCap || token.mc || 0;
        if (preMcap >= MAX_MCAP && preMcap > 0) continue;
        const sym = cleanTicker(token.symbol || token.baseToken?.symbol || "");
        if (sym && isValidKeyword(sym))
          results.push({
            keyword: sym,
            score: 15000 + (token.totalAmount || 0),
            hasTicker: true,
            contractAddress: token.tokenAddress,
          });
      }
    }
  } catch {
    /* continue */
  }
  const enriched: typeof results = [];
  const seen = new Set<string>();
  const toEnrich = results
    .filter(
      (r) =>
        r.contractAddress &&
        !seen.has(r.contractAddress) &&
        (() => {
          seen.add(r.contractAddress!);
          return true;
        })(),
    )
    .slice(0, 30);
  await Promise.all(
    toEnrich.map(async (item) => {
      try {
        const r = await safeFetch(
          `https://api.dexscreener.com/latest/dex/tokens/${item.contractAddress}`,
          {},
          6000,
        );
        if (!r) return;
        const data = await r.json();
        const pairs = (data?.pairs || [])
          .filter((p: { chainId: string }) => p.chainId === "solana")
          .sort(
            (
              a: { liquidity?: { usd?: number } },
              b: { liquidity?: { usd?: number } },
            ) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
          );
        if (!pairs.length) return;
        const pair = pairs[0];
        const mcap = pair.fdv || 0;
        const liq = pair.liquidity?.usd || 0;
        const change1h = pair.priceChange?.h1 || 0;
        const change24h = pair.priceChange?.h24 || 0;
        const vol24h = pair.volume?.h24 || 0;
        const ageMinutes = pair.pairCreatedAt
          ? Math.floor((Date.now() - pair.pairCreatedAt) / 60000)
          : undefined;
        if (mcap >= MAX_MCAP) return;
        if (ageMinutes !== undefined && ageMinutes > MAX_AGE_MINUTES) return;
        if (liq > 0 && liq < MIN_LIQUIDITY) return;
        if (change1h > MAX_1H_CHANGE) return;
        if (change24h > MAX_24H_CHANGE || change24h < MIN_24H_CHANGE) return;
        if (mcap > 0 && liq > 0 && liq / mcap > MAX_LIQ_MCAP_RATIO) return;
        const ageMult = ageMultiplier(ageMinutes);
        const mcapMult = mcapMultiplier(mcap || undefined);
        if (ageMult === 0 || mcapMult === 0) return;
        const volSpike = volumeSpikeMultiplier(vol24h, mcap);
        const baseScore =
          (vol24h * 0.4 + liq * 0.3 + Math.max(change24h, 0) * 120) *
          ageMult *
          mcapMult *
          volSpike;
        enriched.push({
          ...item,
          mcap,
          liquidity: liq,
          priceChange1h: change1h,
          priceChange24h: change24h,
          volume24h: vol24h,
          ageMinutes,
          score: ageMinutes ? baseScore : Math.min(baseScore, 15000),
        });
      } catch {
        return;
      }
    }),
  );
  return enriched;
}

async function scanGoogleTrends(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const wordMap = new Map<string, number>();
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );
  await Promise.all(
    GOOGLE_TRENDS_GEOS.map(async (geo) => {
      try {
        const r = await safeFetch(
          `https://trends.google.com/trending/rss?geo=${geo}`,
          { Accept: "application/rss+xml, text/xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items) {
          const titleMatch = item.match(
            /<title><!\[CDATA\[(.*?)\]\]><\/title>/,
          );
          const trafficMatch = item.match(
            /<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/,
          );
          if (!titleMatch) continue;
          const title = titleMatch[1].trim();
          const rawTraffic = (trafficMatch?.[1] || "")
            .trim()
            .replace(/\+/g, "")
            .replace(/,/g, "");
          let traffic: number;
          if (rawTraffic.toUpperCase().includes("M"))
            traffic = Math.round(parseFloat(rawTraffic) * 1_000_000) || 5000;
          else if (rawTraffic.toUpperCase().includes("K"))
            traffic = Math.round(parseFloat(rawTraffic) * 1_000) || 5000;
          else traffic = parseInt(rawTraffic.replace(/[^0-9]/g, "")) || 5000;
          const properNouns = title.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean) && clean.length >= 3) {
              wordMap.set(clean, (wordMap.get(clean) || 0) + traffic);
              registerViralWord(
                clean,
                `Google Trends: "${title}" (${geo})`,
                "google-trends",
              );
            }
          }
          for (const animal of ANIMAL_VIRAL_SIGNALS) {
            if (title.toLowerCase().includes(animal)) {
              wordMap.set(animal, (wordMap.get(animal) || 0) + traffic * 3);
              registerViralWord(
                animal,
                `Google Trends animal: "${title}" (${geo})`,
                "google-trends-animal",
              );
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );
  return {
    results: Array.from(wordMap.entries()).map(([keyword, traffic]) => ({
      keyword,
      score: Math.min(traffic * 0.1, 80000),
    })),
    count: wordMap.size,
  };
}

async function scanGoogleNews(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const wordMap = new Map<string, { score: number; context: string }>();
  const rawTitles: string[] = [];
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );
  const queries = [
    "viral animal video today",
    "funny viral moment news today",
    "viral meme internet today",
    "solana meme coin launched today",
    "pump.fun viral new coin",
    "viral video reddit today",
    "Elon Musk tweet today",
    "Donald Trump post today",
    "celebrity viral post today",
    "TikTok viral trend today",
    "reddit front page today",
    "went viral today",
    "viral pet moment today",
    "funny animal goes viral",
    "celebrity says weird thing",
    "new meme format viral",
    "tiktok trend today",
  ];
  await Promise.all(
    queries.map(async (query) => {
      try {
        const r = await safeFetch(
          `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
          { Accept: "application/rss+xml, text/xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items.slice(0, 15)) {
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
          const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
          const title = (titleMatch?.[1] || "")
            .replace(/<!\[CDATA\[|\]\]>/g, "")
            .replace(/<[^>]+>/g, "");
          const titleLower = title.toLowerCase();
          if (
            pubDateMatch?.[1] &&
            Date.now() - new Date(pubDateMatch[1]).getTime() >
              MAX_AGE_MINUTES * 60000
          )
            continue;
          let recencyMult = 1.0;
          if (pubDateMatch?.[1]) {
            const pubAge = Date.now() - new Date(pubDateMatch[1]).getTime();
            recencyMult =
              pubAge < 6 * 3600000 ? 3.0 : pubAge < 24 * 3600000 ? 2.0 : 1.0;
          }
          rawTitles.push(title.slice(0, 150));
          const isCelebQuery =
            query.includes("Elon") ||
            query.includes("Trump") ||
            query.includes("celebrity");
          const isAnimalQuery =
            query.includes("animal") ||
            query.includes("pet") ||
            query.includes("viral");
          const scoreMultiplier = isCelebQuery
            ? 2.5 * recencyMult
            : isAnimalQuery
              ? 2.0 * recencyMult
              : recencyMult;
          const properNouns = title.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean)) {
              const ex = wordMap.get(clean);
              wordMap.set(clean, {
                score: (ex?.score || 0) + 4000 * scoreMultiplier,
                context: ex?.context || titleLower.slice(0, 80),
              });
              registerViralWord(clean, titleLower.slice(0, 80), "google-news");
            }
          }
          for (const animal of ANIMAL_VIRAL_SIGNALS) {
            if (titleLower.includes(animal)) {
              const ex = wordMap.get(animal);
              wordMap.set(animal, {
                score: (ex?.score || 0) + 8000 * recencyMult,
                context: ex?.context || titleLower.slice(0, 80),
              });
              registerViralWord(
                animal,
                titleLower.slice(0, 80),
                "google-news-animal",
              );
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );
  return {
    results: Array.from(wordMap.entries()).map(
      ([keyword, { score, context }]) => ({ keyword, score, context }),
    ),
    rawTitles,
    count: wordMap.size,
  };
}

async function scanYouTubeTrending(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const wordMap = new Map<string, number>();
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );
  const feeds = [
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=US",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=GB",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=PH",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=BR",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=IN",
    "https://www.youtube.com/feeds/videos.xml?chart=mostpopular&regionCode=KR",
  ];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const r = await safeFetch(
          feed,
          { Accept: "application/atom+xml" },
          8000,
        );
        if (!r) return;
        const xml = await r.text();
        const titleMatches = xml.match(/<title>([\s\S]*?)<\/title>/g) || [];
        for (const titleTag of titleMatches.slice(1, 30)) {
          const rawTitle = titleTag
            .replace(/<\/?title>/g, "")
            .replace(/<!\[CDATA\[|\]\]>/g, "");
          const rawLower = rawTitle.toLowerCase();
          const properNouns = rawTitle.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
          for (const noun of properNouns) {
            const clean = cleanTicker(noun);
            if (isValidKeyword(clean)) {
              wordMap.set(clean, (wordMap.get(clean) || 0) + 10000);
              registerViralWord(
                clean,
                `YouTube trending: "${rawTitle.slice(0, 60)}"`,
                "youtube",
              );
            }
          }
          for (const animal of ANIMAL_VIRAL_SIGNALS) {
            if (rawLower.includes(animal)) {
              wordMap.set(animal, (wordMap.get(animal) || 0) + 25000);
              registerViralWord(
                animal,
                `YouTube viral animal: "${rawTitle.slice(0, 60)}"`,
                "youtube-animal",
              );
            }
          }
        }
      } catch {
        /* skip */
      }
    }),
  );
  return {
    results: Array.from(wordMap.entries()).map(([k, v]) => ({
      keyword: k,
      score: v,
    })),
    count: wordMap.size,
  };
}

async function scanReddit(sub: string, tier: number) {
  const posts: {
    title: string;
    score: number;
    flair: string;
    comments: number;
    createdUtc?: number;
  }[] = [];
  const redditHeaders = {
    "User-Agent": REDDIT_USER_AGENT,
    Accept: "application/json",
  };
  for (const endpoint of [
    `https://www.reddit.com/r/${sub}/hot.json?limit=100&raw_json=1`,
    `https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`,
  ]) {
    try {
      // ← FIXED: now goes through safeFetch with host allowlist
      const r = await safeFetch(endpoint, redditHeaders, 8000);
      if (!r || !r.ok) continue;
      const data = await r.json();
      for (const p of data?.data?.children || []) {
        const createdUtc = p.data.created_utc;
        if (
          createdUtc &&
          (Date.now() / 1000 - createdUtc) / 60 > MAX_AGE_MINUTES
        )
          continue;
        posts.push({
          title: p.data.title || "",
          score: Math.max(p.data.score || 0, 1),
          flair: p.data.link_flair_text || "",
          comments: p.data.num_comments || 0,
          createdUtc,
        });
      }
    } catch {
      /* continue */
    }
  }
  return { sub, tier, posts };
}

async function scanRedditSearch(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  const results: { keyword: string; score: number; context: string }[] = [];
  const rawTitles: string[] = [];
  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );
  const redditHeaders = {
    "User-Agent": REDDIT_USER_AGENT,
    Accept: "application/json",
  };
  const searchQueries = [
    "solana meme coin pump.fun",
    "viral animal coin crypto",
    "new meme coin launch solana",
    "crypto pump solana new today",
    "funny viral going viral today",
  ];
  for (const q of searchQueries) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=50&t=day&raw_json=1`;
      // ← FIXED: now goes through safeFetch with host allowlist
      const r = await safeFetch(url, redditHeaders, 8000);
      if (!r || !r.ok) continue;
      const data = await r.json();
      for (const p of data?.data?.children || []) {
        const title = (p.data.title || "").toLowerCase();
        const score = Math.max(p.data.score || 1, 1);
        const comments = p.data.num_comments || 0;
        const createdUtc = p.data.created_utc;
        const ageH = createdUtc ? (Date.now() / 1000 - createdUtc) / 3600 : 48;
        if (ageH > MAX_AGE_DAYS * 24) continue;
        const recencyMult =
          ageH < 2 ? 4.0 : ageH < 6 ? 2.5 : ageH < 24 ? 1.5 : 1.0;
        const heat = (score + comments * 2) * recencyMult;
        rawTitles.push(title.slice(0, 150));
        for (const m of title.matchAll(/\$([a-z][a-z0-9]{1,11})\b/g)) {
          const ticker = cleanTicker(m[1]);
          if (isValidKeyword(ticker))
            results.push({
              keyword: ticker,
              score: heat * 10,
              context: title.slice(0, 80),
            });
        }
        if (heat > 100) {
          const words = title.split(/[\s\-_,.()/!?'"]+/);
          for (const w of words) {
            const clean = cleanTicker(w);
            if (isValidKeyword(clean) && clean.length >= 4) {
              results.push({
                keyword: clean,
                score: heat * 2,
                context: title.slice(0, 80),
              });
              registerViralWord(clean, title.slice(0, 80), "reddit");
            }
          }
        }
      }
    } catch {
      /* skip */
    }
  }
  return { results, rawTitles, count: results.length };
}

async function scanCoinGecko() {
  const results: { keyword: string; score: number; isNew: boolean }[] = [];
  try {
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/search/trending",
    );
    if (r) {
      const data = await r.json();
      for (const { item } of data?.coins || []) {
        const sym = cleanTicker(item.symbol || "");
        if (isValidKeyword(sym))
          results.push({
            keyword: sym,
            score: Math.max(40000 - (item.score ?? 10) * 3500, 3000),
            isNew: false,
          });
      }
    }
  } catch {
    /* continue */
  }
  try {
    const r = await safeFetch(
      "https://api.coingecko.com/api/v3/coins/list/new",
    );
    if (r) {
      const data: { symbol: string; activated_at: number }[] = await r.json();
      const now = Date.now() / 1000;
      for (const coin of (data || []).slice(0, 50)) {
        const sym = cleanTicker(coin.symbol || "");
        const ageHours = (now - (coin.activated_at || now)) / 3600;
        if (ageHours > MAX_AGE_DAYS * 24) continue;
        const ageMult = ageMultiplier(ageHours * 60);
        if (isValidKeyword(sym) && ageMult > 0)
          results.push({
            keyword: sym,
            score: 15000 * (ageHours < 24 ? 2.0 : 1.3) * ageMult,
            isNew: ageHours < 72,
          });
      }
    }
  } catch {
    /* continue */
  }
  return results;
}

async function scanCMCNew() {
  const results: { keyword: string; score: number }[] = [];
  try {
    // ← FIXED: now goes through safeFetch with host allowlist
    // Also add coinmarketcap.com to ALLOWED_FETCH_HOSTS
    const r = await safeFetch(
      "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing/new?start=1&limit=50&convertId=2781",
      {
        "User-Agent": UA,
        Referer: "https://coinmarketcap.com/",
        Origin: "https://coinmarketcap.com",
        Accept: "application/json",
      },
      8000,
    );
    if (!r || !r.ok) return results;
    const data = await r.json();
    for (const coin of data?.data?.recentlyAdded || []) {
      const sym = cleanTicker(coin.symbol || "");
      const vol = coin.volume24h || coin.statistics?.volume24h || 0;
      if (isValidKeyword(sym) && vol > 0)
        results.push({
          keyword: sym,
          score: Math.min(vol * 0.001, 25000),
        });
    }
  } catch {
    /* continue */
  }
  return results;
}

async function checkRug(ca: string): Promise<{
  risk: "low" | "medium" | "high" | "unknown";
  details: string;
  topHolderPct?: number;
}> {
  try {
    const r = await safeFetch(
      `https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`,
      {},
      5000,
    );
    if (!r) return { risk: "unknown", details: "unavailable" };
    const data = await r.json();
    const score = data?.score ?? -1;
    const risks = (data?.risks || []) as { name: string; level: string }[];
    const highRisks = risks
      .filter((r) => r.level === "danger")
      .map((r) => r.name);
    const medRisks = risks.filter((r) => r.level === "warn").map((r) => r.name);
    const topHolderPct =
      data?.topHolders?.[0]?.pct || data?.insider_networks?.[0]?.pct || 0;
    if (topHolderPct > 0.5)
      return {
        risk: "high",
        details: `Top holder owns ${(topHolderPct * 100).toFixed(0)}%`,
        topHolderPct,
      };
    if (highRisks.length > 0)
      return {
        risk: "high",
        details: highRisks.slice(0, 2).join(", "),
        topHolderPct,
      };
    if (score > 5000 || medRisks.length >= 3)
      return {
        risk: "medium",
        details: medRisks.slice(0, 2).join(", ") || "moderate risk",
        topHolderPct,
      };
    if (score === -1)
      return { risk: "unknown", details: "no score data", topHolderPct };
    if (score >= 0)
      return { risk: "low", details: "passed rugcheck", topHolderPct };
    return { risk: "unknown", details: "no data", topHolderPct };
  } catch {
    return { risk: "unknown", details: "failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY HELPER
// ─────────────────────────────────────────────────────────────────────────────
function makeRegisterViralWord(
  viralWordSet: Set<string>,
  viralWordContext: Map<string, string>,
  sourceConfirmationMap: Map<string, Set<string>>,
) {
  return function registerViralWord(
    word: string,
    context: string,
    sourceType?: string,
  ) {
    const clean = cleanTicker(word);
    if (!isValidKeyword(clean)) return;
    viralWordSet.add(clean);
    if (!viralWordContext.has(clean)) viralWordContext.set(clean, context);
    if (sourceType) {
      if (!sourceConfirmationMap.has(clean))
        sourceConfirmationMap.set(clean, new Set());
      sourceConfirmationMap.get(clean)!.add(sourceType);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE ENTRY TYPE
// ─────────────────────────────────────────────────────────────────────────────
interface ScoreEntry {
  viralScore: number;
  socialScore: number;
  onchainScore: number;
  geckoScore: number;
  celebScore: number;
  narrativeScore: number;
  storyScore: number;
  twitterScore: number;
  telegramScore: number;
  posts: number;
  hasTicker: boolean;
  isNewCoin: boolean;
  ageMinutes?: number;
  sources: string[];
  platforms: string[];
  mcap?: number;
  volume?: number;
  liquidity?: number;
  priceChange1h?: number;
  priceChange24h?: number;
  contractAddress?: string;
  rugRisk?: "low" | "medium" | "high" | "unknown";
  rugDetails?: string;
  topHolderPct?: number;
  smartMoneyScore?: number;
  smartWallets?: SmartWallet[];
  aiContext?: string;
  viralContext?: string;
  celebMention?: string;
  narrativeStory?: string;
  archetypeType?: string;
  coinabilityScore?: number;
  isPredictive?: boolean;
  impressions?: number;
  hasFanCommunity?: boolean;
  fanCommunitySize?: number;
  animalBoost?: number;
  confirmationSources?: number;
  replyCount?: number;
  nearGraduation?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function GET() {
  // ── AUTH ────────────────────────────────────────────────────────────────────
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── RATE LIMIT ───────────────────────────────────────────────────────────────
  const { success: rateLimitOk } = await checkLimit(
    scanLimiter,
    session.user.id,
    process.env.NODE_ENV !== "production",
  );
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: "Too many scans. Wait a few minutes." },
      { status: 429 },
    );
  }

  // All state local to this request — no cross-request race condition
  const storyRegistry = new Map<string, ViralStory>();
  const viralWordSet = new Set<string>();
  const viralWordContext = new Map<string, string>();
  const sourceConfirmationMap = new Map<string, Set<string>>();

  const registerViralWord = makeRegisterViralWord(
    viralWordSet,
    viralWordContext,
    sourceConfirmationMap,
  );

  function registerStory(story: ViralStory) {
    storyRegistry.set(story.id, story);
    for (const t of story.predictedTickers) {
      const clean = cleanTicker(t);
      viralWordSet.add(clean);
      viralWordContext.set(clean, story.headline);
    }
  }

  function getConfirmationBonus(ticker: string): number {
    const clean = cleanTicker(ticker);
    const sources = sourceConfirmationMap.get(clean);
    if (!sources) return 1.0;
    const count = sources.size;
    if (count >= 5) return 8.0;
    if (count >= CONFIRMATION_MATRIX_THRESHOLD) return 5.0;
    if (count >= 2) return 2.5;
    return 1.0;
  }

  function getNarrativeBonus(ticker: string): {
    bonus: number;
    story: string | undefined;
    storyObj?: ViralStory;
  } {
    const clean = cleanTicker(ticker);
    if (viralWordSet.has(clean))
      return {
        bonus: 1.0,
        story: viralWordContext.get(clean),
        storyObj: Array.from(storyRegistry.values()).find((s) =>
          s.predictedTickers.includes(clean),
        ),
      };
    for (const word of viralWordSet) {
      if (word.length >= 4 && (clean.includes(word) || word.includes(clean))) {
        return {
          bonus: 0.6,
          story: viralWordContext.get(word),
          storyObj: Array.from(storyRegistry.values()).find((s) =>
            s.predictedTickers.includes(word),
          ),
        };
      }
    }
    return { bonus: 0, story: undefined };
  }

  const scoreMap = new Map<string, ScoreEntry>();
  const logs: string[] = [];
  logs.push(
    `[Init] v24-HARDENED | MAX_MCAP=$${MAX_MCAP.toLocaleString()} | MIN_LIQ=$${MIN_LIQUIDITY} | AGE_WINDOW=${GOLDEN_WINDOW_MIN}-${GOLDEN_WINDOW_MAX}m`,
  );

  const upsert = (
    word: string,
    amount: number,
    platform: string,
    sourceLabel: string,
    field: keyof Pick<
      ScoreEntry,
      | "viralScore"
      | "socialScore"
      | "onchainScore"
      | "geckoScore"
      | "celebScore"
      | "narrativeScore"
      | "storyScore"
      | "twitterScore"
      | "telegramScore"
    >,
    opts: Partial<
      Pick<
        ScoreEntry,
        | "hasTicker"
        | "isNewCoin"
        | "ageMinutes"
        | "mcap"
        | "volume"
        | "liquidity"
        | "priceChange1h"
        | "priceChange24h"
        | "contractAddress"
        | "aiContext"
        | "viralContext"
        | "celebMention"
        | "narrativeStory"
        | "archetypeType"
        | "coinabilityScore"
        | "isPredictive"
        | "impressions"
        | "hasFanCommunity"
        | "fanCommunitySize"
        | "animalBoost"
        | "replyCount"
        | "nearGraduation"
      >
    > = {},
  ) => {
    const key = word.toLowerCase().trim();
    if (!isValidKeyword(key) || amount <= 0) return;
    if (opts.mcap !== undefined && opts.mcap >= MAX_MCAP) return;
    if (opts.ageMinutes !== undefined && opts.ageMinutes > MAX_AGE_MINUTES)
      return;
    if (
      opts.priceChange24h !== undefined &&
      opts.priceChange24h < MIN_24H_CHANGE
    )
      return;
    if (opts.priceChange1h !== undefined && opts.priceChange1h > MAX_1H_CHANGE)
      return;

    const existing = scoreMap.get(key);
    if (existing) {
      (existing[field] as number) += amount;
      existing.posts += 1;
      if (!existing.sources.includes(sourceLabel))
        existing.sources.push(sourceLabel);
      if (!existing.platforms.includes(platform))
        existing.platforms.push(platform);
      if (opts.hasTicker) existing.hasTicker = true;
      if (opts.isNewCoin) existing.isNewCoin = true;
      if (
        opts.ageMinutes !== undefined &&
        (existing.ageMinutes === undefined ||
          opts.ageMinutes < existing.ageMinutes)
      )
        existing.ageMinutes = opts.ageMinutes;
      if (
        opts.mcap !== undefined &&
        opts.mcap > 0 &&
        (!existing.mcap || opts.mcap < existing.mcap)
      )
        existing.mcap = opts.mcap;
      if (opts.volume) existing.volume = opts.volume;
      if (opts.liquidity && !existing.liquidity)
        existing.liquidity = opts.liquidity;
      if (
        opts.priceChange1h !== undefined &&
        existing.priceChange1h === undefined
      )
        existing.priceChange1h = opts.priceChange1h;
      if (
        opts.priceChange24h !== undefined &&
        existing.priceChange24h === undefined
      )
        existing.priceChange24h = opts.priceChange24h;
      if (opts.contractAddress && !existing.contractAddress)
        existing.contractAddress = opts.contractAddress;
      if (opts.aiContext && !existing.aiContext)
        existing.aiContext = opts.aiContext;
      if (opts.viralContext && !existing.viralContext)
        existing.viralContext = opts.viralContext;
      if (opts.celebMention && !existing.celebMention)
        existing.celebMention = opts.celebMention;
      if (opts.narrativeStory && !existing.narrativeStory)
        existing.narrativeStory = opts.narrativeStory;
      if (opts.archetypeType && !existing.archetypeType)
        existing.archetypeType = opts.archetypeType;
      if (
        opts.coinabilityScore !== undefined &&
        (!existing.coinabilityScore ||
          opts.coinabilityScore > existing.coinabilityScore)
      )
        existing.coinabilityScore = opts.coinabilityScore;
      if (opts.isPredictive) existing.isPredictive = true;
      if (
        opts.impressions !== undefined &&
        (!existing.impressions || opts.impressions > existing.impressions)
      )
        existing.impressions = opts.impressions;
      if (opts.hasFanCommunity) existing.hasFanCommunity = true;
      if (
        opts.fanCommunitySize !== undefined &&
        (!existing.fanCommunitySize ||
          opts.fanCommunitySize > existing.fanCommunitySize)
      )
        existing.fanCommunitySize = opts.fanCommunitySize;
      if (
        opts.animalBoost &&
        (!existing.animalBoost || opts.animalBoost > existing.animalBoost)
      )
        existing.animalBoost = opts.animalBoost;
      if (
        opts.replyCount &&
        (!existing.replyCount || opts.replyCount > existing.replyCount)
      )
        existing.replyCount = opts.replyCount;
      if (opts.nearGraduation) existing.nearGraduation = true;
    } else {
      const entry: ScoreEntry = {
        viralScore: 0,
        socialScore: 0,
        onchainScore: 0,
        geckoScore: 0,
        celebScore: 0,
        narrativeScore: 0,
        storyScore: 0,
        twitterScore: 0,
        telegramScore: 0,
        posts: 1,
        hasTicker: opts.hasTicker || false,
        isNewCoin: opts.isNewCoin || false,
        ageMinutes: opts.ageMinutes,
        sources: [sourceLabel],
        platforms: [platform],
        mcap: opts.mcap,
        volume: opts.volume,
        liquidity: opts.liquidity,
        priceChange1h: opts.priceChange1h,
        priceChange24h: opts.priceChange24h,
        contractAddress: opts.contractAddress,
        aiContext: opts.aiContext,
        viralContext: opts.viralContext,
        celebMention: opts.celebMention,
        narrativeStory: opts.narrativeStory,
        archetypeType: opts.archetypeType,
        coinabilityScore: opts.coinabilityScore,
        isPredictive: opts.isPredictive,
        impressions: opts.impressions,
        hasFanCommunity: opts.hasFanCommunity,
        fanCommunitySize: opts.fanCommunitySize,
        animalBoost: opts.animalBoost,
        replyCount: opts.replyCount,
        nearGraduation: opts.nearGraduation,
      };
      (entry[field] as number) = amount;
      scoreMap.set(key, entry);
    }
  };

  // ── WAVE 1 ─────────────────────────────────────────────────────────────────
  const [twitterData, telegramData] = await Promise.all([
    scanTwitter(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanTelegram(viralWordSet, viralWordContext, sourceConfirmationMap),
  ]);
  for (const t of twitterData.results)
    upsert(t.keyword, t.score, "twitter", "Twitter/X", "twitterScore", {
      viralContext: t.context,
    });
  for (const log of twitterData.logs) logs.push(log);
  for (const t of telegramData.results)
    upsert(t.keyword, t.score, "telegram", "Telegram Alpha", "telegramScore", {
      viralContext: t.context,
    });
  for (const log of telegramData.logs) logs.push(log);

  // ── WAVE 2 ─────────────────────────────────────────────────────────────────
  // FIX 3.5: Reddit subs capped at 8 concurrent fetches via withConcurrencyLimit
  const redditSubResults = await withConcurrencyLimit(
    REDDIT_SUBS.map((s) => () => scanReddit(s.name, s.tier)),
    8,
  );

  const [
    googleTrendsData,
    googleNewsData,
    youtubeTrendingData,
    kymData,
    redditSearchData,
    pumpData,
    dexResults,
    geckoResults,
    cmcResults,
    birdeyeData,
    hnData,
  ] = await Promise.all([
    scanGoogleTrends(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanGoogleNews(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanYouTubeTrending(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanKnowYourMeme(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanRedditSearch(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanPumpFun(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanDexScreener(),
    scanCoinGecko(),
    scanCMCNew(),
    scanBirdeye(viralWordSet, viralWordContext, sourceConfirmationMap),
    scanHackerNews(viralWordSet, viralWordContext, sourceConfirmationMap),
  ]);

  const pumpResults = pumpData.results;
  for (const log of pumpData.logs) logs.push(log);

  // ── WAVE 3: GEMINI ─────────────────────────────────────────────────────────
  const allRawTexts = [
    ...twitterData.rawTexts,
    ...telegramData.rawTexts,
    ...(redditSearchData.rawTitles || []),
    ...(googleNewsData.rawTitles || []),
  ];
  const newPumpCoins = pumpResults
    .filter((p) => p.ageMinutes < 360)
    .slice(0, 20)
    .map((p) => ({
      name: p.name || p.keyword,
      description: p.description || "",
      symbol: p.keyword,
      mcap: p.mcap,
      ageMinutes: p.ageMinutes,
    }));
  const trendingWordsList = Array.from(viralWordSet).slice(0, 50);
  const [geminiStories, geminiCelebStories] = await Promise.all([
    analyzeWithGemini({
      twitterTexts: twitterData.rawTexts,
      telegramTexts: telegramData.rawTexts,
      redditTitles: redditSearchData.rawTitles || [],
      googleNewsTitles: googleNewsData.rawTitles || [],
      trendingWords: trendingWordsList,
      newPumpCoins,
    }),
    scanGeminiCelebStories(allRawTexts),
  ]);

  // ── Process social signals ─────────────────────────────────────────────────
  for (const g of googleTrendsData.results)
    upsert(g.keyword, g.score, "google-trends", "Google Trends", "viralScore");
  for (const g of googleNewsData.results)
    upsert(g.keyword, g.score, "google-news", "Google News", "viralScore", {
      viralContext: g.context,
    });
  for (const y of youtubeTrendingData.results)
    upsert(y.keyword, y.score, "youtube", "YouTube Trending", "viralScore");
  for (const k of kymData.results)
    upsert(k.keyword, k.score, "kym", "Know Your Meme", "viralScore", {
      viralContext: k.context,
    });
  for (const r of redditSearchData.results)
    upsert(r.keyword, r.score, "reddit", "Reddit Search", "socialScore", {
      viralContext: r.context,
    });
  for (const h of hnData.results)
    upsert(h.keyword, h.score, "hackernews", "HackerNews", "viralScore", {
      viralContext: h.context,
    });
  for (const log of hnData.logs) logs.push(log);

  // ── Gemini Stories ─────────────────────────────────────────────────────────
  if (geminiStories.success) {
    for (const story of geminiStories.stories) {
      const ageMult =
        story.coinAgeDays !== undefined
          ? ageMultiplier(story.coinAgeDays * 1440)
          : 0.6;
      if (ageMult === 0) continue;
      const mcapMult =
        story.coinMcap !== undefined ? mcapMultiplier(story.coinMcap) : 1.5;
      if (mcapMult === 0) continue;
      const isCeleb = !!story.celebMention;
      const isConfirmed = story.coinAlreadyExists;
      const isPredictive = !isConfirmed;
      const storyMult =
        (story.coinabilityScore / 100) * (isConfirmed ? 3.5 : 1.8);
      const impressionMult = story.impressions
        ? Math.min(Math.log10(story.impressions + 1) / 4, 2.0)
        : 1.0;
      const isAnimalStory =
        story.archetypeType === "viral_animal" ||
        ANIMAL_VIRAL_SIGNALS.some((a) =>
          story.headline.toLowerCase().includes(a),
        );
      const animalArchetypeBoost = isAnimalStory ? 3.0 : 1.0;
      const baseScore =
        story.coinabilityScore *
        6000 *
        ageMult *
        mcapMult *
        storyMult *
        impressionMult *
        animalArchetypeBoost;
      const field = isCeleb
        ? "celebScore"
        : isConfirmed
          ? "narrativeScore"
          : "storyScore";
      const allVariants =
        story.tickerVariants ||
        generateTickerVariants(
          story.ticker,
          story.emotionWords || [],
          story.headline,
        );
      for (const variant of allVariants) {
        const variantIsMain = variant === story.ticker;
        upsert(
          variant,
          variantIsMain ? baseScore : baseScore * 0.4,
          isCeleb ? "celebrity" : "story",
          isCeleb
            ? `Celebrity: ${story.celebMention}`
            : isConfirmed
              ? "Confirmed Story"
              : "Predictive Story",
          field,
          {
            hasTicker: isConfirmed && variantIsMain,
            isNewCoin:
              isConfirmed && (story.coinAgeDays || 0) < 1 && variantIsMain,
            aiContext: story.narrativeContext,
            narrativeStory: story.narrativeContext,
            celebMention: story.celebMention || undefined,
            archetypeType: story.archetypeType,
            coinabilityScore: story.coinabilityScore,
            isPredictive,
            impressions: story.impressions,
            mcap: variantIsMain ? story.coinMcap : undefined,
            ageMinutes:
              story.coinAgeDays !== undefined
                ? Math.round(story.coinAgeDays * 1440)
                : undefined,
            hasFanCommunity: !!story.hasFanCommunity,
            fanCommunitySize: story.fanCommunitySize,
            animalBoost: isAnimalStory ? 3.0 : undefined,
          },
        );
      }
      for (const ew of story.emotionWords || [])
        registerViralWord(ew, story.narrativeContext, "gemini");
      registerViralWord(story.ticker, story.narrativeContext, "gemini");
      registerStory({
        id: story.ticker,
        headline: story.headline,
        archetypeType: story.archetypeType,
        coinabilityScore: story.coinabilityScore,
        predictedTickers: allVariants,
        confirmedTicker: isConfirmed ? story.ticker : undefined,
        confirmedMcap: story.coinMcap,
        confirmedAge:
          story.coinAgeDays !== undefined
            ? Math.round(story.coinAgeDays * 1440)
            : undefined,
        source: story.platforms?.[0] || "unknown",
        impressions: story.impressions,
        emotionWords: story.emotionWords || [],
        hasFanCommunity: !!story.hasFanCommunity,
        fanCommunitySize: story.fanCommunitySize,
      });
    }
    logs.push(`[Gemini] ✓ ${geminiStories.stories.length} stories`);
  } else {
    logs.push(`[Gemini] ✗ ${geminiStories.error}`);
  }

  if (geminiCelebStories.success) {
    for (const story of geminiCelebStories.stories) {
      const ageMult =
        story.coinAgeDays !== undefined
          ? ageMultiplier(story.coinAgeDays * 1440)
          : 0.6;
      const mcapMult =
        story.coinMcap !== undefined ? mcapMultiplier(story.coinMcap) : 1.5;
      if (ageMult === 0 || mcapMult === 0) continue;
      const impressionMult = story.impressions
        ? Math.min(Math.log10(story.impressions + 1) / 4, 2.0)
        : 1.0;
      const allVariants =
        story.tickerVariants ||
        generateTickerVariants(
          story.ticker,
          story.emotionWords || [],
          story.headline,
        );
      for (const variant of allVariants)
        upsert(
          variant,
          story.coinabilityScore *
            7000 *
            ageMult *
            mcapMult *
            impressionMult *
            (variant === story.ticker ? 1.0 : 0.4),
          "celebrity",
          `Celebrity: ${story.celebMention || "Unknown"}`,
          "celebScore",
          {
            hasTicker: story.coinAlreadyExists && variant === story.ticker,
            aiContext: story.narrativeContext,
            narrativeStory: story.narrativeContext,
            celebMention: story.celebMention || undefined,
            archetypeType: "celebrity_moment",
            coinabilityScore: story.coinabilityScore,
            impressions: story.impressions,
            mcap: variant === story.ticker ? story.coinMcap : undefined,
          },
        );
    }
    logs.push(
      `[Gemini Celeb] ✓ ${geminiCelebStories.stories.length} celeb moments`,
    );
  }

  // ── Pump.fun ───────────────────────────────────────────────────────────────
  for (const p of pumpResults) {
    const { bonus, story, storyObj } = getNarrativeBonus(p.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 12 : 1;
    const twitterEntry = scoreMap.get(p.keyword);
    const twitterBonus = twitterEntry?.twitterScore
      ? 1 + Math.min(twitterEntry.twitterScore / 50000, 3.5)
      : 1;
    const telegramBonus = twitterEntry?.telegramScore
      ? 1 + Math.min(twitterEntry.telegramScore / 30000, 4.0)
      : 1;
    const velMult = velocityMultiplier(p.score, p.ageMinutes);
    const confirmBonus = getConfirmationBonus(p.keyword);
    const animalBoostMult = getAnimalBoost(
      p.keyword,
      (p.description || "") + " " + (p.name || ""),
    );
    upsert(
      p.keyword,
      p.score *
        narrativeBonus *
        twitterBonus *
        telegramBonus *
        velMult *
        confirmBonus *
        animalBoostMult,
      "pumpfun",
      "Pump.fun",
      "onchainScore",
      {
        hasTicker: true,
        isNewCoin: p.isNew,
        ageMinutes: p.ageMinutes,
        mcap: p.mcap,
        volume: p.volume,
        contractAddress: p.contractAddress,
        narrativeStory: story,
        aiContext: story || p.description,
        animalBoost: animalBoostMult > 1 ? animalBoostMult : undefined,
        replyCount: p.replyCount,
        nearGraduation: p.nearGraduation,
      },
    );
    if (bonus > 0 && storyObj && !storyObj.confirmedTicker) {
      storyRegistry.set(storyObj.id, {
        ...storyObj,
        confirmedTicker: p.keyword,
        confirmedMcap: p.mcap,
        confirmedAge: p.ageMinutes,
        confirmedCA: p.contractAddress,
      });
      upsert(
        p.keyword,
        p.score * 6,
        "pumpfun",
        "Narrative CONFIRMED",
        "narrativeScore",
        {
          narrativeStory: story,
          archetypeType: storyObj.archetypeType,
          coinabilityScore: storyObj.coinabilityScore,
        },
      );
    }
  }
  logs.push(`[Pump.fun] ${pumpResults.length} signals`);

  // ── DexScreener ────────────────────────────────────────────────────────────
  for (const d of dexResults) {
    const { bonus, story } = getNarrativeBonus(d.keyword);
    const narrativeBonus = bonus > 0 ? 1 + bonus * 12 : 1;
    const twitterEntry = scoreMap.get(d.keyword);
    const twitterBonus = twitterEntry?.twitterScore
      ? 1 + Math.min(twitterEntry.twitterScore / 50000, 3.5)
      : 1;
    const telegramBonus = twitterEntry?.telegramScore
      ? 1 + Math.min(twitterEntry.telegramScore / 30000, 4.0)
      : 1;
    const velMult = velocityMultiplier(d.score, d.ageMinutes);
    const confirmBonus = getConfirmationBonus(d.keyword);
    upsert(
      d.keyword,
      d.score *
        narrativeBonus *
        twitterBonus *
        telegramBonus *
        velMult *
        confirmBonus,
      "dexscreener",
      "DexScreener",
      "onchainScore",
      {
        hasTicker: d.hasTicker,
        isNewCoin: true,
        mcap: d.mcap,
        liquidity: d.liquidity,
        priceChange1h: d.priceChange1h,
        priceChange24h: d.priceChange24h,
        volume: d.volume24h,
        contractAddress: d.contractAddress,
        ageMinutes: d.ageMinutes,
        narrativeStory: story,
        aiContext: story,
      },
    );
    if (bonus > 0)
      upsert(
        d.keyword,
        d.score * bonus * 6,
        "dexscreener",
        "Narrative Match",
        "narrativeScore",
        { narrativeStory: story },
      );
  }
  logs.push(`[DexScreener] ${dexResults.length} pairs`);

  for (const b of birdeyeData.results) {
    const { bonus, story } = getNarrativeBonus(b.keyword);
    upsert(
      b.keyword,
      b.score * (bonus > 0 ? 1 + bonus * 8 : 1),
      "birdeye",
      "Birdeye",
      "onchainScore",
      {
        hasTicker: true,
        mcap: b.mcap,
        volume: b.volume,
        contractAddress: b.contractAddress,
        narrativeStory: story,
      },
    );
  }
  for (const log of birdeyeData.logs) logs.push(log);
  for (const g of geckoResults)
    upsert(g.keyword, g.score, "coingecko", "CoinGecko", "geckoScore", {
      hasTicker: true,
      isNewCoin: g.isNew,
    });
  for (const c of cmcResults)
    upsert(c.keyword, c.score, "cmc", "CMC New", "geckoScore", {
      hasTicker: true,
      isNewCoin: true,
    });

  // ── Reddit subs ────────────────────────────────────────────────────────────
  for (const { sub, tier, posts } of redditSubResults) {
    for (const {
      title,
      score: upvotes,
      flair,
      comments,
      createdUtc,
    } of posts) {
      const ageH = createdUtc ? (Date.now() / 1000 - createdUtc) / 3600 : 48;
      const recencyMult =
        ageH < 2 ? 4.0 : ageH < 6 ? 2.5 : ageH < 24 ? 1.5 : 1.0;
      const heat = upvotes + comments * 2;
      const full = `${title} ${flair}`.toLowerCase();
      for (const m of full.match(/\$([a-z][a-z0-9]{1,11})\b/g) || []) {
        const ticker = cleanTicker(m.replace("$", ""));
        if (isValidKeyword(ticker))
          upsert(
            ticker,
            heat * 8 * tier * recencyMult,
            "reddit",
            `r/${sub}`,
            "socialScore",
            { hasTicker: true },
          );
      }
      if (upvotes > 5000) {
        const properNouns = title.match(/\b[A-Z][a-z]{2,14}\b/g) || [];
        for (const noun of properNouns) {
          const clean = cleanTicker(noun);
          if (isValidKeyword(clean)) {
            upsert(
              clean,
              heat * 1.5 * tier * recencyMult,
              "reddit",
              `r/${sub}`,
              "socialScore",
            );
            registerViralWord(
              clean,
              `r/${sub}: "${title.slice(0, 60)}"`,
              "reddit",
            );
          }
        }
      }
      const isAnimalSub = [
        "aww",
        "rarepuppers",
        "Eyebleach",
        "CatsAreAssholes",
        "dogswithjobs",
        "AnimalsBeingBros",
      ].includes(sub);
      if (isAnimalSub && upvotes > 1000) {
        for (const animal of ANIMAL_VIRAL_SIGNALS) {
          if (full.includes(animal))
            upsert(
              animal,
              heat * 5 * tier * recencyMult,
              "reddit",
              `r/${sub}`,
              "socialScore",
            );
        }
      }
    }
  }

  // ── Rugcheck — checks top 15 by TOTAL score ────────────────────────────────
  const topByTotalScore = Array.from(scoreMap.entries())
    .filter(([, v]) => v.contractAddress)
    .map(([key, v]) => ({
      key,
      v,
      totalScore:
        v.viralScore +
        v.socialScore +
        v.onchainScore +
        v.geckoScore +
        v.celebScore +
        v.narrativeScore +
        v.storyScore +
        v.twitterScore +
        v.telegramScore,
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 35);

  const rugChecks = await Promise.all(
    topByTotalScore.map(async ({ key, v }) => ({
      key,
      ...(await checkRug(v.contractAddress!)),
    })),
  );
  for (const { key, risk, details, topHolderPct } of rugChecks) {
    const e = scoreMap.get(key);
    if (e) {
      e.rugRisk = risk;
      e.rugDetails = details;
      e.topHolderPct = topHolderPct;
    }
  }

  // ── Smart money — same top-35 batch, runs in parallel with rugcheck above
  // rather than as a separate pass. Two Birdeye calls per token (holders +
  // PnL), both already covered by BIRDEYE_API_KEY.
  const smartMoneyChecks = await Promise.all(
    topByTotalScore.map(async ({ key, v }) => ({
      key,
      intel: await getSmartMoneyIntel(v.contractAddress!),
    })),
  );
  // Cross-scan reputation: blend each wallet's accumulated track record
  // (learned over past scans, from Mongo) into this scan's raw score —
  // this is the part that actually "learns" instead of judging each
  // wallet fresh every single scan.
  const allWallets = smartMoneyChecks.flatMap((c) => c.intel.topWallets);
  const repBoost = await getWalletReputationBoost(
    allWallets.map((w) => w.address),
  );
  for (const { key, intel } of smartMoneyChecks) {
    const e = scoreMap.get(key);
    if (!e) continue;
    const repAdj = intel.topWallets.reduce(
      (sum, w) => sum + (repBoost.get(w.address) ?? 0) * 0.15,
      0,
    );
    e.smartMoneyScore = Math.max(
      0,
      Math.min(100, Math.round(intel.smartMoneyScore + repAdj)),
    );
    e.smartWallets = intel.topWallets;
  }
  // Fire-and-forget — don't block the scan response on a Mongo write.
  if (allWallets.length) recordWalletObservations(allWallets);
  logs.push(`[Rugcheck] ${rugChecks.length} tokens checked`);

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL SCORING + CONVICTION LAYER
  // ─────────────────────────────────────────────────────────────────────────
  const scoredEntries = Array.from(scoreMap.entries())
    .map(([keyword, v]) => {
      if (v.mcap !== undefined && v.mcap >= MAX_MCAP) return null;
      if (v.ageMinutes !== undefined && v.ageMinutes > MAX_AGE_MINUTES)
        return null;
      if (v.priceChange1h !== undefined && v.priceChange1h > MAX_1H_CHANGE)
        return null;
      if (v.priceChange24h !== undefined && v.priceChange24h > MAX_24H_CHANGE)
        return null;
      if (v.priceChange24h !== undefined && v.priceChange24h < MIN_24H_CHANGE)
        return null;
      if (v.rugRisk === "high") return null;
      if (
        v.mcap &&
        v.mcap > 0 &&
        v.liquidity &&
        v.liquidity > 0 &&
        v.liquidity / v.mcap > MAX_LIQ_MCAP_RATIO
      )
        return null;
      if (
        v.liquidity !== undefined &&
        v.liquidity > 0 &&
        v.liquidity < MIN_LIQUIDITY
      )
        return null;
      if (
        v.volume !== undefined &&
        v.volume > 0 &&
        v.mcap !== undefined &&
        v.mcap > 0
      ) {
        const volRatio = v.volume / v.mcap;
        if (
          volRatio < MIN_VOL_MCAP_RATIO &&
          !v.celebMention &&
          !v.narrativeScore &&
          !v.twitterScore &&
          !v.telegramScore
        )
          return null;
      }
      const isOnchain = v.platforms.some((p) =>
        ["pumpfun", "dexscreener", "birdeye"].includes(p),
      );
      const hasAIStory = v.platforms.some((p) =>
        ["story", "celebrity"].includes(p),
      );
      if (
        !isOnchain &&
        !hasAIStory &&
        v.ageMinutes === undefined &&
        v.twitterScore === 0 &&
        v.telegramScore === 0
      )
        return null;

      const platformCount = v.platforms.length;
      const crossBonus =
        platformCount >= 5
          ? 3.5
          : platformCount >= 4
            ? 2.6
            : platformCount >= 3
              ? 1.8
              : platformCount >= 2
                ? 1.3
                : 1.0;
      const tickerBonus = v.hasTicker ? 3.5 : 1.0;
      const newCoinBonus = v.isNewCoin ? 2.2 : 1.0;
      const celebBonus = v.celebScore > 0 ? 8.0 : 1.0;
      const narrativeBonus = v.narrativeScore > 0 ? 6.0 : 1.0;
      const storyBonus = v.storyScore > 0 ? 4.0 : 1.0;
      const twitterBonus =
        v.twitterScore > 0 ? 1 + Math.min(v.twitterScore / 100000, 4.0) : 1.0;
      const telegramBonus =
        v.telegramScore > 0 ? 1 + Math.min(v.telegramScore / 60000, 5.0) : 1.0;
      const coinabilityBonus = v.coinabilityScore
        ? 1 + (v.coinabilityScore / 100) * 3.5
        : 1.0;
      const finalMcapMult = mcapMultiplier(v.mcap);
      if (finalMcapMult === 0) return null;
      const viralPlatforms = v.platforms.filter((p) =>
        [
          "google-trends",
          "google-news",
          "youtube",
          "kym",
          "twitter",
          "telegram",
          "celebrity",
        ].includes(p),
      ).length;
      const viralBonus =
        viralPlatforms >= 3
          ? 4.5
          : viralPlatforms >= 2
            ? 2.8
            : viralPlatforms >= 1
              ? 1.6
              : 1.0;
      const rugPenalty = v.rugRisk === "medium" ? 0.6 : 1.0;
      const mentionWeight = Math.log2(v.posts + 2);
      const liqBonus = v.liquidity
        ? v.liquidity > 50000
          ? 1.5
          : v.liquidity > 20000
            ? 1.3
            : v.liquidity > 5000
              ? 1.1
              : 0.9
        : 1.0;
      const globalAgeMult = ageMultiplier(v.ageMinutes);
      if (globalAgeMult === 0) return null;
      const velMult = velocityMultiplier(
        v.viralScore + v.socialScore + v.onchainScore,
        v.ageMinutes,
      );
      const volSpike = volumeSpikeMultiplier(v.volume, v.mcap);
      const animalFinalBoost =
        v.animalBoost ||
        getAnimalBoost(keyword, v.viralContext || v.aiContext || "");
      const confirmFinalBonus = getConfirmationBonus(keyword);
      const gradFinalBonus = v.nearGraduation ? 2.5 : 1.0;
      const replyBonus = v.replyCount
        ? Math.min(1 + (v.replyCount / 100) * 0.5, 3.0)
        : 1.0;

      const raw =
        v.viralScore * 2.0 +
        v.socialScore * 1.5 +
        v.onchainScore * 2.8 +
        v.geckoScore * 2.0 +
        v.celebScore * 7.0 +
        v.narrativeScore * 9.0 +
        v.storyScore * 7.0 +
        v.twitterScore * 4.0 +
        v.telegramScore * 5.0;
      // Smart Money boost: 0-100 score mapped to 1.0x - 3.5x multiplier.
      // ScoreEntry keeps this optional because wallet intel may be unavailable;
      // normalize it before arithmetic so rankings never become NaN.
      const smartMoneyScore = v.smartMoneyScore ?? 0;
      const smartMoneyBonus = 1 + (smartMoneyScore / 100) * 2.5;

      const finalRawScore = Math.round(
        raw *
          mentionWeight *
          tickerBonus *
          crossBonus *
          newCoinBonus *
          celebBonus *
          narrativeBonus *
          storyBonus *
          twitterBonus *
          telegramBonus *
          coinabilityBonus *
          finalMcapMult *
          viralBonus *
          rugPenalty *
          liqBonus *
          globalAgeMult *
          velMult *
          volSpike *
          animalFinalBoost *
          confirmFinalBonus *
          gradFinalBonus *
          replyBonus *
          smartMoneyBonus,
      );

      const { bonus: narrativeBonusCheck } = getNarrativeBonus(keyword);
      const conviction = calcConviction({
        mcap: v.mcap,
        liquidity: v.liquidity,
        volume24h: v.volume,
        priceChange1h: v.priceChange1h,
        priceChange24h: v.priceChange24h,
        ageMinutes: v.ageMinutes,
        replyCount: v.replyCount,
        crossPlatforms: platformCount,
        hasNarrative: narrativeBonusCheck > 0 || v.narrativeScore > 0,
        narrativeFreshH: undefined,
        hasCeleb: v.celebScore > 0,
        hasAnimal:
          (v.animalBoost || 0) > 1 ||
          ANIMAL_VIRAL_SIGNALS.some((a) => keyword.includes(a)),
        hasOnchain: isOnchain,
        nearGraduation: v.nearGraduation,
        rugRisk: v.rugRisk,
        confirmationSources: sourceConfirmationMap.get(keyword)?.size,
        topHolderPct: v.topHolderPct,
        smartMoneyScore,
      });

      if (conviction.tier === "SKIP") return null;

      let ageLabel: string | undefined;
      if (v.ageMinutes !== undefined) {
        ageLabel =
          v.ageMinutes < 60
            ? `${v.ageMinutes}m old`
            : v.ageMinutes < 1440
              ? `${Math.floor(v.ageMinutes / 60)}h old`
              : `${Math.floor(v.ageMinutes / 1440)}d old`;
      }

      const convictionMult =
        conviction.tier === "ULTRA"
          ? 4.0
          : conviction.tier === "HIGH"
            ? 2.5
            : conviction.tier === "MEDIUM"
              ? 1.2
              : 0.5;
      const finalScore = Math.round(finalRawScore * convictionMult);

      return {
        keyword,
        score: finalScore,
        posts: v.posts,
        source:
          v.sources.length > 3
            ? `${v.sources.slice(0, 2).join(" + ")} +${v.sources.length - 2}`
            : v.sources.join(" + ") || "unknown",
        hasTicker: v.hasTicker,
        isNewCoin: v.isNewCoin,
        crossPlatforms: platformCount,
        platforms: v.platforms,
        ageLabel,
        ageMinutes: v.ageMinutes,
        mcap: v.mcap,
        volume: v.volume,
        liquidity: v.liquidity,
        priceChange1h: v.priceChange1h,
        priceChange24h: v.priceChange24h,
        contractAddress: v.contractAddress,
        rugRisk: v.rugRisk,
        rugDetails: v.rugDetails,
        topHolderPct: v.topHolderPct,
        smartMoneyScore: v.smartMoneyScore,
        smartWallets: v.smartWallets,
        aiContext: v.narrativeStory || v.aiContext || v.viralContext,
        celebMention: v.celebMention,
        narrativeStory: v.narrativeStory,
        archetypeType: v.archetypeType,
        coinabilityScore: v.coinabilityScore,
        isPredictive: v.isPredictive || false,
        impressions: v.impressions,
        hasFanCommunity: v.hasFanCommunity || false,
        fanCommunitySize: v.fanCommunitySize,
        isNarrativeCoin: v.narrativeScore > 0 || v.storyScore > 0,
        onAI: v.platforms.includes("ai") || v.platforms.includes("story"),
        onCeleb: v.platforms.includes("celebrity"),
        onTwitter: v.platforms.includes("twitter"),
        onTelegram: v.platforms.includes("telegram"),
        onNarrative: v.narrativeScore > 0,
        onStory: v.storyScore > 0,
        onDex:
          v.platforms.includes("dexscreener") ||
          v.platforms.includes("pumpfun") ||
          v.platforms.includes("birdeye"),
        isViralTrend: viralPlatforms >= 1,
        ageDays: v.ageMinutes !== undefined ? v.ageMinutes / 1440 : undefined,
        isAnimalMeme:
          (v.animalBoost || 0) > 1 ||
          ANIMAL_VIRAL_SIGNALS.some((a) => keyword.includes(a)),
        confirmationSources: sourceConfirmationMap.get(keyword)?.size || 0,
        volumeSpike: volumeSpikeMultiplier(v.volume, v.mcap) > 2,
        nearGraduation: v.nearGraduation || false,
        twoXScore: conviction.score,
        twoXTier: conviction.tier,
        twoXReasons: conviction.reasons,
        twoXKillers: conviction.killers,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // ── FILTER ─────────────────────────────────────────────────────────────────
  const filtered = scoredEntries.filter((r) => {
    if (r.score <= 0) return false;
    if (r.twoXTier === "LOW" && !r.onCeleb && !r.isNarrativeCoin && !r.onDex)
      return false;
    const hasCeleb = r.onCeleb;
    const hasStory = r.isNarrativeCoin || r.isPredictive;
    const hasRealAI = r.onAI && r.aiContext && r.aiContext.length > 20;
    const hasOnchain = r.onDex;
    const hasTwitter = r.onTwitter;
    const hasTelegram = r.onTelegram;
    const hasAnySocial = (r.platforms || []).some((p: string) =>
      [
        "reddit",
        "google-trends",
        "youtube",
        "kym",
        "google-news",
        "hackernews",
      ].includes(p),
    );
    const isAnimal = r.isAnimalMeme;
    const hasHighConfirmation =
      r.confirmationSources >= CONFIRMATION_MATRIX_THRESHOLD;
    const hasVolSpike = r.volumeSpike;
    if (hasCeleb || hasStory || hasRealAI) return true;
    if (isAnimal && (hasOnchain || hasAnySocial)) return true;
    if (hasHighConfirmation) return true;
    if (hasVolSpike && hasOnchain) return true;
    if (r.nearGraduation && hasOnchain) return true;
    if (hasOnchain && (hasTwitter || hasTelegram || hasAnySocial)) return true;
    if (hasOnchain && r.score >= 100) return true;
    if ((hasTwitter || hasTelegram) && r.ageMinutes !== undefined) return true;
    if (hasAnySocial && r.crossPlatforms >= 2 && r.ageMinutes !== undefined)
      return true;
    if (hasOnchain) return true;
    return false;
  });

  const finalResults =
    filtered.length > 0
      ? filtered
      : scoredEntries.filter((r) => r.score > 0 && r.onDex).slice(0, 20);

  // ── SORT ───────────────────────────────────────────────────────────────────
  const results = finalResults
    .sort((a, b) => {
      const getMcapBoost = (r: typeof a) =>
        !r.mcap
          ? 1.2
          : r.mcap < 5000
            ? 10.0
            : r.mcap < 15000
              ? 7.0
              : r.mcap < 40000
                ? 5.0
                : r.mcap < 80000
                  ? 3.0
                  : r.mcap < 200000
                    ? 1.5
                    : 1.0;
      const getAgeBoost = (r: typeof a) =>
        !r.ageMinutes
          ? 0.8
          : r.ageMinutes >= GOLDEN_WINDOW_MIN &&
              r.ageMinutes <= GOLDEN_WINDOW_MAX
            ? 7.0
            : r.ageMinutes < GOLDEN_WINDOW_MIN
              ? 5.0
              : r.ageMinutes < 360
                ? 2.5
                : r.ageMinutes < 1440
                  ? 1.5
                  : r.ageMinutes < MAX_AGE_MINUTES
                    ? 0.8
                    : 0;
      const getConvictionBoost = (r: typeof a) =>
        r.twoXTier === "ULTRA"
          ? 8.0
          : r.twoXTier === "HIGH"
            ? 4.0
            : r.twoXTier === "MEDIUM"
              ? 2.0
              : 1.0;
      const getStoryBoost = (r: typeof a) =>
        r.isNarrativeCoin && r.onDex
          ? 9.0
          : r.isNarrativeCoin
            ? 5.0
            : r.isPredictive
              ? 2.5
              : 1.0;
      const aBoost =
        (a.onCeleb ? 5.0 : 1) *
        getStoryBoost(a) *
        (a.isViralTrend && a.onDex ? 3.0 : 1) *
        (a.onTwitter && a.onDex ? 2.5 : 1) *
        (a.onTelegram && a.onDex ? 3.0 : 1) *
        getMcapBoost(a) *
        getAgeBoost(a) *
        getConvictionBoost(a) *
        (a.nearGraduation ? 2.0 : 1) *
        (a.volumeSpike ? 1.8 : 1);
      const bBoost =
        (b.onCeleb ? 5.0 : 1) *
        getStoryBoost(b) *
        (b.isViralTrend && b.onDex ? 3.0 : 1) *
        (b.onTwitter && b.onDex ? 2.5 : 1) *
        (b.onTelegram && b.onDex ? 3.0 : 1) *
        getMcapBoost(b) *
        getAgeBoost(b) *
        getConvictionBoost(b) *
        (b.nearGraduation ? 2.0 : 1) *
        (b.volumeSpike ? 1.8 : 1);
      return b.score * bBoost - a.score * aBoost;
    })
    .slice(0, 60);

  const ultraCount = results.filter((r) => r.twoXTier === "ULTRA").length;
  const highCount = results.filter((r) => r.twoXTier === "HIGH").length;
  const freshCount = results.filter(
    (r) => (r.ageMinutes || 9999) < 1440,
  ).length;
  const gradCount = results.filter((r) => r.nearGraduation).length;

  logs.push(
    `[Done v24-HARDENED] ${results.length} results | 🔥 ${ultraCount} ULTRA | ⚡ ${highCount} HIGH | 🌱 ${freshCount} fresh | 🎓 ${gradCount} near grad`,
  );

  // FIX 5.4: Cap response size — trim string fields and limit log lines
  const trimmedResults = results.map((r) => ({
    ...r,
    aiContext: r.aiContext ? r.aiContext.slice(0, 300) : undefined,
    narrativeStory: r.narrativeStory
      ? r.narrativeStory.slice(0, 300)
      : undefined,
    twoXReasons: r.twoXReasons?.slice(0, 5),
    twoXKillers: r.twoXKillers?.slice(0, 3),
  }));

  return NextResponse.json({
    results: trimmedResults,
    logs: logs.slice(-50), // cap log lines — full scan can produce 200+
    scannedAt: new Date().toISOString(),
    stories: Array.from(storyRegistry.values()).slice(0, 20),
    sourceStats: {
      twitterTweets: twitterData.rawTexts.length,
      telegramPosts: telegramData.rawTexts.length,
      pumpCoins: pumpResults.length,
      dexPairs: dexResults.length,
      birdeyeTokens: birdeyeData.results.length,
      scoreMapSize: scoreMap.size,
      ultraConviction: ultraCount,
      highConviction: highCount,
      nearGraduation: gradCount,
    },
  });
}
