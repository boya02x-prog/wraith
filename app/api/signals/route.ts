// app/api/signals/route.ts
// Fast, AI-free signal feed. Reads the shared /api/market cache (one upstream
// fetch for every viewer), then scores each token on momentum, volume
// pressure, buy/sell balance, liquidity health and freshness.
// No Gemini / Twitter / Rugcheck calls: this is cheap enough to poll.

import { after, NextRequest, NextResponse } from "next/server";
import { cleanSym, cleanName } from "@/lib/cleanText";
import type { MarketCategory, MarketToken } from "@/lib/market";
import { recordSignals, refreshCalls, type RecordInput } from "@/lib/signalCalls";
import { enrichSignals, featuresOf, type SignalIntel } from "@/lib/signalIntel";
import { getSolUsd, IGNORED_MINTS, IGNORED_SYMBOLS } from "@/lib/marketProviders";
import { evmCandidates } from "@/lib/evmScan";
import { dexCandidates, jupiterCandidates, jupiterEnrich, pumpCandidates, type Candidate, type ScanMeta } from "@/lib/scannerSources";
import { callGet } from "@/lib/internalCall";
import { annotateFeatures, patternLabel, type Annotated } from "@/lib/signalLearning";
import { edge } from "@/lib/edge";

export type SignalTier = "HOT" | "WATCH";
export interface Signal {
  token: MarketToken;
  score: number;
  tier: SignalTier;
  tags: string[];
  risks: string[];
  meta?: ScanMeta;
  /** dev history, buyer-flow and proven-wallet intel (Solana only) */
  intel?: SignalIntel;
  /** pattern ids detected on this token (see lib/signalModel PATTERNS) */
  patterns?: string[];
  /** learned chance (%) of reaching 2x; only present once the model has beaten chance on unseen calls */
  odds?: number;
  /** learned chance (%) that this call collapses below 20% of its price; only present once the rug model has proven itself */
  rugRisk?: number;
}

const CACHE_MS = 30_000;
interface Built { signals: Signal[]; records: RecordInput[] }
let cache: { ts: number; signals: Signal[]; records: RecordInput[] } | null = null;
let inflight: Promise<Built> | null = null;
let persisted: Built | null = null;
// after() needs room to finish the database writes once the response has gone out
export const maxDuration = 60;
/** DB writes + price refresh happen once per build, not once per request that was waiting on it. */
async function persistOnce(built: Built): Promise<void> {
  if (persisted === built) return;
  persisted = built;
  await recordSignals(built.records).catch(() => undefined);
  await refreshCalls().catch(() => undefined);
}
const RUG_BLOCK = Number(process.env.SIGNAL_RUG_BLOCK) || 60;
const RUG_WARN = Number(process.env.SIGNAL_RUG_WARN) || 40;
const HOT_MIN = Number(process.env.SIGNAL_HOT_MIN) || 72;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/**
 * Scam setups that can never be a public call, whatever the score. A token whose creator can still mint more supply or freeze
 * holders can be emptied at will, and a serial launcher with no graduations is farming launches. They stay visible as WATCH with the reason.
 */
function hardBlock(sg: Signal): string | undefined {
  const isSol = !sg.token.chain || sg.token.chain === "solana";
  if (isSol && sg.meta?.mintRevoked === false) return "Mint authority open";
  if (isSol && sg.meta?.freezeRevoked === false) return "Freeze authority open";
  return sg.intel?.block;
}
const withBudget = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

/**
 * Score 0-100 across seven pillars: volume pressure, buy pressure, momentum,
 * liquidity health, freshness, token quality (holders / organic / authorities)
 * and manipulation checks. Hard gates drop dust, mega-caps and unsellable pools.
 */
function scoreToken(t: MarketToken, meta: ScanMeta, now: number): Signal | null {
  if (!(t.priceUsd > 0) || !(t.mcap > 0)) return null;
  if (IGNORED_MINTS.has(t.address) || IGNORED_SYMBOLS.has(t.symbol.toUpperCase())) return null;
  const liq = t.liquidity || 0;
  if (!t.onCurve && liq < 3_000) return null;
  if (t.mcap < 5_000 || t.mcap > 50_000_000) return null;

  const good: string[] = [];
  const risks: string[] = [];
  let score = 0;

  // 1. volume pressure (1h volume vs market cap)
  const volRatio = t.volume.h1 / t.mcap;
  score += clamp(volRatio * 140, 0, 16);
  if (volRatio >= 0.08) good.push("Volume surge");

  // 2. buy pressure: real buy/sell volume when we have it, else txn counts
  let buyShare: number | null = null;
  if (meta.buyVol1h !== undefined && meta.sellVol1h !== undefined && meta.buyVol1h + meta.sellVol1h > 0) {
    buyShare = meta.buyVol1h / (meta.buyVol1h + meta.sellVol1h);
  } else if (t.txns.buys + t.txns.sells >= 40) {
    buyShare = t.txns.buys / (t.txns.buys + t.txns.sells);
  }
  if (buyShare !== null) {
    // healthy accumulation sits in 0.55-0.82; a 90%+ one-sided tape is usually bots or a thin book
    if (buyShare >= 0.5 && buyShare <= 0.9) score += clamp((buyShare - 0.5) * 36, 0, 12);
    else if (buyShare > 0.9) { score -= 3; risks.push("One-sided flow"); }
    if (buyShare >= 0.55 && buyShare <= 0.9) good.push("Buy pressure");
    if (buyShare < 0.42) { score -= 5; risks.push("Sell heavy"); }
  }

  // 3. momentum
  const h1 = t.change.h1 ?? 0;
  const m5 = t.change.m5 ?? 0;
  const h6 = t.change.h6 ?? 0;
  const h24 = t.change.h24 ?? 0;
  // Reward the early, building move; punish the late chase (the old scorer ranked tokens that had already pumped first).
  if (h1 >= 8 && h1 <= 90) score += clamp(h1 / 6, 0, 14);
  else if (h1 > 90 && h1 <= 200) score += 6;
  else if (h1 > 200) { score -= 12; risks.push("Late: already ran"); }
  if (m5 > 0) score += 4;
  if (h1 > 0 && m5 > 0 && m5 * 12 > h1) { score += 4; good.push("Accelerating"); }
  if (h1 > 0 && h6 > 10) { score += 3; good.push("Sustained"); }
  if (h24 < -50) { score -= 20; risks.push("Down hard 24h"); }
  else if (h1 < -10) { score -= 10; risks.push("Dumping"); }
  if (h1 >= 15 && m5 > 0) good.push("Trending up");

  // market-cap sweet spot: small enough to still 2x, big enough to have real depth
  if (t.mcap >= 8_000 && t.mcap <= 150_000) score += 5;
  else if (t.mcap > 600_000) score -= 6;
  if (t.chain && t.chain !== "solana") score -= 5;

  // 4. liquidity health
  const liqRatio = liq / t.mcap;
  if (liq >= 20_000) { score += 5; good.push("Strong liquidity"); }
  if (liqRatio >= 0.05 && liqRatio <= 0.6) score += 10;
  else if (!t.onCurve) risks.push(liqRatio < 0.05 ? "Thin liquidity" : "Liquidity-heavy");

  // 5. freshness
  if (t.createdAt) {
    const ageH = (now - t.createdAt) / 3_600_000;
    if (ageH <= 6) { score += 10; good.push("Fresh"); }
    else if (ageH <= 24) { score += 7; good.push("New today"); }
    else if (ageH <= 72) score += 3;
    else if (ageH > 24 * 14) score -= 8;
  }
  if (t.graduated) { score += 5; good.push("Graduated"); }
  if (t.onCurve && (t.curveProgress ?? 0) > 0.6) { score += 5; good.push(`Curve ${Math.round((t.curveProgress ?? 0) * 100)}%`); }

  // 6. quality (Jupiter data): holders, organic activity, authorities, concentration
  if (meta.organicScore !== undefined) {
    if (meta.organicScore >= 70) { score += 8; good.push(`Organic ${Math.round(meta.organicScore)}`); }
    else if (meta.organicScore >= 40) score += 4;
    else if (meta.organicScore < 20) { score -= 6; risks.push("Low organic"); }
  }
  if (meta.holders !== undefined) {
    if (meta.holders >= 1000) { score += 6; good.push(`${compact(meta.holders)} holders`); }
    else if (meta.holders >= 300) score += 3;
    else if (meta.holders < 60) { score -= 5; risks.push("Few holders"); }
  }
  if (meta.mintRevoked === true && meta.freezeRevoked === true) { score += 5; good.push("Authorities revoked"); }
  if (meta.mintRevoked === false) { score -= 15; risks.push("Mint authority"); }
  if (meta.freezeRevoked === false) { score -= 15; risks.push("Freeze authority"); }
  if (meta.topHoldersPct !== undefined && meta.topHoldersPct > 50) { score -= 10; risks.push(`Top holders ${Math.round(meta.topHoldersPct)}%`); }
  if (meta.devPct !== undefined && meta.devPct > 15) { score -= 6; risks.push(`Dev holds ${Math.round(meta.devPct)}%`); }

  // 7. manipulation: huge volume from very few wallets
  if (meta.traders1h !== undefined && meta.traders1h < 15 && volRatio > 1.5) { score -= 15; risks.push("Wash volume"); }

  score = Math.round(clamp(score, 0, 100));
  if (score < 22) return null;
  return {
    token: t,
    score,
    tier: "WATCH",
    tags: good.slice(0, 5),
    risks: risks.slice(0, 3),
    meta: Object.keys(meta).length ? meta : undefined,
  };
}

async function build(origin: string): Promise<Built> {
  const solUsd = await getSolUsd();
  const cats: MarketCategory[] = ["trending", "new", "gainers", "volume"];

  // The market lane is called in-process: a server-side fetch to our own URL hits the sign-in gate (no cookie) and 401s,
  // which silently dropped this whole lane. A slow provider never holds the feed up: whatever has not answered in 6s is
  // skipped this round (the market route keeps working in the background and has it cached next time).
  const [market, jup, dex, pump, evm] = await Promise.all([
    Promise.allSettled(
      cats.map(async (c) => {
        const data = await callGet<{ tokens?: MarketToken[] }>(() => import("@/app/api/market/route"), `${origin}/api/market?category=${c}`, 6_000);
        return data.tokens ?? [];
      }),
    ),
    jupiterCandidates(solUsd).catch(() => [] as Candidate[]),
    dexCandidates(solUsd).catch(() => [] as MarketToken[]),
    withBudget(pumpCandidates(solUsd), 6_000, [] as MarketToken[]),
    evmCandidates().catch(() => [] as Candidate[]),
  ]);

  const byAddr = new Map<string, Candidate>();
  // Market feed (Gecko) first: best txn/age data.
  for (const r of market) {
    if (r.status !== "fulfilled") continue;
    for (const t of r.value) if (!byAddr.has(t.address)) byAddr.set(t.address, { token: t, meta: {} });
  }
  // Jupiter: add new mints, attach quality meta to existing ones.
  for (const c of jup) {
    const have = byAddr.get(c.token.address);
    if (!have) byAddr.set(c.token.address, c);
    else {
      have.meta = { ...c.meta, ...have.meta };
      if (!have.token.imageUrl) have.token.imageUrl = c.token.imageUrl;
      if (!have.token.createdAt) have.token.createdAt = c.token.createdAt;
    }
  }
  // DexScreener + pump.fun live discovery (what is trading right now and the newest launches): fill gaps.
  for (const t of [...dex, ...pump]) {
    const have = byAddr.get(t.address);
    if (!have) byAddr.set(t.address, { token: t, meta: {} });
    else if (!have.token.imageUrl && t.imageUrl) have.token.imageUrl = t.imageUrl;
  }
  // Every other supported chain (Base, Ethereum, BNB, Monad, Arc, Robinhood).
  for (const c of evm) if (!byAddr.has(c.token.address)) byAddr.set(c.token.address, c);
  if (!byAddr.size) throw new Error("no candidates from any source");

  // One batched Jupiter lookup for anything still missing quality data.
  const missing = [...byAddr.values()].filter((c) => c.meta.holders === undefined && (!c.token.chain || c.token.chain === "solana")).map((c) => c.token.address).slice(0, 100);
  if (missing.length) {
    const extra = await jupiterEnrich(missing, solUsd);
    for (const [addr, m] of extra) {
      const c = byAddr.get(addr);
      if (c) c.meta = { ...m, ...c.meta };
    }
  }

  const now = Date.now();
  const scored: Signal[] = [];
  for (const c of byAddr.values()) {
    const s = scoreToken(c.token, c.meta, now);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);
  // Keep the quality bar (>=35) but never leave the feed near-empty.
  const strong = scored.filter((s) => s.score >= 35);
  const pool = strong.length >= 15 ? strong : scored;
  // Top 80 overall, but every chain keeps a seat: guarantee its best 8 are included.
  const top = pool.slice(0, 80);
  const seen = new Set(top.map((s) => s.token.address));
  const perChain = new Map<string, number>();
  for (const s of top) perChain.set(s.token.chain ?? "solana", (perChain.get(s.token.chain ?? "solana") ?? 0) + 1);
  for (const s of scored) {
    const k = s.token.chain ?? "solana";
    if (seen.has(s.token.address) || (perChain.get(k) ?? 0) >= 8) continue;
    top.push(s); seen.add(s.token.address); perChain.set(k, (perChain.get(k) ?? 0) + 1);
  }
  top.sort((a, b) => b.score - a.score);

  // Scanner v2: pull dev history, buyer flow and proven-wallet intel for the best Solana candidates,
  // fold it into the score, then decide the final tier. HOT is rare on purpose.
  await enrichSignals(top, { max: 24, minScore: 45, hotMin: HOT_MIN, concurrency: 3, budgetMs: 5_000 }).catch(() => undefined);
  for (const sg of top) {
    sg.score = Math.round(clamp(sg.score, 0, 100));
    const isSol = !sg.token.chain || sg.token.chain === "solana";
    const vetted = isSol ? !!sg.intel && !hardBlock(sg) : !hardBlock(sg);
    sg.tier = sg.score >= HOT_MIN && vetted ? "HOT" : "WATCH";
    const why = hardBlock(sg);
    if (why) sg.risks = [why, ...sg.risks.filter((r) => r !== why)].slice(0, 3);
  }
  // Pattern recognition + learned odds. The learned nudge is capped and only applies once the model beats chance on unseen calls.
  const feats = top.map((sg) => featuresOf(sg.token, sg.meta ?? {}, sg.intel, now));
  const notes = await annotateFeatures(feats).catch(() => feats.map((): Annotated => ({ patterns: [], adj: 0 })));
  top.forEach((sg, i) => {
    const n = notes[i];
    if (!n) return;
    sg.patterns = n.patterns;
    if (n.odds !== undefined) sg.odds = n.odds;
    if (n.adj) {
      sg.score = Math.round(clamp(sg.score + n.adj, 0, 100));
      const isSol = !sg.token.chain || sg.token.chain === "solana";
      const vetted = isSol ? !!sg.intel && !hardBlock(sg) : !hardBlock(sg);
      sg.tier = sg.score >= HOT_MIN && vetted ? "HOT" : "WATCH";
    }
    // Rug guard: a call the model expects to collapse is never HOT and loses score. Tested on unseen calls: the riskiest fifth
    // collapsed about 85% of the time, the safest fifth about 1%.
    if (n.rugRisk !== undefined) {
      sg.rugRisk = n.rugRisk;
      if (n.rugRisk >= RUG_BLOCK) {
        sg.score = Math.round(clamp(sg.score - 15, 0, 100));
        sg.tier = "WATCH";
        const msg = `High collapse risk (${n.rugRisk}%)`;
        sg.risks = [msg, ...sg.risks.filter((r) => r !== msg)].slice(0, 3);
      } else if (n.rugRisk >= RUG_WARN) {
        sg.score = Math.round(clamp(sg.score - 6, 0, 100));
        if (sg.tier === "HOT" && n.rugRisk >= RUG_WARN + 10) sg.tier = "WATCH";
        const msg = `Elevated collapse risk (${n.rugRisk}%)`;
        sg.risks = [...sg.risks.filter((r) => r !== msg), msg].slice(0, 3);
      }
    }
    const good = n.patterns.filter((id) => !id.startsWith("trap-")).slice(0, 2).map(patternLabel);
    const traps = n.patterns.filter((id) => id.startsWith("trap-")).slice(0, 1).map(patternLabel);
    if (good.length) sg.tags = [...good, ...sg.tags.filter((t) => !good.includes(t))].slice(0, 5);
    if (traps.length) sg.risks = [...sg.risks, ...traps.filter((t) => !sg.risks.includes(t))].slice(0, 3);
  });
  top.sort((a, b) => b.score - a.score);

  const records: RecordInput[] = top.map((sg) => ({
    token: sg.token, score: sg.score, tier: sg.tier, intel: sg.intel,
    features: featuresOf(sg.token, sg.meta ?? {}, sg.intel, now),
  }));
  // the wallet list is for the scoreboard only; never ship it to browsers
  const signals = top.map((sg0) => {
    const sg = { ...sg0, token: { ...sg0.token, symbol: cleanSym(sg0.token.symbol), name: cleanName(sg0.token.name) } };
    return sg.intel ? { ...sg, intel: { ...sg.intel, buyers: undefined } } : sg;
  });
  return { signals, records };
}

export async function GET(req: NextRequest) {
  if (cache && Date.now() - cache.ts < CACHE_MS) {
    return edge(NextResponse.json({ signals: cache.signals, updatedAt: cache.ts }), 10, 60);
  }
  if (!inflight) {
    inflight = build(req.nextUrl.origin).finally(() => { inflight = null; });
  }
  try {
    const built = await inflight;
    if (built.signals.length) cache = { ts: Date.now(), ...built };
    else if (!cache) throw new Error("scored zero candidates");
    // Persist new calls and refresh tracked prices for everyone. after() keeps the function alive until the writes
    // finish (serverless does not drop them) but the response no longer waits for the database: a slow or far-away
    // Atlas used to add its latency to every single scanner poll.
    // Server jobs (Telegram cron, tape) call this in-process and want the new calls in the database before they read it.
    if (req.headers.get("x-wraith-internal") === "1") await persistOnce(built);
    else after(() => persistOnce(built));
    return edge(NextResponse.json({ signals: cache.signals, updatedAt: cache.ts }), 10, 60);
  } catch {
    if (cache) return NextResponse.json({ signals: cache.signals, updatedAt: cache.ts, stale: true });
    return NextResponse.json({ signals: [], error: "Signal sources unreachable" }, { status: 502 });
  }
}
