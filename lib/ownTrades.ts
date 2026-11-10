// Our own trade history, written by scripts/ingest-worker.ts into the `trades` collection.
// Charts read it first (free, instant) and only fall back to paid / rate-limited APIs when it has too little.
import { getDb } from "@/lib/mongoClient";
import { swapsToCandles, type Swap } from "@/lib/heliusSwaps";

const WATCH_COLLECTION = "watch";
const watchedAt = new Map<string, number>();

/**
 * Tell the ingest worker that someone is looking at this mint, so it starts recording its trades.
 * Throttled to one write per mint a minute; never throws and never slows the request down.
 */
export function noteWatch(mint: string): void {
  const now = Date.now();
  if (now - (watchedAt.get(mint) ?? 0) < 60_000) return;
  watchedAt.set(mint, now);
  if (watchedAt.size > 2000) for (const [k, v] of watchedAt) if (now - v > 600_000) watchedAt.delete(k);
  void (async () => {
    try {
      const db = await getDb();
      await db.collection(WATCH_COLLECTION).updateOne({ _id: mint as never }, { $set: { seenAt: now, at: new Date(now) } }, { upsert: true });
    } catch { /* optional */ }
  })();
}

/** Candles built from the trades the worker recorded. Empty when the worker has not seen this token yet. */
export async function candlesFromOwnTrades(mint: string, sec: number, limit = 300): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[] | null> {
  try {
    const db = await Promise.race([getDb(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("db timeout")), 1500))]);
    const since = Date.now() - sec * 1000 * limit;
    const docs = await db
      .collection("trades")
      .find({ mint, timestamp: { $gte: since } }, { projection: { _id: 0, signature: 1, timestamp: 1, isBuy: 1, solAmount: 1, tokenAmount: 1, price: 1 } })
      .sort({ timestamp: -1 })
      .limit(5000)
      .toArray();
    if (!docs.length) return null;
    const swaps: Swap[] = docs.map((d) => ({
      sig: String(d.signature),
      ts: Number(d.timestamp),
      side: d.isBuy ? "buy" : "sell",
      tokens: Number(d.tokenAmount),
      sol: Number(d.solAmount),
      priceSol: Number(d.price),
      wallet: "",
    }));
    const rows = await swapsToCandles(swaps, sec);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}
