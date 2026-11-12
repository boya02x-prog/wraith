// lib/signalIntel.ts  (server only)
// "Wraith Intelligence": leading signals that the plain market data cannot give us.
//   1. Dev history      who launched this token and what happened to their earlier launches
//   2. Order flow       who is buying right now (unique buyers, whale-led buys, buyer acceleration, bundled launches)
//   3. Proven wallets   how many of the buyers are wallets that keep showing up early in winners (learned in lib/walletLearn.ts)
// Everything here fails soft: if a source is down the token simply gets no adjustment from it.

import { getDb } from "@/lib/mongoClient";
import { fetchFlowSwaps } from "@/lib/chainFlow";
import { fetchTokenSwaps } from "@/lib/heliusSwaps";
import { SOLANA_MINT_RE, type MarketToken } from "@/lib/market";
import type { ScanMeta } from "@/lib/scannerSources";

export interface DevIntel { creator: string; created: number; graduated: number; dead: number; recent7d: number }
import type { FlowIntel } from "@/lib/signalFlow";
export type { FlowIntel };
export interface SmartIntel { smart: number; dumpers: number }
export interface SignalIntel {
  dev?: DevIntel;
  flow?: FlowIntel;
  smart?: SmartIntel;
  /** unique buyer wallets seen (oldest first). Server side only: stripped from API responses. */
  buyers?: string[];
  adj: number;
  block?: string;
  at: number;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ── 1. dev history (pump.fun) ───────────────────────────────────────────────────────────────────────────────
const PUMP_BASES = (process.env.PUMP_API_BASES || "https://frontend-api-v3.pump.fun,https://frontend-api.pump.fun").split(",").map((s) => s.trim()).filter(Boolean);

export async function pumpJson(path: string): Promise<unknown> {
  for (const base of PUMP_BASES) {
    try {
      const res = await fetch(`${base}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3500), cache: "no-store" });
      if (res.ok) return await res.json();
    } catch { /* try the next base */ }
  }
  return null;
}

const devByMint = new Map<string, { ts: number; v: DevIntel | null }>();
const devByCreator = new Map<string, { ts: number; v: Omit<DevIntel, "creator"> | null }>();

/** Parse a pump.fun "coins created by this wallet" list. Pure, exported for tests. */
export function parseDevCoins(list: unknown, currentMint: string, now = Date.now()): Omit<DevIntel, "creator"> {
  const rows = Array.isArray(list) ? list : Array.isArray(o(list).coins) ? (o(list).coins as unknown[]) : [];
  let created = 0, graduated = 0, dead = 0, recent7d = 0;
  for (const raw of rows) {
    const r = o(raw);
    if (r.mint === currentMint) continue;
    created++;
    const ts = Number(r.created_timestamp);
    const ageMs = Number.isFinite(ts) && ts > 0 ? now - (ts < 1e12 ? ts * 1000 : ts) : NaN;
    if (Number.isFinite(ageMs) && ageMs < 7 * 86_400_000) recent7d++;
    if (r.complete === true) { graduated++; continue; }
    const usd = Number(r.usd_market_cap);
    if (Number.isFinite(usd) && usd < 5_000 && Number.isFinite(ageMs) && ageMs > 2 * 3_600_000) dead++;
  }
  return { created, graduated, dead, recent7d };
}

export async function devIntel(mint: string): Promise<DevIntel | null> {
  if (!mint.endsWith("pump")) return null;
  const hit = devByMint.get(mint);
  if (hit && Date.now() - hit.ts < 10 * 60_000) return hit.v;
  let out: DevIntel | null = null;
  try {
    const coin = o(await pumpJson(`/coins/${mint}`));
    const creator = typeof coin.creator === "string" ? coin.creator : "";
    if (SOLANA_MINT_RE.test(creator)) {
      const cached = devByCreator.get(creator);
      let stats = cached && Date.now() - cached.ts < 6 * 3_600_000 ? cached.v : null;
      if (!stats) {
        const list = await pumpJson(`/coins/user-created-coins/${creator}?offset=0&limit=50&includeNsfw=true`);
        if (list) { stats = parseDevCoins(list, mint); devByCreator.set(creator, { ts: Date.now(), v: stats }); }
      }
      if (stats) out = { creator, ...stats };
    }
  } catch { /* soft */ }
  devByMint.set(mint, { ts: Date.now(), v: out });
  if (devByMint.size > 600) devByMint.clear();
  return out;
}

// ── 2. order flow (Helius swaps) ──────────────────────────────────────────────────────────────────────────
// computeFlow lives in lib/signalFlow.ts (pure, shared with the backfill scripts)
export { computeFlow } from "@/lib/signalFlow";
import { computeFlow } from "@/lib/signalFlow";

// ── 3. proven wallets (learned in lib/walletLearn.ts) ─────────────────────────────────────────────────────────
export const SMART_MIN_N = 3;
export function isSmart(s: { n?: number; wins?: number; dumps?: number }): boolean {
  const n = s.n ?? 0;
  // A wallet that is in winners AND ends in a 50%+ loss most of the time is a bot that buys everything, not a skilled buyer.
  const dumpy = n > 0 && (s.dumps ?? 0) / n >= 0.6;
  return n >= SMART_MIN_N && (s.wins ?? 0) / (n || 1) >= 0.3 && !dumpy;
}
export function isDumper(s: { n?: number; dumps?: number }): boolean {
  return (s.n ?? 0) >= 4 && (s.dumps ?? 0) / (s.n ?? 1) >= 0.75;
}

async function smartIntel(wallets: string[]): Promise<SmartIntel | null> {
  if (!wallets.length) return null;
  try {
    const db = await getDb();
    const rows = await db.collection<{ _id: string; n?: number; wins?: number; dumps?: number }>("wallet_stats")
      .find({ _id: { $in: wallets.slice(-80) } }, { projection: { n: 1, wins: 1, dumps: 1 } }).toArray();
    return { smart: rows.filter(isSmart).length, dumpers: rows.filter(isDumper).length };
  } catch { return null; }
}

const FLOW_SCORE_WEIGHT = Number(process.env.SIGNAL_FLOW_WEIGHT ?? 0);

// ── scoring ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Pure: how much the intel moves the score, plus tags / risks / a hard block reason. Exported for tests. */
export function scoreIntel(i: Pick<SignalIntel, "dev" | "flow" | "smart">): { adj: number; tags: string[]; risks: string[]; block?: string } {
  let adj = 0;
  const tags: string[] = [], risks: string[] = [];
  let block: string | undefined;
  const { dev, flow, smart } = i;
  if (dev) {
    if (dev.graduated >= 2) { adj += 8; tags.push(`Dev: ${dev.graduated} graduated`); }
    else if (dev.graduated === 1) { adj += 4; tags.push("Dev graduated before"); }
    if (dev.graduated === 0 && dev.dead >= 5) { adj -= 15; risks.push(`Dev: ${dev.dead} dead launches`); }
    if (dev.graduated === 0 && dev.recent7d >= 8) { block = "Serial launcher"; risks.push(`Dev launched ${dev.recent7d} in 7d`); }
  }
  // Buyer-flow rules still label the card (tags and risks) but no longer move the score: tested on 1,356 past calls with real on-chain
  // buyer flow (scripts/research-flow-adj.ts), adding these adjustments made the ranking WORSE (reach-2x AUC 0.603 -> 0.569; the flow
  // adjustment alone was 0.48, i.e. slightly backwards): buyers speeding up and net inflow mostly mean hype that later collapses.
  // Set FLOW_SCORE_WEIGHT to 1 to turn them back on if that ever changes.
  let flowAdj = 0;
  if (flow) {
    if (flow.top3Share > 0.5 && flow.buys >= 10) { flowAdj -= 6; risks.push(`Top 3 buyers ${Math.round(flow.top3Share * 100)}%`); }
    if (flow.buyers < 12 && flow.buys > 40) { flowAdj -= 8; risks.push("Few buyers, many buys"); }
    if (flow.bundled >= 5) { flowAdj -= 8; risks.push("Bundled launch"); }
    if (flow.accel >= 2 && flow.buyers >= 20) { flowAdj += 6; tags.push("Buyers accelerating"); }
    if (flow.netSol > 3) { flowAdj += 3; tags.push("Net inflow"); }
    else if (flow.netSol < -3) { flowAdj -= 4; risks.push("Net outflow"); }
    if (flow.buyers >= 60) { flowAdj += 3; tags.push(`${flow.buyers} buyers`); }
  }
  adj += flowAdj * FLOW_SCORE_WEIGHT;
  if (smart) {
    // Weights follow the 1,394-token walk-forward test (scripts/backtest-wallets.ts): proven wallets gave a modest edge for
    // finding 2x winners (AUC ~0.58) and repeat dumpers were a weak, non-linear signal (AUC ~0.53; the 10+ dumper group had the
    // HIGHEST 2x rate). So: small bonuses, small penalties, and no hard block on dumpers any more.
    if (smart.smart >= 3) { adj += 6; tags.push(`${smart.smart} proven wallets in`); }
    else if (smart.smart === 2) { adj += 4; tags.push("2 proven wallets in"); }
    else if (smart.smart === 1) { adj += 2; tags.push("1 proven wallet in"); }
    if (smart.dumpers >= 10) { adj -= 6; risks.push(`${smart.dumpers} repeat-dumper wallets`); }
    else if (smart.dumpers >= 5) { adj -= 3; risks.push(`${smart.dumpers} repeat-dumper wallets`); }
  }
  return { adj, tags, risks, block };
}

// ── orchestration ───────────────────────────────────────────────────────────────────────────────────────────
export interface Enrichable {
  token: MarketToken;
  score: number;
  tags: string[];
  risks: string[];
  intel?: SignalIntel;
}

// ── vetting cache ──
// The result of vetting a token (dev history, who bought, proven wallets). Kept in memory AND in the database, so every server
// instance (and a developer's machine) reuses the same lookup instead of each paying for its own.
const intelCache = new Map<string, { ts: number; intel: SignalIntel }>();
const FRESH_MS = 5 * 60_000; // younger than this: used as is, never looked up again
const RECHECK_MS = 10 * 60_000; // a token about to become a call (or a few points short) is looked at again this often
const VALID_MS = 30 * 60_000; // older than this the vetting no longer counts: the token is unvetted until it is looked up again
const CALLS_PER_LOOKUP = 3; // Helius calls one token costs on average (2 pages of trades, sometimes the pool as well)
type CacheDoc = { _id: string; intel: SignalIntel; at: Date };
let cacheIndexed = false;
async function cacheCol() {
  const c = (await getDb()).collection<CacheDoc>("intel_cache");
  if (!cacheIndexed) { cacheIndexed = true; void c.createIndex({ at: 1 }, { expireAfterSeconds: 3600 }).catch(() => undefined); }
  return c;
}
/** Pull what other instances already looked up for these tokens into this instance's memory. One query. */
async function hydrateIntel(mints: string[]): Promise<void> {
  const now = Date.now();
  const need = mints.filter((m) => { const c = intelCache.get(m); return !c || now - c.ts >= FRESH_MS; });
  if (!need.length) return;
  try {
    const docs = await (await cacheCol()).find({ _id: { $in: need }, at: { $gt: new Date(now - VALID_MS) } }).toArray();
    for (const d of docs) {
      const ts = new Date(d.at).getTime();
      const cur = intelCache.get(d._id);
      if (!cur || cur.ts < ts) intelCache.set(d._id, { ts, intel: d.intel });
    }
  } catch { /* database slow or down: this instance's memory is still used */ }
}
function rememberIntel(mint: string, intel: SignalIntel) {
  intelCache.set(mint, { ts: Date.now(), intel });
  void cacheCol().then((c) => c.updateOne({ _id: mint }, { $set: { intel, at: new Date() } }, { upsert: true })).catch(() => undefined);
}

// ── daily allowance, spread over the day ──
// Helius calls spent on vetting are capped per (UTC) day through one counter in the database, shared by every instance. Raise the
// cap with HELIUS_INTEL_DAILY_CALLS if the Helius plan has room.
//
// The first version let the whole day's allowance be used as fast as it was asked for. With a scan every two minutes that was about
// three hours; after that no token could be vetted, and because a public call REQUIRES vetting the scanner made no calls at all for
// the other 21 hours of every day. Now the allowance is released evenly: an eighth is there at midnight, the rest accrues minute by
// minute, so there is always something to spend. And it is spent in order of importance (see enrichSignals).
const INTEL_DAILY_CALLS = Number(process.env.HELIUS_INTEL_DAILY_CALLS) || 3000;
const DAY_MS = 86_400_000;
/** Pure: how many calls may have been spent by this moment of the UTC day. Exported for tests. */
export function intelAllowance(now = Date.now(), daily = INTEL_DAILY_CALLS): number {
  const burst = daily / 8;
  return Math.floor(burst + (daily - burst) * ((now % DAY_MS) / DAY_MS));
}
type BudgetDoc = { _id: string; calls: number; asked?: number; at: Date };
const budgetId = (now = Date.now()) => `intelspend:${new Date(now).toISOString().slice(0, 10)}`;
/**
 * Takes calls out of today's allowance for several classes of lookup at once, most important first. `share` is how much of the
 * allowance released so far that class may use up (1 = all of it), so the less important classes always leave room for the
 * important ones. Returns how many calls each class was granted. Two database operations at most.
 */
async function takeIntelBudget(classes: { want: number; share: number }[]): Promise<number[]> {
  const total = classes.reduce((n, c) => n + c.want, 0);
  if (total <= 0) return classes.map(() => 0);
  try {
    const col = (await getDb()).collection<BudgetDoc>("tg_state");
    const now = Date.now();
    const id = budgetId(now);
    const allowed = intelAllowance(now);
    const r = await col.findOneAndUpdate({ _id: id }, { $inc: { calls: total, asked: total }, $setOnInsert: { at: new Date() } }, { upsert: true, returnDocument: "after", includeResultMetadata: false });
    let before = (r?.calls ?? total) - total;
    // A counter that starts late in the day (first run after a deploy or an outage) does not inherit the unused morning: it starts as
    // if the pace had been kept, with only the normal head start to spend.
    if ((r?.asked ?? total) === total) {
      const seed = Math.max(0, allowed - Math.floor(INTEL_DAILY_CALLS / 8));
      if (seed > 0) { await col.updateOne({ _id: id }, { $inc: { calls: seed } }); before += seed; }
    }
    let used = before;
    const grants = classes.map((c) => {
      const g = Math.max(0, Math.min(c.want, Math.floor(allowed * c.share) - used));
      const whole = g - (g % CALLS_PER_LOOKUP); // a lookup is all or nothing
      used += whole;
      return whole;
    });
    const giveBack = total - grants.reduce((n, g) => n + g, 0);
    if (giveBack > 0) await col.updateOne({ _id: id }, { $inc: { calls: -giveBack } });
    return grants;
  } catch { return classes.map((c) => c.want); } // if the counter itself is unreachable, do not switch vetting off
}
/** For the health check: what today's allowance looks like right now. */
export async function intelBudgetStatus(): Promise<{ daily: number; releasedSoFar: number; spent: number; asked: number } | null> {
  try {
    const d = await (await getDb()).collection<BudgetDoc>("tg_state").findOne({ _id: budgetId() });
    return { daily: INTEL_DAILY_CALLS, releasedSoFar: intelAllowance(), spent: d?.calls ?? 0, asked: d?.asked ?? 0 };
  } catch { return null; }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function buildIntel(mint: string): Promise<SignalIntel> {
  // trades come from the chain through the RPC history route (fast, no rate trouble); the older swaps API is only the fallback
  const [dev, swaps] = await Promise.all([devIntel(mint), fetchFlowSwaps(mint, 2).then((r) => r ?? fetchTokenSwaps(mint, 2))]);
  const fl = swaps ? computeFlow(swaps) : null;
  const smart = fl ? await smartIntel(fl.buyers) : null;
  const parts = { dev: dev ?? undefined, flow: fl?.flow, smart: smart ?? undefined };
  const sc = scoreIntel(parts);
  return { ...parts, buyers: fl?.buyers, adj: sc.adj, block: sc.block, at: Date.now() };
}

function apply(s: Enrichable, intel: SignalIntel) {
  const sc = scoreIntel(intel);
  s.intel = intel;
  s.score = Math.round(clamp(s.score + intel.adj, 0, 100));
  for (const t of sc.tags) if (!s.tags.includes(t)) s.tags.push(t);
  for (const r of sc.risks) if (!s.risks.includes(r)) s.risks.push(r);
  s.tags = s.tags.slice(0, 6);
  s.risks = s.risks.slice(0, 4);
}

/** Which of these tokens are already public calls (nothing left to decide for them, so no reason to keep re-vetting). */
async function alreadyCalled(mints: string[]): Promise<Set<string>> {
  if (!mints.length) return new Set();
  try {
    const docs = await (await getDb()).collection<{ address: string }>("signal_calls")
      .find({ address: { $in: mints }, shadow: { $ne: true } }, { projection: { _id: 0, address: 1 } }).toArray();
    return new Set(docs.map((d) => d.address));
  } catch { return new Set(); }
}

/** Pure: which lookup class a candidate falls in, or null when it needs no lookup now. Exported for tests. Lower = more important. */
export function lookupClass(o: { base: number; hotMin: number; age: number; adj?: number; blocked?: boolean; called?: boolean }): 0 | 1 | 2 | 3 | 4 | null {
  const { base, hotMin, age } = o;
  if (age < FRESH_MS) return null;
  const vetted = age < VALID_MS;
  if (!vetted) {
    if (base >= hotMin - 8) return 0; // could be a call as soon as it is vetted: first in line
    if (base >= hotMin - 16) return 3; // within reach if proven wallets and the model both push it up
    return 4; // far from a call: only looked up to learn from how it ends (hidden "shadow" record)
  }
  if (o.called || o.blocked || age < RECHECK_MS) return null; // nothing to decide, or looked at recently enough
  if (base + (o.adj ?? 0) >= hotMin) return 1; // about to be called on vetting that is over 10 minutes old: look again first
  if (base >= hotMin - 8) return 2; // a few points short: fresh proven-wallet buys can tip it
  return null;
}
// how much of the allowance released so far each class may use up, and how many lookups of that class one scan may start
const CLASS_SHARE = [1, 1, 0.85, 0.8, 0.55];
const CLASS_MAX = [12, 6, 6, 6, 5];

/**
 * Adds dev / flow / proven-wallet intel to the best Solana candidates (mutates). Lookups cost Helius calls, so:
 *   - a lookup is shared by every instance and reused for up to 30 minutes,
 *   - the day's allowance is released evenly and spent on the tokens that can actually become a call first,
 *   - a small worker pool and a time budget keep one scan fast (unfinished tokens are picked up by the next one).
 */
export async function enrichSignals(signals: Enrichable[], opts: { max?: number; minScore?: number; hotMin?: number; concurrency?: number; budgetMs?: number } = {}): Promise<void> {
  const { max = 12, minScore = 45, hotMin = 72, concurrency = 3, budgetMs = 5_000 } = opts;
  const cands = signals
    .filter((s) => (!s.token.chain || s.token.chain === "solana") && SOLANA_MINT_RE.test(s.token.address) && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  if (!cands.length) return;
  await hydrateIntel(cands.map((s) => s.token.address));

  const now = Date.now();
  const cachedOf = (s: Enrichable) => { const c = intelCache.get(s.token.address); return c && now - c.ts < VALID_MS ? c : undefined; };
  // only tokens near the line can be "already called"; ask the database about those alone
  const near = cands.filter((s) => { const c = cachedOf(s); return !!c && now - c.ts >= RECHECK_MS && s.score >= hotMin - 8; });
  const called = await alreadyCalled(near.map((s) => s.token.address));

  const queues: Enrichable[][] = [[], [], [], [], []];
  for (const s of cands) {
    const c = cachedOf(s);
    const k = lookupClass({ base: s.score, hotMin, age: c ? now - c.ts : Infinity, adj: c?.intel.adj, blocked: !!c?.intel.block, called: called.has(s.token.address) });
    if (k !== null && queues[k].length < CLASS_MAX[k]) queues[k].push(s);
  }
  const grants = await takeIntelBudget(queues.map((q, k) => ({ want: q.length * CALLS_PER_LOOKUP, share: CLASS_SHARE[k] })));
  const todo = queues.flatMap((q, k) => q.slice(0, Math.floor(grants[k] / CALLS_PER_LOOKUP)));

  const fetched = new Map<string, SignalIntel>();
  if (todo.length) {
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const s = todo[i++];
        try {
          const intel = await buildIntel(s.token.address);
          rememberIntel(s.token.address, intel);
          fetched.set(s.token.address, intel);
        } catch (e) { console.warn("[signalIntel]", s.token.address.slice(0, 6), e instanceof Error ? e.message : e); }
      }
    };
    await Promise.race([Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)), sleep(budgetMs)]);
  }
  // apply once per token: the fresh lookup if it came back in time, otherwise the vetting we already had
  for (const s of cands) {
    const intel = fetched.get(s.token.address) ?? cachedOf(s)?.intel;
    if (intel) apply(s, intel);
  }
  if (intelCache.size > 500) for (const [k, v] of intelCache) if (Date.now() - v.ts > VALID_MS) intelCache.delete(k);
}

// ── feature snapshot (stored with every call so we can measure what actually predicts wins) ─────────────────────────
export function featuresOf(t: MarketToken, meta: ScanMeta, intel: SignalIntel | undefined, now = Date.now()): Record<string, number | null> {
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  const tx = t.txns.buys + t.txns.sells;
  const buyShare = meta.buyVol1h !== undefined && meta.sellVol1h !== undefined && meta.buyVol1h + meta.sellVol1h > 0
    ? meta.buyVol1h / (meta.buyVol1h + meta.sellVol1h)
    : tx >= 20 ? t.txns.buys / tx : null;
  return {
    h1: n(t.change.h1), m5: n(t.change.m5), h6: n(t.change.h6), h24: n(t.change.h24),
    volRatio: n(t.mcap > 0 ? t.volume.h1 / t.mcap : null), buyShare: n(buyShare),
    liq: n(t.liquidity), liqRatio: n(t.mcap > 0 ? t.liquidity / t.mcap : null), mcap: n(t.mcap),
    ageMin: n(t.createdAt ? (now - t.createdAt) / 60_000 : null), curve: n(t.curveProgress), grad: t.graduated ? 1 : 0,
    holders: n(meta.holders), organic: n(meta.organicScore), topHolders: n(meta.topHoldersPct), devPct: n(meta.devPct), traders1h: n(meta.traders1h),
    flowBuyers: n(intel?.flow?.buyers), flowAccel: n(intel?.flow?.accel), top3Share: n(intel?.flow?.top3Share), bundled: n(intel?.flow?.bundled), netSol: n(intel?.flow?.netSol),
    devCreated: n(intel?.dev?.created), devGraduated: n(intel?.dev?.graduated), devDead: n(intel?.dev?.dead), devRecent7d: n(intel?.dev?.recent7d),
    smart: n(intel?.smart?.smart), dumpers: n(intel?.smart?.dumpers), intelAdj: n(intel?.adj),
  };
}
