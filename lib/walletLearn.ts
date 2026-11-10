// lib/walletLearn.ts  (server only)
// Builds Wraith's wallet scoreboard. Every tracked call stores the wallets that were buying when it was spotted.
// Once a call is old enough to have an outcome, each of those wallets is credited (win) or debited (dump):
//   wallet_stats { _id: wallet, n: calls it was early in, wins: how many of those reached 2x, dumps: how many lost half }
// Wallets that keep showing up in winners become "proven"; wallets that keep showing up in dumps become "repeat dumpers"
// (insiders / snipers). lib/signalIntel.ts reads this at signal time. No network calls: pure Mongo.

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import type { SignalCall } from "@/lib/signalCalls";

const MATURE_MS = 4 * 3_600_000; // a pump.fun token has mostly played out after 4h
const MAX_AGE_MS = 7 * 86_400_000;

export type Outcome = "win" | "dump" | "flat";
/** Pure. win = peaked at 2x+ from spot; dump = ended at half or less without a 2x; everything else is flat. */
export function outcomeOf(c: Pick<SignalCall, "spottedMcap" | "peakMcap" | "lastMcap">): Outcome {
  if (!(c.spottedMcap > 0)) return "flat";
  const peak = Math.max(c.peakMcap, c.lastMcap) / c.spottedMcap;
  if (peak >= 2) return "win";
  if (c.lastMcap / c.spottedMcap <= 0.5) return "dump";
  return "flat";
}

let lastRun = 0;
let running = false;
let lastPrune = 0;

/** Keeps the scoreboard collections bounded: shadow calls are only useful until they have been learned from, and a wallet seen once a month ago says nothing. */
async function prune(db: Db): Promise<void> {
  if (Date.now() - lastPrune < 6 * 3_600_000) return;
  lastPrune = Date.now();
  const now = Date.now();
  await db.collection("signal_calls").deleteMany({ shadow: true, spottedAt: { $lt: now - 14 * 86_400_000 } });
  await db.collection("wallet_stats").deleteMany({ n: { $lte: 1 }, lastSeen: { $lt: now - 30 * 86_400_000 } });
}

export async function learnMatured(limit = 25): Promise<{ calls: number; wallets: number } | null> {
  if (running || Date.now() - lastRun < 5 * 60_000) return null;
  running = true;
  lastRun = Date.now();
  try {
    const db = await getDb();
    void prune(db).catch(() => undefined);
    const calls = db.collection<SignalCall & { learned?: boolean; buyers?: string[] }>("signal_calls");
    const now = Date.now();
    const due = await calls
      .find({ learned: { $ne: true }, buyers: { $exists: true, $ne: [] }, spottedAt: { $lt: now - MATURE_MS, $gt: now - MAX_AGE_MS } }, { projection: { address: 1, buyers: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } })
      .sort({ spottedAt: 1 })
      .limit(limit)
      .toArray();
    if (!due.length) return { calls: 0, wallets: 0 };

    const agg = new Map<string, { n: number; wins: number; dumps: number }>();
    for (const c of due) {
      const out = outcomeOf(c);
      for (const w of new Set(c.buyers ?? [])) {
        const a = agg.get(w) ?? { n: 0, wins: 0, dumps: 0 };
        a.n++;
        if (out === "win") a.wins++;
        else if (out === "dump") a.dumps++;
        agg.set(w, a);
      }
    }
    const ops = [...agg.entries()].map(([w, a]) => ({
      updateOne: {
        filter: { _id: w as never },
        update: { $inc: { n: a.n, wins: a.wins, dumps: a.dumps }, $set: { lastSeen: now }, $setOnInsert: { firstSeen: now } },
        upsert: true,
      },
    }));
    if (ops.length) await db.collection("wallet_stats").bulkWrite(ops, { ordered: false });
    await calls.updateMany({ address: { $in: due.map((d) => d.address) } }, { $set: { learned: true } });
    return { calls: due.length, wallets: agg.size };
  } catch (e) {
    console.warn("[walletLearn]", e instanceof Error ? e.message : e);
    return null;
  } finally {
    running = false;
  }
}
