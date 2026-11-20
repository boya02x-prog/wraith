// lib/autoLab.ts  (server only)
// THE AUTO-TRADER LAB: a paper (simulated) auto-trader that "buys" every public Wraith call the moment it sees it and sells by the rules of three trading
// styles, with realistic costs, using live prices. No real money and no wallet are involved. It exists to answer one question with real numbers
// BEFORE anyone's money is put on it: after fees, does trading Wraith's calls automatically earn anything, and which style?
// Replayed on 454 past calls (scripts/research-autotrade.ts) the answer was: about break-even before luck, a lottery with fees (win rate 16-25%).
// The lab keeps measuring on live calls so that answer is based on what actually happens from now on.
//
// How it works (called once per alert run, about every 2 minutes, right after the calls are re-priced):
//   1. every public call spotted in the last 20 minutes that has no trade yet is "bought" at its current price, once per style
//   2. every open trade is checked against its style's rules (stop, trailing stop, take-profit, maximum hold time) using the latest price
// Limits, stated: the price is sampled about every 2 minutes (a real bot would watch more closely); a stop that was touched and recovered between two
// samples is not seen; a take-profit is filled at its level (like a resting order).
import { getDb } from "@/lib/mongoClient";
import type { SignalCall } from "@/lib/signalCalls";

export type LabStyle = "scalp" | "day" | "long";
export interface LabRules { label: string; blurb: string; tp: number; sl: number; trail: number; trailAfter: number; holdMin: number }

export const LAB_STYLES: Record<LabStyle, LabRules> = {
  scalp: { label: "Scalp", blurb: "quick in and out: sell at +30%, stop at -10%, trailing stop 10%, at most 2 hours", tp: 30, sl: 10, trail: 10, trailAfter: 10, holdMin: 120 },
  day: { label: "Day trade", blurb: "give it room: sell at +100%, stop at -25%, trailing stop 25% once +50%, at most 24 hours", tp: 100, sl: 25, trail: 25, trailAfter: 50, holdMin: 1440 },
  long: { label: "Long", blurb: "let winners run: no target, stop at -35%, trailing stop 35% once +100%, at most 3 days", tp: 0, sl: 35, trail: 35, trailAfter: 100, holdMin: 4320 },
};
const STYLES = Object.keys(LAB_STYLES) as LabStyle[];

/** costs as fractions of the amount, the same as the replay research: getting in, getting out, getting out through a stop (thin tokens slip when everyone sells) */
const COSTS = { entry: 0.015, exit: 0.03, stop: 0.06 };
/** virtual dollars put on every trade */
export const LAB_SIZE_USD = 10;
const COLLECTION = "lab_trades";

interface LabTrade {
  _id: string; // `${address}:${style}`
  address: string; symbol: string; style: LabStyle; openedAt: number; entryMcap: number; peak: number; status: "open" | "closed"; score?: number;
  exitAt?: number; exitMcap?: number; reason?: "tp" | "stop" | "trail" | "time" | "rug"; net?: number;
}
type CallRow = Pick<SignalCall, "address" | "symbol" | "spottedAt" | "spottedMcap" | "lastMcap" | "lastCheck" | "peakMcap" | "rugged"> & { peakAt?: number };


/** The rules, with no database: should this open trade close now, and at what price? Stops win ties (the cautious choice). Exported so it can be tested. */
export function evaluateTrade(o: Pick<LabTrade, "style" | "openedAt" | "entryMcap" | "peak">, c: Pick<CallRow, "lastMcap" | "lastCheck" | "peakMcap" | "rugged"> & { peakAt?: number }, now: number): { reason: NonNullable<LabTrade["reason"]> | null; exit: number; peak: number } {
  const r = LAB_STYLES[o.style];
  const price = c.lastMcap;
  if (c.rugged) return { reason: "rug", exit: o.entryMcap * 0.05, peak: o.peak }; // the price source stopped returning the token: treated as a total loss
  if (!(price > 0) || c.lastCheck <= now - 6 * 3_600_000) return { reason: null, exit: price, peak: o.peak };
  // the highest price seen since the trade opened: the call's own peak counts only if it happened after we bought
  const hi = c.peakAt && c.peakAt >= o.openedAt ? Math.max(c.peakMcap, price) : price;
  const peak = Math.max(o.peak, hi, price);
  const rise = price / o.entryMcap, peakRise = peak / o.entryMcap;
  // 1) the fixed stop first (cautious: if the price is at or below it, a target seen in the same two-minute window is not counted)
  if (r.sl > 0 && rise <= 1 - r.sl / 100) return { reason: "stop", exit: price, peak };
  // 2) the target: a price that went up THROUGH the target sold there on the way up, before any trailing stop below the peak could matter
  if (r.tp > 0 && peakRise >= 1 + r.tp / 100) return { reason: "tp", exit: o.entryMcap * (1 + r.tp / 100), peak };
  // 3) the trailing stop, once the trade is far enough in profit
  if (r.trail > 0 && peakRise >= 1 + r.trailAfter / 100 && rise <= peakRise * (1 - r.trail / 100)) return { reason: "trail", exit: price, peak };
  // 4) out of time
  if (now - o.openedAt >= r.holdMin * 60_000) return { reason: "time", exit: price, peak };
  return { reason: null, exit: price, peak };
}

/** Net result of a trade as a fraction, after costs. Exported so it can be tested. */
export const netOf = (entry: number, exit: number, viaStop: boolean) => (exit / entry) * (1 - (viaStop ? COSTS.stop : COSTS.exit)) / (1 + COSTS.entry) - 1;

let indexed = false;
async function col() {
  const c = (await getDb()).collection<LabTrade>(COLLECTION);
  if (!indexed) {
    indexed = true;
    await c.createIndex({ status: 1 }).catch(() => undefined);
    await c.createIndex({ openedAt: -1 }).catch(() => undefined);
  }
  return c;
}

/** One pass: open trades for fresh calls, then check every open trade. Never throws into the caller's job. */
export async function labStep(now = Date.now()): Promise<{ opened: number; closed: number }> {
  const db = await getDb();
  const lab = await col();
  const calls = db.collection<CallRow>("signal_calls");
  let opened = 0, closed = 0;

  // 1) "buy" every fresh public call, once per style, at the price the bot sees when it notices the call
  const fresh = await calls.find({ engine: 2, shadow: { $ne: true }, badData: { $ne: true }, spottedAt: { $gt: now - 20 * 60_000 }, spottedMcap: { $gt: 0 } } as never,
    { projection: { address: 1, symbol: 1, spottedAt: 1, spottedMcap: 1, lastMcap: 1, lastCheck: 1, score: 1 } }).toArray();
  const ops = [];
  for (const c of fresh) {
    const entry = c.lastMcap > 0 && c.lastCheck > now - 5 * 60_000 ? c.lastMcap : c.spottedMcap;
    for (const style of STYLES) ops.push({ updateOne: { filter: { _id: `${c.address}:${style}` }, update: { $setOnInsert: { address: c.address, symbol: c.symbol, style, openedAt: now, entryMcap: entry, peak: entry, status: "open", score: (c as unknown as { score?: number }).score ?? 0 } }, upsert: true } });
  }
  if (ops.length) { const r = await lab.bulkWrite(ops as never, { ordered: false }); opened = r.upsertedCount; }

  // 2) check every open trade against its style's rules
  const open = await lab.find({ status: "open" }).limit(800).toArray();
  if (!open.length) return { opened, closed };
  const rows = await calls.find({ address: { $in: [...new Set(open.map((o) => o.address))] } }, { projection: { address: 1, lastMcap: 1, lastCheck: 1, peakMcap: 1, peakAt: 1, rugged: 1 } }).toArray();
  const byAddr = new Map(rows.map((r) => [r.address, r]));
  const writes = [];
  for (const o of open) {
    const c = byAddr.get(o.address);
    if (!c) continue;
    const d = evaluateTrade(o, c, now);
    if (d.reason) {
      writes.push({ updateOne: { filter: { _id: o._id }, update: { $set: { status: "closed", exitAt: now, exitMcap: d.exit, reason: d.reason, net: netOf(o.entryMcap, d.exit, d.reason === "stop" || d.reason === "trail" || d.reason === "rug") } } } });
      closed++;
    } else if (d.peak > o.peak) writes.push({ updateOne: { filter: { _id: o._id }, update: { $set: { peak: d.peak } } } });
  }
  if (writes.length) await lab.bulkWrite(writes as never, { ordered: false });
  return { opened, closed };
}

export interface LabStyleReport {
  style: LabStyle; label: string; blurb: string; open: number; closed: number; wins: number;
  /** average result per closed trade, as a fraction (0.05 = +5%), with the 95% range of that average */
  avg: number | null; low: number | null; high: number | null; middle: number | null;
  /** profit or loss in virtual dollars at LAB_SIZE_USD per trade */
  totalUsd: number; best: number | null; worst: number | null;
  /** the same numbers for only the best calls (score 75 and up): does picking the best of the best help? */
  top: { closed: number; avg: number | null; low: number | null; high: number | null };
}
export interface LabReport { styles: LabStyleReport[]; sizeUsd: number; since: number | null; recent: { symbol: string; style: LabStyle; net: number; reason: string; at: number }[] }

export async function labReport(): Promise<LabReport> {
  const lab = await col();
  const all = await lab.find({}).sort({ openedAt: -1 }).limit(5000).toArray();
  const styles: LabStyleReport[] = STYLES.map((style) => {
    const mine = all.filter((t) => t.style === style);
    const done = mine.filter((t) => t.status === "closed" && typeof t.net === "number").map((t) => t.net as number).sort((a, b) => a - b);
    const topDone = mine.filter((t) => t.status === "closed" && typeof t.net === "number" && (t.score ?? 0) >= 75).map((t) => t.net as number);
    const topAvg = topDone.length ? topDone.reduce((a, v) => a + v, 0) / topDone.length : null;
    const topSe = topDone.length > 1 && topAvg !== null ? (1.96 * Math.sqrt(topDone.reduce((a, v) => a + (v - topAvg) ** 2, 0) / (topDone.length - 1))) / Math.sqrt(topDone.length) : null;
    const n = done.length;
    const avg = n ? done.reduce((a, v) => a + v, 0) / n : null;
    const sd = n > 1 && avg !== null ? Math.sqrt(done.reduce((a, v) => a + (v - avg) ** 2, 0) / (n - 1)) : null;
    const se = sd !== null ? (1.96 * sd) / Math.sqrt(n) : null;
    return {
      style, label: LAB_STYLES[style].label, blurb: LAB_STYLES[style].blurb, open: mine.filter((t) => t.status === "open").length, closed: n, wins: done.filter((v) => v > 0).length,
      avg, low: avg !== null && se !== null ? avg - se : null, high: avg !== null && se !== null ? avg + se : null, middle: n ? done[Math.floor(n / 2)] : null,
      totalUsd: done.reduce((a, v) => a + v * LAB_SIZE_USD, 0), best: n ? done[n - 1] : null, worst: n ? done[0] : null,
      top: { closed: topDone.length, avg: topAvg, low: topAvg !== null && topSe !== null ? topAvg - topSe : null, high: topAvg !== null && topSe !== null ? topAvg + topSe : null },
    };
  });
  const first = all.length ? all[all.length - 1].openedAt : null;
  const recent = all.filter((t) => t.status === "closed" && typeof t.net === "number").sort((a, b) => (b.exitAt ?? 0) - (a.exitAt ?? 0)).slice(0, 14)
    .map((t) => ({ symbol: t.symbol, style: t.style, net: t.net as number, reason: t.reason ?? "", at: t.exitAt ?? 0 }));
  return { styles, sizeUsd: LAB_SIZE_USD, since: first, recent };
}
