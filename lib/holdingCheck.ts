// lib/holdingCheck.ts
// Server-side check used to gate comments: the commenter must hold at least
// MIN_COMMENT_HOLD_USD of the token in their embedded Solana wallet.

import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { getPrivyClient } from "@/lib/privyServer";
import { getSandboxToken } from "@/lib/devnetTokens";
import { DEVNET_RPC } from "@/lib/devnet";
import { arr, getJson, getSolUsd, obj, parseDexPair } from "@/lib/marketProviders";
import { hedgedRpc } from "@/lib/rpcHedge";

export const MIN_COMMENT_HOLD_USD = 3;

export interface HoldingResult {
  ok: boolean;
  heldUsd: number;
  minUsd: number;
  reason?: string;
}

const walletCache = new Map<string, { address: string | null; ts: number }>();
const WALLET_TTL = 10 * 60_000;

export async function getEmbeddedSolanaAddress(userId: string): Promise<string | null> {
  const hit = walletCache.get(userId);
  if (hit && Date.now() - hit.ts < WALLET_TTL) return hit.address;
  let address: string | null = null;
  try {
    const db = await getDb();
    const user = ObjectId.isValid(userId)
      ? await db.collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { privyUserId: 1 } })
      : null;
    const privy = getPrivyClient();
    if (user?.privyUserId && privy) {
      const pu = (await privy.getUser(String(user.privyUserId))) as unknown as {
        linkedAccounts?: Array<Record<string, unknown>>;
      };
      const wallets = (pu.linkedAccounts ?? []).filter((a) => a.type === "wallet" && a.chainType === "solana");
      const embedded = wallets.find((a) => a.walletClientType === "privy") ?? wallets[0];
      if (embedded && typeof embedded.address === "string") address = embedded.address;
    }
  } catch (e) {
    console.warn("[holdingCheck] wallet lookup failed", e);
  }
  walletCache.set(userId, { address, ts: Date.now() });
  return address;
}

async function rpc(method: string, params: unknown[], only?: string[]): Promise<unknown> {
  const urls = (only ?? [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC_URL, "https://solana-rpc.publicnode.com", "https://solana.drpc.org"]).filter(
    (u): u is string => typeof u === "string" && u.startsWith("http"),
  );
  // Hedged: the first endpoint answers alone; the next ones only start if it is slow or failing (no more asking every node at once).
  const { data } = await hedgedRpc<{ result?: unknown }>(urls, { jsonrpc: "2.0", id: 1, method, params }, { timeoutMs: 5000, hedgeMs: 600 });
  if (data.result === undefined) throw new Error("rpc error");
  return data.result;
}

const qtyCache = new Map<string, { qty: number; ts: number }>();
const priceCache = new Map<string, { price: number; ts: number }>();

/** Token quantity held by the user's embedded wallet (cached ~20s). */
export async function getHeldQuantity(userId: string, mint: string): Promise<{ qty: number; address: string | null; failed?: boolean }> {
  const address = await getEmbeddedSolanaAddress(userId);
  if (!address) return { qty: 0, address: null };
  const key = `${address}:${mint}`;
  const hit = qtyCache.get(key);
  if (hit && Date.now() - hit.ts < 20_000) return { qty: hit.qty, address };
  try {
    const sandboxTok = await getSandboxToken(mint);
    const result = (await rpc("getTokenAccountsByOwner", [address, { mint }, { encoding: "jsonParsed" }], sandboxTok ? [DEVNET_RPC] : undefined)) as {
      value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } } } }>;
    };
    const qty = (result.value ?? []).reduce((sum, a) => sum + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
    qtyCache.set(key, { qty, ts: Date.now() });
    return { qty, address };
  } catch {
    return { qty: 0, address, failed: true };
  }
}

async function getPriceUsd(mint: string): Promise<number> {
  const hit = priceCache.get(mint);
  if (hit && Date.now() - hit.ts < 20_000) return hit.price;
  const solUsd = await getSolUsd();
  const sandboxTok = await getSandboxToken(mint);
  if (sandboxTok) return sandboxTok.priceSol * solUsd;
  const pairs = arr(await getJson(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, undefined, 6000));
  let price = 0;
  let bestLiq = -1;
  for (const p of pairs) {
    const t = parseDexPair(obj(p), solUsd);
    if (t && t.address === mint && t.priceUsd > 0 && t.liquidity > bestLiq) {
      price = t.priceUsd;
      bestLiq = t.liquidity;
    }
  }
  if (price > 0) priceCache.set(mint, { price, ts: Date.now() });
  return price;
}

/**
 * Did `signature` really move `mint` in this user's OWN Wraith wallet, in the direction claimed? Read from the chain, never trusted
 * from the browser. Sandbox (devnet) tokens are not checked: they are free test tokens.
 */
export async function verifySwapSignature(userId: string, mint: string, side: "buy" | "sell", signature: string): Promise<boolean> {
  if (await getSandboxToken(mint)) return true;
  const wallet = await getEmbeddedSolanaAddress(userId);
  if (!wallet) return false;
  type Bal = { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null; uiAmountString?: string } };
  type Tx = {
    meta?: { err: unknown; preTokenBalances?: Bal[]; postTokenBalances?: Bal[] } | null;
    transaction?: { message?: { accountKeys?: Array<{ pubkey?: string; signer?: boolean } | string> } };
  } | null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let tx: Tx = null;
    try {
      tx = (await rpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }])) as Tx;
    } catch {
      tx = null;
    }
    if (tx?.meta) {
      if (tx.meta.err) return false; // the swap failed on chain
      const keys = tx.transaction?.message?.accountKeys ?? [];
      const signedByUser = keys.some((k) => typeof k === "object" && k !== null && k.pubkey === wallet && k.signer === true);
      if (!signedByUser) return false;
      const total = (list?: Bal[]) =>
        (list ?? [])
          .filter((b) => b.owner === wallet && b.mint === mint)
          .reduce((sum, b) => sum + Number(b.uiTokenAmount?.uiAmount ?? b.uiTokenAmount?.uiAmountString ?? 0), 0);
      const delta = total(tx.meta.postTokenBalances) - total(tx.meta.preTokenBalances);
      return side === "buy" ? delta > 0 : delta < 0;
    }
    await new Promise((r) => setTimeout(r, 800)); // the node may not have the transaction yet right after it confirms
  }
  return false;
}

/** Has this user bought or sold the token on Wraith (or do they hold it right now)? */
export async function hasTradedToken(userId: string, mint: string): Promise<boolean> {
  try {
    const db = await getDb();
    const rec = await db.collection("token_activity").findOne({ userId, mint }, { projection: { _id: 1 } });
    if (rec) return true;
    // Older trades kept in the trades / positions documents.
    const [t, p] = await Promise.all([
      db.collection("trades").findOne({ userId, "trades.mint": mint }, { projection: { _id: 1 } }),
      db.collection("positions").findOne({ userId, "positions.mint": mint }, { projection: { _id: 1 } }),
    ]);
    if (t || p) return true;
  } catch (e) {
    console.warn("[hasTradedToken] db lookup failed", e);
  }
  const held = await getHeldQuantity(userId, mint);
  return held.qty > 0;
}

export async function checkTokenHolding(userId: string, mint: string): Promise<HoldingResult> {
  const minUsd = MIN_COMMENT_HOLD_USD;
  const held = await getHeldQuantity(userId, mint);
  if (!held.address) return { ok: false, heldUsd: 0, minUsd, reason: "No Wraith wallet found on your account." };
  if (held.failed) return { ok: false, heldUsd: 0, minUsd, reason: "Could not verify your balance right now. Try again." };
  if (!(held.qty > 0)) return { ok: false, heldUsd: 0, minUsd };
  try {
    const price = await getPriceUsd(mint);
    if (!(price > 0)) return { ok: false, heldUsd: 0, minUsd, reason: "Could not price this token right now." };
    const heldUsd = held.qty * price;
    return { ok: heldUsd >= minUsd, heldUsd, minUsd };
  } catch {
    return { ok: false, heldUsd: 0, minUsd, reason: "Could not price this token right now." };
  }
}
