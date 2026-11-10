// ─── WALLET REPUTATION (persistent, cross-scan learning) ───────────────────
// getSmartMoneyIntel() in lib/getWalletStats.ts only knows about ONE token's
// PnL for a wallet, in ONE scan. This file is what actually "learns" —
// every time a wallet shows up as a confirmed-winning top holder, it gets
// recorded here, so a wallet that keeps showing up profitable across many
// different tokens over weeks builds up a track record that's worth more
// than a single lucky call. That accumulated record is what should carry
// real weight in scoring, not any single scan's snapshot.
//
// Collection: wallet_reputation
//   _id: wallet address
//   timesSeenAsTopHolder: number
//   timesConfirmedWinning: number   (winRatePct >= 55 with >=2 trades, this scan)
//   netWorthUsdLastSeen: number | null
//   firstSeenAt: Date
//   lastSeenAt: Date
//
// Index is added in lib/mongoClient.ts's ensureIndexes().

import { getDb } from "@/lib/mongoClient";
import type { SmartWallet } from "@/lib/getWalletStats";

interface WalletReputationDoc {
  _id: string;
  timesSeenAsTopHolder: number;
  timesConfirmedWinning: number;
  netWorthUsdLastSeen: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Fire-and-forget — call this after a scan resolves smart-money intel for a
 * token, but don't await it on the response path. A failed write here
 * should never slow down or break a scan.
 */
export async function recordWalletObservations(
  wallets: SmartWallet[],
): Promise<void> {
  if (!wallets.length) return;
  try {
    const db = await getDb();
    const col = db.collection<WalletReputationDoc>("wallet_reputation");
    const now = new Date();

    const ops = wallets.map((w) => {
      const confirmedWinning =
        w.winRatePct !== undefined &&
        (w.tradeCount ?? 0) >= 2 &&
        w.winRatePct >= 55;
      return {
        updateOne: {
          filter: { _id: w.address },
          update: {
            $inc: {
              timesSeenAsTopHolder: 1,
              ...(confirmedWinning ? { timesConfirmedWinning: 1 } : {}),
            },
            $set: {
              netWorthUsdLastSeen: w.netWorthUsd ?? null,
              lastSeenAt: now,
            },
            $setOnInsert: { firstSeenAt: now },
          },
          upsert: true,
        },
      };
    });

    await col.bulkWrite(ops, { ordered: false });
  } catch (err) {
    console.error("[walletReputation] failed to record observations:", err);
  }
}

/**
 * Looks up accumulated track record for a set of wallet addresses. Returns
 * a 0-100 reputation boost per wallet based on how consistently it's shown
 * up as a confirmed winner across past scans — not just this one.
 */
export async function getWalletReputationBoost(
  addresses: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!addresses.length) return out;
  try {
    const db = await getDb();
    const col = db.collection<WalletReputationDoc>("wallet_reputation");
    const docs = await col.find({ _id: { $in: addresses } }).toArray();
    for (const d of docs) {
      // Require a real sample size before trusting the ratio — 2 seen /
      // 2 winning shouldn't score the same as 40 seen / 30 winning.
      if (d.timesSeenAsTopHolder < 3) continue;
      const ratio = d.timesConfirmedWinning / d.timesSeenAsTopHolder;
      const sampleConfidence = Math.min(1, d.timesSeenAsTopHolder / 10);
      out.set(d._id, Math.round(ratio * sampleConfidence * 100));
    }
  } catch (err) {
    console.error("[walletReputation] failed to read reputation:", err);
  }
  return out;
}
