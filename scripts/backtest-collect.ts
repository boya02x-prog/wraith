/**
 * Early-buyer collector v2. Uses ONLY HELIUS_RESEARCH_KEY and reads each token's trades OLDEST FIRST
 * (getTransactionsForAddress, sortOrder asc), so the first hour after launch costs a few calls instead of paging back through all history.
 * Records, per token: who bought in the first hour, how much, when, who sold inside the hour, and who was still holding at the end of it.
 *   npx tsx scripts/backtest-collect.ts [tokens=40] [maxCalls=400]
 * Output (saved after every token): scripts/.pilot/collect.json
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { PublicKey } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";

const KEY = (process.env.HELIUS_RESEARCH_KEY ?? "").trim();
if (!KEY) { console.error("Set HELIUS_RESEARCH_KEY in .env.local"); process.exit(1); }
const N = Number(process.argv[2] ?? 40), MAX_CALLS = Number(process.argv[3] ?? 400), OUT = process.argv[4] ?? "scripts/.pilot/collect.json";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WINDOW_S = 1800, PAGES_PER_TOKEN = 14; // first 30 minutes: that is where the sniper / early-conviction buyers are
type O = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
let calls = 0;

async function rpc(method: string, params: unknown[]): Promise<{ result?: O; error?: O } | null> {
  for (let i = 0; i < 3; i++) {
    calls++;
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res && res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); continue; }
    if (!res || !res.ok) return null;
    return (await res.json()) as { result?: O; error?: O };
  }
  return null;
}

interface W { sol: number; tok: number; buyAt: number; soldTok: number; soldAt?: number; endTok: number }
async function collect(mint: string) {
  const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();
  const wallets = new Map<string, W>();
  let t0 = 0, token: string | undefined, pages = 0, txs = 0, reachedEnd = false;
  while (pages < PAGES_PER_TOKEN && calls < MAX_CALLS) {
    const opts: O = { transactionDetails: "full", encoding: "jsonParsed", maxSupportedTransactionVersion: 1, sortOrder: "asc", limit: 100, filters: { status: "succeeded" } };
    if (token) opts.paginationToken = token;
    const r = await rpc("getTransactionsForAddress", [curve, opts]);
    pages++;
    const res = r?.result as { data?: O[]; paginationToken?: string } | undefined;
    const data = res?.data ?? [];
    if (!data.length) { reachedEnd = true; break; }
    for (const d of data) {
      const meta = d.meta as O | undefined, bt = num(d.blockTime);
      if (!meta || meta.err) continue;
      if (!t0) t0 = bt;
      if (bt - t0 > WINDOW_S) { reachedEnd = true; break; }
      txs++;
      const tx = (d.transaction as O);
      const msg = ((tx.transaction as O | undefined)?.message ?? tx.message) as O;
      const k0 = (msg.accountKeys as unknown[])[0] as O | string;
      const signer = typeof k0 === "string" ? k0 : String(k0.pubkey);
      const bal = (a: unknown) => (Array.isArray(a) ? (a as O[]) : []).filter((b) => b.mint === mint && b.owner === signer).reduce((s, b) => s + num((b.uiTokenAmount as O).uiAmount), 0);
      const dTok = bal(meta.postTokenBalances) - bal(meta.preTokenBalances);
      const post = (meta.postBalances as number[])[0], pre = (meta.preBalances as number[])[0];
      const dSol = (post - pre + num(meta.fee)) / 1e9;
      const w = wallets.get(signer);
      if (dTok > 0) {
        const e = w ?? { sol: 0, tok: 0, buyAt: bt, soldTok: 0, endTok: 0 };
        e.sol += Math.max(0, -dSol); e.tok += dTok; e.endTok = bal(meta.postTokenBalances); wallets.set(signer, e);
      } else if (dTok < 0 && w) { w.soldTok += -dTok; w.soldAt = w.soldAt ?? bt; w.endTok = bal(meta.postTokenBalances); }
    }
    if (reachedEnd) break;
    token = res?.paginationToken;
    if (!token) { reachedEnd = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  const list = [...wallets.entries()].map(([w, e]) => ({
    w, sol: +e.sol.toFixed(3), buyOffsetS: e.buyAt - t0,
    soldPct: e.tok ? Math.min(100, Math.round((e.soldTok / e.tok) * 100)) : 0,
    heldS: e.soldAt ? e.soldAt - e.buyAt : null, holdingAtHourEnd: e.tok > 0 && e.endTok >= e.tok * 0.9,
  }));
  return { t0, txs, pages, reachedEnd, wallets: list };
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const pool = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls").find(
    { address: /pump$/, spottedAt: { $lt: Date.now() - 3 * 86_400_000 }, badData: { $ne: true }, spottedMcap: { $gt: 0 } },
    { projection: { address: 1, symbol: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } },
  ).toArray();
  await c.close();
  const win = (x: O) => num(x.peakMcap) / num(x.spottedMcap) >= 2;
  const sh = pool.sort(() => Math.random() - 0.5);
  // small runs are balanced half winners / half not; big runs take a plain random sample (the real mix, about 1 winner in 12)
  const sample = N >= 200 ? sh.slice(0, N) : [...sh.filter((x) => win(x)).slice(0, Math.ceil(N / 2)), ...sh.filter((x) => !win(x)).slice(0, Math.floor(N / 2))];
  console.log(`sampling ${sample.length} of ${pool.length}; call cap ${MAX_CALLS}`);
  const rows: O[] = [];
  mkdirSync("scripts/.pilot", { recursive: true });
  for (const t of sample) {
    if (calls >= MAX_CALLS) { console.log("call cap reached"); break; }
    const r = await collect(String(t.address));
    rows.push({ mint: t.address, symbol: t.symbol, win: win(t), ratioPeak: +(num(t.peakMcap) / num(t.spottedMcap)).toFixed(2), ratioLast: +(num(t.lastMcap) / num(t.spottedMcap)).toFixed(3), ...r });
    writeFileSync(OUT, JSON.stringify(rows));
    if (rows.length % 25 === 0) console.log(`  ${rows.length}/${sample.length} tokens, ${calls} calls`);
  }
  const ok = rows.filter((r) => num(r.txs) > 0);
  console.log(`\nDONE: ${rows.length} tokens, ${calls} API calls (${rows.length ? (calls / rows.length).toFixed(1) : 0} per token); ${ok.length} usable; full first hour covered: ${rows.filter((r) => r.reachedEnd).length}/${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
