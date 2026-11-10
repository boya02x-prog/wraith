// lib/walletIntel.ts  (server only)
// "Wallet intel": who is behind this token and who is buying it, judged only on evidence we can point at.
//   1. Deployer history   what the creator wallet launched before and how those launches ended (pump.fun)
//   2. Familiar wallets   early buyers that Wraith has already seen in earlier calls, and how those calls ended
// Nothing here accuses anyone: every line states a count or an outcome, never a motive. Fails soft per source.

import { getDb } from "@/lib/mongoClient";
import { fetchTokenSwaps } from "@/lib/heliusSwaps";
import { SOLANA_MINT_RE } from "@/lib/market";
import { computeFlow, isDumper, isSmart, parseDevCoins, pumpJson } from "@/lib/signalIntel";
import { outcomeOf, type Outcome } from "@/lib/walletLearn";
import type { SignalCall } from "@/lib/signalCalls";

export type Tone = "good" | "warn" | "bad" | "info";
export interface DevCoin { mint: string; symbol: string; status: "graduated" | "dead" | "live"; mcap: number; ageH: number }
export interface WalletIntel {
  mint: string;
  dev: null | { creator: string; created: number; graduated: number; dead: number; recent7d: number; coins: DevCoin[]; bought: boolean };
  buyers: number;
  bundled: number;
  proven: number;
  dumpers: number;
  familiar: { wallet: string; n: number; wins: number; dumps: number }[];
  links: { address: string; symbol: string; outcome: Outcome; shared: number; peak: number }[];
  signals: { tone: Tone; text: string }[];
  at: number;
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

const TTL = 3 * 60_000;
const cache = new Map<string, { ts: number; v: WalletIntel }>();
const inflight = new Map<string, Promise<WalletIntel>>();
const listCache = new Map<string, { ts: number; list: unknown }>();
let indexed = false;

async function creatorCoins(creator: string): Promise<unknown> {
  const hit = listCache.get(creator);
  if (hit && Date.now() - hit.ts < 30 * 60_000) return hit.list;
  const list = await pumpJson(`/coins/user-created-coins/${creator}?offset=0&limit=50&includeNsfw=true`);
  if (list) { listCache.set(creator, { ts: Date.now(), list }); if (listCache.size > 300) listCache.clear(); }
  return list;
}

function devCoinRows(list: unknown, mint: string, now: number): DevCoin[] {
  const rows = Array.isArray(list) ? list : Array.isArray(o(list).coins) ? (o(list).coins as unknown[]) : [];
  const out: DevCoin[] = [];
  for (const raw of rows) {
    const r = o(raw);
    if (r.mint === mint || typeof r.mint !== "string") continue;
    const ts = Number(r.created_timestamp);
    const ageMs = Number.isFinite(ts) && ts > 0 ? now - (ts < 1e12 ? ts * 1000 : ts) : NaN;
    const mcap = Number(r.usd_market_cap);
    const m = Number.isFinite(mcap) ? mcap : 0;
    const status: DevCoin["status"] = r.complete === true ? "graduated" : m < 5_000 && Number.isFinite(ageMs) && ageMs > 2 * 3_600_000 ? "dead" : "live";
    out.push({ mint: r.mint, symbol: String(r.symbol ?? "?").slice(0, 12), status, mcap: m, ageH: Number.isFinite(ageMs) ? Math.round(ageMs / 3_600_000) : 0 });
  }
  return out.slice(0, 6);
}

async function build(mint: string): Promise<WalletIntel> {
  const now = Date.now();
  const [coinRaw, swaps] = await Promise.all([
    mint.endsWith("pump") ? pumpJson(`/coins/${mint}`) : Promise.resolve(null),
    fetchTokenSwaps(mint, 2).catch(() => null),
  ]);

  // buyers, oldest first
  const sorted = [...(swaps ?? [])].sort((a, b) => a.ts - b.ts);
  const buyers: string[] = [];
  const seen = new Set<string>();
  for (const s of sorted) if (s.side === "buy" && s.wallet && !seen.has(s.wallet)) { seen.add(s.wallet); buyers.push(s.wallet); }
  const flow = swaps ? computeFlow(swaps, now)?.flow : null;

  // 1. deployer
  let dev: WalletIntel["dev"] = null;
  const creator = typeof o(coinRaw).creator === "string" ? (o(coinRaw).creator as string) : "";
  if (SOLANA_MINT_RE.test(creator)) {
    const list = await creatorCoins(creator);
    if (list) {
      const st = parseDevCoins(list, mint, now);
      dev = { creator, ...st, coins: devCoinRows(list, mint, now), bought: seen.has(creator) };
    }
  }

  // 2. familiar wallets (Mongo only)
  let proven = 0, dumpers = 0;
  let familiar: WalletIntel["familiar"] = [];
  let links: WalletIntel["links"] = [];
  const pool = buyers.slice(0, 150);
  if (pool.length) {
    try {
      const db = await getDb();
      const calls = db.collection<SignalCall & { buyers?: string[] }>("signal_calls");
      if (!indexed) { indexed = true; await calls.createIndex({ buyers: 1 }).catch(() => undefined); }
      const [stats, hits] = await Promise.all([
        db.collection<{ _id: string; n?: number; wins?: number; dumps?: number }>("wallet_stats")
          .find({ _id: { $in: pool } }, { projection: { n: 1, wins: 1, dumps: 1 } }).toArray(),
        calls.find({ address: { $ne: mint }, shadow: { $ne: true }, buyers: { $in: pool } },
          { projection: { address: 1, symbol: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, buyers: 1 } })
          .sort({ spottedAt: -1 }).limit(80).toArray(),
      ]);
      proven = stats.filter(isSmart).length;
      dumpers = stats.filter(isDumper).length;
      familiar = stats
        .filter((s) => (s.n ?? 0) >= 2)
        .sort((a, b) => ((b.wins ?? 0) - (b.dumps ?? 0)) - ((a.wins ?? 0) - (a.dumps ?? 0)) || (b.n ?? 0) - (a.n ?? 0))
        .slice(0, 5)
        .map((s) => ({ wallet: String(s._id), n: s.n ?? 0, wins: s.wins ?? 0, dumps: s.dumps ?? 0 }));
      const mine = new Set(pool);
      for (const c of hits) {
        const shared = (c.buyers ?? []).filter((w) => mine.has(w)).length;
        if (shared < 2) continue;
        const out = outcomeOf(c);
        const mature = now - c.spottedAt > 2 * 3_600_000;
        if (out === "flat" || (out === "dump" && !mature)) continue;
        links.push({ address: c.address, symbol: c.symbol, outcome: out, shared, peak: c.spottedMcap > 0 ? Math.max(c.peakMcap, c.lastMcap) / c.spottedMcap : 0 });
      }
      links = links.sort((a, b) => b.shared - a.shared).slice(0, 5);
    } catch (e) { console.warn("[walletIntel]", e instanceof Error ? e.message : e); }
  }

  // evidence lines
  const sig: WalletIntel["signals"] = [];
  if (dev) {
    if (dev.created === 0) sig.push({ tone: "info", text: "First token from this deployer wallet." });
    else {
      if (dev.graduated > 0) sig.push({ tone: "good", text: `${dev.graduated} of ${dev.created} earlier launches graduated.` });
      if (dev.created >= 3 && dev.dead / dev.created >= 0.7) sig.push({ tone: "bad", text: `${dev.dead} of ${dev.created} earlier launches faded under $5K.` });
      else if (dev.dead >= 2) sig.push({ tone: "warn", text: `${dev.dead} earlier launches faded under $5K.` });
      if (dev.recent7d >= 5) sig.push({ tone: "warn", text: `${dev.recent7d} launches from this wallet in the last 7 days.` });
    }
    if (dev.bought) sig.push({ tone: "warn", text: "The deployer wallet also bought this token." });
  }
  if (proven > 0) sig.push({ tone: "good", text: `${proven} early buyer${proven > 1 ? "s" : ""} appeared in earlier winners.` });
  if (dumpers >= 2) sig.push({ tone: "warn", text: `${dumpers} early buyers appeared in earlier dumps repeatedly.` });
  for (const l of links.slice(0, 3)) {
    if (l.outcome === "win") sig.push({ tone: "good", text: `${l.shared} early buyers also bought ${l.symbol}, which reached ${l.peak.toFixed(1)}x.` });
    else if (l.shared >= 3) sig.push({ tone: "warn", text: `${l.shared} early buyers also bought ${l.symbol}, which ended down.` });
  }
  if (flow && flow.bundled >= 4) sig.push({ tone: "warn", text: `${flow.bundled} wallets bought within seconds of the first trade.` });
  if (!buyers.length) sig.push({ tone: "info", text: "Not enough trades yet to compare buyer wallets." });

  return { mint, dev, buyers: buyers.length, bundled: flow?.bundled ?? 0, proven, dumpers, familiar, links, signals: sig.slice(0, 7), at: now };
}

export async function walletIntel(mint: string): Promise<WalletIntel> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL) return hit.v;
  const pending = inflight.get(mint);
  if (pending) return pending;
  const p = build(mint).then((v) => { cache.set(mint, { ts: Date.now(), v }); if (cache.size > 300) cache.clear(); return v; }).finally(() => inflight.delete(mint));
  inflight.set(mint, p);
  return p;
}
