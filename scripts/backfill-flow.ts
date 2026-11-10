/**
 * Rebuilds, from REAL on-chain trades, the buyer-flow numbers the scanner should have recorded when each call was made.
 *   npx tsx scripts/backfill-flow.ts [max=400] [--calls=7000]       (resumable: answers are kept in scripts/.pilot/flow.json)
 * Why: only about 4% of past calls kept buyer-flow data (the live parser misses many pump.fun trades and Helius rate-limits it),
 * so the model has had almost nothing to learn from there. For each call this reads the ~200 trades that happened on the token's
 * bonding curve (or its pool) just BEFORE the call, from the research key, and computes the same numbers the live scanner uses
 * (lib/signalFlow.ts): different buyers, top-3 share, bundled launch, buying speed-up, net SOL. Nothing after the call time is used,
 * so there is no hindsight. Read-only on the database; scripts/research-model2.ts --flow measures whether it helps.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { computeFlow } from "../lib/signalFlow";
import { dexPairs } from "./pathlib";

const KEY = (process.env.HELIUS_RESEARCH_KEY ?? "").trim();
if (!KEY) { console.error("Set HELIUS_RESEARCH_KEY in .env.local"); process.exit(1); }
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 400);
const CALL_CAP = Number((process.argv.find((a) => a.startsWith("--calls=")) ?? "--calls=7000").split("=")[1]);
const OUT = "scripts/.pilot/flow.json";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL = "So11111111111111111111111111111111111111112";
const PAGES = 2; // 2 x 100 trades, like the live scanner

type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
interface Swap { sig: string; ts: number; side: "buy" | "sell"; tokens: number; sol: number; priceSol: number; wallet: string }
export interface FlowRec { ok: boolean; n: number; src?: "curve" | "pool"; f?: Record<string, number> }

let apiCalls = 0, lastCall = 0;
async function rpc(params: unknown[]): Promise<{ data?: O[]; paginationToken?: string } | null> {
  for (let i = 0; i < 4; i++) {
    const wait = Math.max(0, lastCall + 220 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now(); apiCalls++;
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionsForAddress", params }), signal: AbortSignal.timeout(40000) }).catch(() => null);
    if (res && res.status === 429) { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); continue; }
    if (!res || !res.ok) return null;
    return ((await res.json()) as { result?: { data?: O[]; paginationToken?: string } }).result ?? null;
  }
  return null;
}

/** One transaction -> one trade by its signer (the wallet that paid the fee), read from that wallet's own SOL and token balance changes. */
function parseTx(d: O, mint: string): Swap | null {
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
  const native = (num(post[0]) - num(pre[0])) / 1e9 + num(meta.fee) / 1e9; // fee added back: it is not part of the trade
  const wrapped = bal(meta.postTokenBalances, mine(WSOL)) - bal(meta.preTokenBalances, mine(WSOL));
  const moved = native + wrapped; // negative = SOL spent, positive = SOL received
  const sigs = Array.isArray(tx.signatures) ? (tx.signatures as string[]) : [];
  if (tokenDelta > 0 && moved < -0.002) return { sig: sigs[0] ?? "", ts: bt * 1000, side: "buy", tokens: tokenDelta, sol: -moved, priceSol: -moved / tokenDelta, wallet: signer };
  if (tokenDelta < 0 && moved > 0.002) return { sig: sigs[0] ?? "", ts: bt * 1000, side: "sell", tokens: -tokenDelta, sol: moved, priceSol: moved / -tokenDelta, wallet: signer };
  return null;
}

/** The newest trades on one account up to (and including) the call time. */
async function tradesBefore(address: string, mint: string, atSec: number): Promise<Swap[] | null> {
  const out: Swap[] = [];
  let token: string | undefined;
  for (let p = 0; p < PAGES; p++) {
    const opts: O = { transactionDetails: "full", encoding: "jsonParsed", maxSupportedTransactionVersion: 1, sortOrder: "desc", limit: 100, filters: { status: "succeeded", blockTime: { lte: atSec } } };
    if (token) opts.paginationToken = token;
    const r = await rpc([address, opts]);
    if (!r) return p === 0 ? null : out;
    for (const d of r.data ?? []) { const s = parseTx(d, mint); if (s) out.push(s); }
    token = r.paginationToken;
    if (!token || !(r.data ?? []).length) break;
  }
  return out;
}

const curveOf = (m: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(m).toBuffer()], PUMP)[0].toBase58();

async function main() {
  const done: Record<string, FlowRec> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const pathOk = (f: string) => { const j: Record<string, { ok?: boolean }> = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}; return j; };
  const g = pathOk("scripts/.pilot/paths.json"), h = pathOk("scripts/.pilot/paths-helius.json");
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, address: { $regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ }, chain: { $in: [null, "solana"] } }, { projection: { address: 1, spottedAt: 1, shadow: 1, "features.flowBuyers": 1 } }).toArray();
  await c.close();
  // calls with a real price path first (they are the ones the research can score), then newest first
  const todo = calls.filter((x) => !done[x.address as string] && x.features?.flowBuyers == null)
    .sort((a, b) => Number(!!(h[b.address as string]?.ok || g[b.address as string]?.ok)) - Number(!!(h[a.address as string]?.ok || g[a.address as string]?.ok)) || (b.spottedAt as number) - (a.spottedAt as number))
    .slice(0, MAX);
  console.log(`${calls.length} calls, ${Object.keys(done).length} already rebuilt, rebuilding ${todo.length}`);
  const pairs = await dexPairs(todo.filter((x) => !(x.address as string).endsWith("pump")).map((x) => x.address as string));
  let n = 0, ok = 0, fromPool = 0;
  for (const t of todo) {
    if (apiCalls >= CALL_CAP) { console.log(`call cap ${CALL_CAP} reached`); break; }
    const mint = t.address as string, atSec = Math.floor((t.spottedAt as number) / 1000);
    let swaps: Swap[] | null = null, src: "curve" | "pool" = "pool";
    if (mint.endsWith("pump")) { swaps = await tradesBefore(curveOf(mint), mint, atSec); src = "curve"; }
    // graduated tokens trade in a pool instead: if the curve is quiet, use the pool DexScreener knows
    if (!swaps || swaps.length < 8) {
      const pool = pairs.get(mint)?.pair ?? (mint.endsWith("pump") ? (await dexPairs([mint])).get(mint)?.pair : undefined);
      if (pool) { const s2 = await tradesBefore(pool, mint, atSec); if (s2 && s2.length > (swaps?.length ?? 0)) { swaps = s2; src = "pool"; fromPool++; } }
    }
    const r = swaps ? computeFlow(swaps as never, t.spottedAt as number) : null;
    done[mint] = r
      ? { ok: true, n: swaps!.length, src, f: { flowBuyers: r.flow.buyers, flowAccel: r.flow.accel, top3Share: r.flow.top3Share, bundled: r.flow.bundled, netSol: r.flow.netSol } }
      : { ok: false, n: swaps?.length ?? 0 };
    if (r) ok++;
    n++;
    if (n % 25 === 0) { writeFileSync(OUT, JSON.stringify(done)); console.log(`  ${n}/${todo.length} | usable flow for ${ok} (${Math.round((ok / n) * 100)}%), ${fromPool} from a pool | ${apiCalls} API calls`); }
  }
  writeFileSync(OUT, JSON.stringify(done));
  console.log(`\nfinished: ${n} calls, ${ok} with usable buyer flow, ${apiCalls} API calls. Saved to ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
