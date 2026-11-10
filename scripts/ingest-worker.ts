/**
 * ingest-worker.ts (Phase 2, corrected + dynamic watchlist)
 *
 * Run with: npx tsx scripts/ingest-worker.ts
 *
 * WHY THIS VERSION IS DIFFERENT: the previous version guessed byte offsets
 * by hand and got them wrong — the discriminator we captured live
 * (3e2f370aa503dc2a) doesn't match pump.fun's documented TradeEvent
 * discriminator (bddb7fd34ee661ee), meaning we were misreading a
 * different event's bytes as if they were a trade. Hand-rolled offsets
 * are fragile and pump.fun has changed this layout multiple times
 * (they added creator/fee fields, virtual_quote_reserves, etc).
 *
 * FIX: use pump.fun's own officially maintained Anchor IDL
 * (github.com/pump-fun/pump-public-docs) with Anchor's BorshCoder +
 * EventParser. This decodes correctly regardless of exact field layout,
 * and stays correct automatically if you update the idl file later.
 *
 * SETUP REQUIRED (one-time):
 *   npm install @coral-xyz/anchor
 *   Then download the real IDL:
 *     curl -o scripts/pump-idl.json https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json
 *   (or open that URL in a browser and save the JSON to scripts/pump-idl.json)
 *
 * WHAT CHANGED IN THIS VERSION (dynamic watchlist):
 *   - WATCHED_MINTS hardcoded array removed.
 *   - loadWatchedMints() now pulls active mints from the `tokenHistory`
 *     Mongo collection (populated by the scanner), filtered to tokens
 *     seen/checked within the last ACTIVE_WINDOW_MS.
 *   - refreshSubscriptions() runs on startup and then every
 *     REFRESH_INTERVAL_MS, diffing against the currently subscribed set:
 *     new mints get subscribed, stale mints get unsubscribed.
 */

import { Connection, PublicKey, Logs, Context } from "@solana/web3.js";
import { config } from "dotenv";
import mongoose from "mongoose";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

// IMPORTANT: dotenv must run BEFORE lib/mongoClient.ts is ever evaluated —
// that module reads process.env.MONGODB_URI at module-load time and throws
// if it's unset. Static `import { getDb } from "../lib/mongoClient"` at the
// top of this file gets hoisted above this config() call (ES import
// hoisting), so mongoClient.ts would load with an empty env. Loading it via
// dynamic import() after config() runs avoids that entirely.
config({ path: ".env.local" });

let getDb: () => Promise<import("mongodb").Db>;

// ─── CONFIG ──────────────────────────────────────────────────────────────
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC;
const MONGODB_URI = process.env.MONGODB_URI;

if (!RPC_URL) {
  console.error("[ingest-worker] Missing SOLANA_RPC_URL in .env.local");
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error("[ingest-worker] Missing MONGODB_URI in .env.local");
  process.exit(1);
}

const IDL_PATH = path.join(process.cwd(), "scripts", "pump-idl.json");
const AMM_IDL_PATH = path.join(process.cwd(), "scripts", "pump-amm-idl.json");
if (!fs.existsSync(IDL_PATH) || !fs.existsSync(AMM_IDL_PATH)) {
  console.error(
    `[ingest-worker] Missing IDL file(s). Download both — tokens can be in\n` +
      "either phase (pre- or post-graduation) and need different decoders:\n" +
      "  curl -o scripts/pump-idl.json https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json\n" +
      "  curl -o scripts/pump-amm-idl.json https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump_amm.json",
  );
  process.exit(1);
}

const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // bonding curve (pre-graduation)
);
const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap (post-graduation)
);

// ─── DYNAMIC WATCHLIST CONFIG ──────────────────────────────────────────────
const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // consider a mint "active" if tokenHistory.lastChecked within this window
const REFRESH_INTERVAL_MS = 2 * 60 * 1000; // how often to re-poll tokenHistory and diff subscriptions
const MAX_MINTS = Number(process.env.INGEST_MAX_MINTS ?? 80); // one websocket subscription per mint: stay inside free-tier limits
const TRADE_TTL_SECONDS = 12 * 3600; // trades are deleted after 12h: ~8 trades/s across 11 tokens would fill the free 512MB MongoDB tier in days
const MIN_TRADE_SOL = 0.003; // dust trades are dropped by the candle builder anyway, so do not store them

async function loadWatchedMints(): Promise<string[]> {
  const db = await getDb();
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  // 1) tokens people are looking at right now (the chart route writes these), newest first
  const watched = await db
    .collection("watch")
    .find({ seenAt: { $gte: cutoff } }, { projection: { _id: 1 } })
    .sort({ seenAt: -1 })
    .limit(MAX_MINTS)
    .toArray();
  // 2) tokens the scanner is tracking
  const docs = await db
    .collection("tokenHistory")
    .find(
      {
        lastChecked: { $gte: cutoff },
        contractAddress: { $exists: true, $ne: null },
      },
      { projection: { contractAddress: 1, _id: 0 } },
    )
    .toArray();
  const all = [...new Set([...watched.map((d) => String(d._id)), ...docs.map((d) => d.contractAddress as string)])];
  // Solana mints only (the scanner also tracks EVM tokens, which this worker cannot decode)
  return all.filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0, MAX_MINTS);
}

// ─── ANCHOR EVENT DECODERS — one per program, tokens can be in either phase ─
const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
const ammIdl = JSON.parse(fs.readFileSync(AMM_IDL_PATH, "utf-8"));
const coder = new BorshCoder(idl);
const ammCoder = new BorshCoder(ammIdl);
const eventParser = new EventParser(PUMP_PROGRAM_ID, coder);
const ammEventParser = new EventParser(PUMP_AMM_PROGRAM_ID, ammCoder);

function decodeTradeFromLogs(logs: string[]) {
  const trades: any[] = [];

  // Try bonding-curve parser first
  try {
    for (const event of eventParser.parseLogs(logs)) {
      if (event.name.toLowerCase().includes("trade")) {
        trades.push({ ...event.data, _phase: "bonding-curve" });
      }
    }
  } catch {}

  // Then try PumpSwap parser — a graduated token's swaps only show up here.
  // PumpSwap names its events "BuyEvent" / "SellEvent" rather than one
  // combined "TradeEvent", so match on either.
  try {
    for (const event of ammEventParser.parseLogs(logs)) {
      const n = event.name.toLowerCase();
      if (n.includes("buy") || n.includes("sell") || n.includes("trade")) {
        trades.push({
          ...event.data,
          _phase: "pumpswap",
          _isBuyFromEventName: n.includes("buy"),
        });
      }
    }
  } catch {}

  return trades;
}

// ─── MONGO (mongoose model for trades) ─────────────────────────────────────
const tradeSchema = new mongoose.Schema(
  {
    mint: { type: String, index: true, required: true },
    isBuy: { type: Boolean, required: true },
    solAmount: { type: Number, required: true },
    tokenAmount: { type: Number, required: true },
    price: { type: Number, required: true },
    signature: { type: String, required: true, unique: true },
    slot: { type: Number, required: true },
    timestamp: { type: Number, required: true, index: true },
    // TTL: MongoDB removes the document once this date is TRADE_TTL_SECONDS old
    at: { type: Date, default: () => new Date(), index: { expireAfterSeconds: TRADE_TTL_SECONDS } },
  },
  { collection: "trades" },
);
const Trade = mongoose.models.Trade || mongoose.model("Trade", tradeSchema);

async function connectMongo() {
  // Same database the app reads from (lib/mongoClient.ts), otherwise the charts would never see these trades.
  await mongoose.connect(MONGODB_URI!, { dbName: process.env.MONGODB_DB || "wraith" });
  console.log("[ingest-worker] Mongo connected");
  await Trade.syncIndexes().catch((e) => console.error("[ingest-worker] index sync failed", e)); // creates the TTL + mint/timestamp indexes
  try { await mongoose.connection.collection("watch").createIndex({ seenAt: -1 }); } catch { /* optional */ }

  // Dynamic import — see comment near config() above for why this can't
  // be a static top-level import.
  ({ getDb } = await import("../lib/mongoClient"));
}

// ─── SUBSCRIPTION MANAGER ───────────────────────────────────────────────────
let tradeCount = 0;
const activeSubscriptions = new Map<string, number>(); // mint -> subscriptionId

async function subscribeToMint(connection: Connection, mint: string) {
  if (activeSubscriptions.has(mint)) return;

  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(mint);
  } catch {
    console.error(`[ingest-worker] Invalid mint, skipping: ${mint}`);
    return;
  }

  const subId = connection.onLogs(
    mintPubkey,
    async (logInfo: Logs, ctx: Context) => {
      if (logInfo.err) return;

      const parsedTrades = decodeTradeFromLogs(logInfo.logs);
      if (parsedTrades.length === 0) {
        try {
          const allEvents = [
            ...eventParser.parseLogs(logInfo.logs),
            ...ammEventParser.parseLogs(logInfo.logs),
          ];
          if (allEvents.length > 0 && tradeCount < 5) {
            console.log(
              `[ingest-worker] (debug) saw event(s) but none matched trade filter:`,
              allEvents.map((e) => e.name),
            );
          }
        } catch {}
        return;
      }

      for (const data of parsedTrades) {
        tradeCount++;
        // We already know the mint from the subscription itself — don't
        // rely on parsing it out of the event (PumpSwap's Buy/SellEvent
        // reference `pool`, not `mint`, directly).
        const mintStr = mint;

        // BN fields come back snake_case from PumpSwap ("base_amount_in",
        // "quote_amount_out"), camelCase from the bonding-curve program
        // ("solAmount", "tokenAmount"). .toString() first, then Number(),
        // is safe for realistic trade sizes and avoids BN.toNumber()'s
        // overflow throw on large values.
        const bn = (v: any): number => (v ? Number(v.toString()) : 0);

        let solAmount: number;
        let tokenAmount: number;
        let isBuy: boolean;

        if (data._phase === "bonding-curve") {
          solAmount = bn(data.solAmount) / 1e9;
          tokenAmount = bn(data.tokenAmount) / 1e6;
          isBuy = Boolean(data.isBuy);
        } else {
          // PumpSwap: buy = quote_amount_in / base_amount_out
          //           sell = base_amount_in / quote_amount_out
          isBuy = Boolean(data._isBuyFromEventName);
          if (isBuy) {
            solAmount = bn(data.quote_amount_in ?? data.quoteAmountIn) / 1e9;
            tokenAmount = bn(data.base_amount_out ?? data.baseAmountOut) / 1e6;
          } else {
            solAmount =
              bn(
                data.quote_amount_out_without_lp_fee ??
                  data.quote_amount_out ??
                  data.quoteAmountOut,
              ) / 1e9;
            tokenAmount = bn(data.base_amount_in ?? data.baseAmountIn) / 1e6;
          }
        }

        const price = tokenAmount > 0 ? solAmount / tokenAmount : 0;
        if (solAmount < MIN_TRADE_SOL || price <= 0) continue;

        console.log(
          `[trade #${tradeCount}] (${data._phase}) ${isBuy ? "BUY " : "SELL"} ${mintStr.slice(0, 6)}… ` +
            `${solAmount.toFixed(4)} SOL @ ${price.toExponential(3)} SOL/token`,
        );

        try {
          await Trade.create({
            mint: mintStr,
            isBuy,
            solAmount,
            tokenAmount,
            price,
            signature: logInfo.signature,
            slot: ctx.slot,
            timestamp: Date.now(),
          });
        } catch (e: any) {
          if (e?.code !== 11000) {
            console.error("[ingest-worker] Mongo write failed", e);
          }
        }
      }
    },
    "confirmed",
  );

  activeSubscriptions.set(mint, subId);
  console.log(`[ingest-worker] Subscribed: ${mint.slice(0, 8)}…`);
}

async function unsubscribeFromMint(connection: Connection, mint: string) {
  const subId = activeSubscriptions.get(mint);
  if (subId === undefined) return;
  try {
    await connection.removeOnLogsListener(subId);
  } catch (e) {
    console.error(
      `[ingest-worker] Failed to unsubscribe ${mint.slice(0, 8)}…`,
      e,
    );
  }
  activeSubscriptions.delete(mint);
  console.log(`[ingest-worker] Unsubscribed: ${mint.slice(0, 8)}…`);
}

async function refreshSubscriptions(connection: Connection) {
  let mints: string[];
  try {
    mints = await loadWatchedMints();
  } catch (e) {
    console.error(
      "[ingest-worker] Failed to load watched mints from tokenHistory",
      e,
    );
    return;
  }
  const mintSet = new Set(mints);

  for (const mint of mints) {
    await subscribeToMint(connection, mint);
  }
  for (const mint of [...activeSubscriptions.keys()]) {
    if (!mintSet.has(mint)) await unsubscribeFromMint(connection, mint);
  }
  console.log(
    `[ingest-worker] Refresh complete — active mints: ${activeSubscriptions.size} (from ${mints.length} in tokenHistory window)`,
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────
async function main() {
  await connectMongo();
  const connection = new Connection(RPC_URL!, { commitment: "confirmed" });

  await refreshSubscriptions(connection);
  setInterval(() => {
    refreshSubscriptions(connection).catch((e) =>
      console.error("[ingest-worker] refreshSubscriptions error", e),
    );
  }, REFRESH_INTERVAL_MS);

  console.log("[ingest-worker] Subscriptions active. Waiting for trades...");
}

main().catch((e) => {
  console.error("[ingest-worker] Fatal error", e);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("\n[ingest-worker] Shutting down...");
  await mongoose.disconnect();
  process.exit(0);
});
