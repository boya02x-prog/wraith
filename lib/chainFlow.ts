// lib/chainFlow.ts  (server only)
// A token's recent trades, read straight from the chain through Helius's RPC history method, for the scanner's buyer-flow numbers.
// Why not the "enhanced transactions" API the swaps tab uses: it answers about one request per 1.2s and rate-limits (429) at that pace,
// and it has no swap breakdown for pump.fun bonding-curve trades, so only ~4% of calls ever kept buyer data. This route returns 100
// full transactions in ~0.4s with no rate trouble on the same key, and every trade is decoded from the trader's own SOL and token
// balance changes (checked 18/18 against Helius's own decoder). scripts/backfill-flow.ts rebuilds past calls with the same decoding.
import { PublicKey } from "@solana/web3.js";
import { heliusKey, heliusRpcUrl, type Swap } from "@/lib/heliusSwaps";
import { resolvePool } from "@/lib/marketProviders";

type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const WSOL = "So11111111111111111111111111111111111111112";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export const curveAddress = (mint: string): string | null => {
  try { return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58(); } catch { return null; }
};

/** One parsed transaction -> one trade of `mint` by its signer, from that wallet's own SOL and token balance changes. */
export function parseChainTx(d: O, mint: string): Swap | null {
  const meta = d.meta as O | undefined, bt = num(d.blockTime);
  if (!meta || meta.err || !bt) return null;
  const tx = o(d.transaction);
  const msg = o(tx.message);
  const keys = (Array.isArray(msg.accountKeys) ? msg.accountKeys : []).map((k) => (typeof k === "string" ? k : String(o(k).pubkey)));
  const signer = keys[0];
  if (!signer) return null;
  const bal = (arr: unknown, test: (b: O) => boolean) => (Array.isArray(arr) ? (arr as O[]) : []).filter(test).reduce((s, b) => s + num(o(b.uiTokenAmount).uiAmount), 0);
  const mine = (m: string) => (b: O) => b.owner === signer && b.mint === m;
  const tokenDelta = bal(meta.postTokenBalances, mine(mint)) - bal(meta.preTokenBalances, mine(mint));
  if (tokenDelta === 0) return null;
  const pre = Array.isArray(meta.preBalances) ? (meta.preBalances as number[]) : [], post = Array.isArray(meta.postBalances) ? (meta.postBalances as number[]) : [];
  const native = (num(post[0]) - num(pre[0])) / 1e9 + num(meta.fee) / 1e9; // the fee is not part of the trade
  const wrapped = bal(meta.postTokenBalances, mine(WSOL)) - bal(meta.preTokenBalances, mine(WSOL));
  const moved = native + wrapped; // negative = SOL spent, positive = SOL received
  const sigs = Array.isArray(tx.signatures) ? (tx.signatures as string[]) : [];
  const sig = sigs[0] ?? "";
  if (tokenDelta > 0 && moved < -0.002) return { sig, ts: bt * 1000, side: "buy", tokens: tokenDelta, sol: -moved, priceSol: -moved / tokenDelta, wallet: signer };
  if (tokenDelta < 0 && moved > 0.002) return { sig, ts: bt * 1000, side: "sell", tokens: -tokenDelta, sol: moved, priceSol: moved / -tokenDelta, wallet: signer };
  return null;
}

function rpcUrl(): string | null {
  const u = heliusRpcUrl();
  if (u) return u;
  const k = heliusKey();
  return k ? `https://mainnet.helius-rpc.com/?api-key=${k}` : null;
}

async function page(url: string, address: string, token?: string): Promise<{ data: O[]; next?: string } | null> {
  const opts: O = { transactionDetails: "full", encoding: "jsonParsed", maxSupportedTransactionVersion: 1, sortOrder: "desc", limit: 100, filters: { status: "succeeded" } };
  if (token) opts.paginationToken = token;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionsForAddress", params: [address, opts] }), signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 800)); continue; }
      if (!res.ok) return null;
      const j = (await res.json()) as { result?: { data?: O[]; paginationToken?: string } };
      return { data: j.result?.data ?? [], next: j.result?.paginationToken };
    } catch { return null; }
  }
  return null;
}

async function tradesOn(url: string, address: string, mint: string, pages: number): Promise<Swap[] | null> {
  const out: Swap[] = [];
  let token: string | undefined;
  for (let p = 0; p < pages; p++) {
    const r = await page(url, address, token);
    if (!r) return p === 0 ? null : out;
    for (const d of r.data) { const s = parseChainTx(d, mint); if (s) out.push(s); }
    token = r.next;
    if (!token || r.data.length < 100) break;
  }
  return out;
}

const cache = new Map<string, { ts: number; swaps: Swap[] }>();

/** Newest trades of a token (up to pages x 100 transactions). Bonding curve first for pump.fun tokens, then the pool. Null if nothing usable. */
export async function fetchFlowSwaps(mint: string, pages = 2): Promise<Swap[] | null> {
  const url = rpcUrl();
  if (!url) return null;
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < 20_000) return hit.swaps;
  const keep = (swaps: Swap[]) => { cache.set(mint, { ts: Date.now(), swaps }); if (cache.size > 300) cache.clear(); return swaps; };
  let best: Swap[] | null = null;
  const curve = mint.endsWith("pump") ? curveAddress(mint) : null;
  if (curve) {
    best = await tradesOn(url, curve, mint, pages);
    if (best && best.length >= 8) return keep(best);
  }
  // graduated, or not a pump.fun token: its trades happen in a pool
  const pool = await Promise.race([resolvePool(mint).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  if (pool) {
    const s2 = await tradesOn(url, pool, mint, pages);
    if (s2 && s2.length > (best?.length ?? 0)) best = s2;
  }
  return best && best.length ? keep(best) : null;
}
