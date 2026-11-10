/**
 * PILOT for the 6-month backtest. Uses ONLY HELIUS_RESEARCH_KEY (never the app's key) and stops at a hard credit budget.
 * For a sample of past calls it reads the pump.fun bonding-curve trades, finds who bought early and how long each of them held,
 * and records what the token did afterwards. Output: scripts/.pilot/pilot.json + a cost report.
 *   npx tsx scripts/backtest-pilot.ts [tokens=60] [budgetCredits=60000]
 * Cost model: enhanced transactions call ~100 credits each (check your Helius dashboard usage and adjust CREDITS_PER_CALL).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { PublicKey } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";

const KEY = (process.env.HELIUS_RESEARCH_KEY ?? "").trim();
if (!KEY) { console.error("Set HELIUS_RESEARCH_KEY in .env.local"); process.exit(1); }
const N = Number(process.argv[2] ?? 60), BUDGET = Number(process.argv[3] ?? 60_000);
const CREDITS_PER_CALL = Number(process.env.HELIUS_CREDITS_PER_CALL ?? 100);
const MAX_PAGES_PER_TOKEN = 25;
const WSOL = "So11111111111111111111111111111111111111112";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const tok = (t: O) => { const r = o(t.rawTokenAmount); return r.tokenAmount !== undefined ? num(r.tokenAmount) / 10 ** num(r.decimals) : num(t.tokenAmount); };

let credits = 0, calls = 0;
const curve = (mint: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP))[0].toBase58();

interface Sw { ts: number; side: "buy" | "sell"; sol: number; tokens: number; wallet: string }
function parse(tx: O, mint: string): Sw | null {
  const sw = o(o(tx.events).swap);
  const ins = arr(sw.tokenInputs).map(o), outs = arr(sw.tokenOutputs).map(o);
  const nIn = num(o(sw.nativeInput).amount) / 1e9, nOut = num(o(sw.nativeOutput).amount) / 1e9;
  const wIn = ins.filter((t) => t.mint === WSOL).reduce((s, t) => s + tok(t), 0), wOut = outs.filter((t) => t.mint === WSOL).reduce((s, t) => s + tok(t), 0);
  const bought = outs.filter((t) => t.mint === mint).reduce((s, t) => s + tok(t), 0), sold = ins.filter((t) => t.mint === mint).reduce((s, t) => s + tok(t), 0);
  const ts = num(tx.timestamp) * 1000, wallet = String(tx.feePayer ?? "");
  if (!ts || !wallet) return null;
  if (bought > 0 && sold === 0) { const sol = nIn || wIn; return sol > 0 ? { ts, side: "buy", sol, tokens: bought, wallet } : null; }
  if (sold > 0 && bought === 0) { const sol = nOut || wOut; return sol > 0 ? { ts, side: "sell", sol, tokens: sold, wallet } : null; }
  return null;
}

/** Walk back from newest to oldest on the curve account until the token's first trade (or the page cap). */
async function curveSwaps(mint: string): Promise<{ swaps: Sw[]; pages: number; reachedStart: boolean }> {
  const addr = curve(mint);
  const out: Sw[] = [];
  let before = "", pages = 0, reached = false;
  while (pages < MAX_PAGES_PER_TOKEN) {
    if (credits + CREDITS_PER_CALL > BUDGET) break;
    const url = `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${KEY}&limit=100${before ? `&before=${before}` : ""}`;
    credits += CREDITS_PER_CALL; calls++; pages++;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res || res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); pages--; continue; }
    if (!res.ok) break;
    const rows = arr(await res.json()).map(o);
    if (!rows.length) { reached = true; break; }
    for (const r of rows) { const s = parse(r, mint); if (s) out.push(s); }
    before = String(rows[rows.length - 1].signature ?? "");
    if (rows.length < 100) { reached = true; break; }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { swaps: out.sort((a, b) => a.ts - b.ts), pages, reachedStart: reached };
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const cutoff = Date.now() - 3 * 86_400_000;
  const pool = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls").find(
    { address: /pump$/, spottedAt: { $lt: cutoff }, badData: { $ne: true }, spottedMcap: { $gt: 0 } },
    { projection: { address: 1, symbol: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1, rugged: 1 } },
  ).toArray();
  await c.close();
  const win = (x: O) => num(x.peakMcap) / num(x.spottedMcap) >= 2;
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const winners = shuffled.filter((x) => win(x)).slice(0, Math.ceil(N / 2)), others = shuffled.filter((x) => !win(x)).slice(0, N - Math.min(winners.length, Math.ceil(N / 2)));
  const sample = [...winners, ...others];
  console.log(`pool ${pool.length} pump.fun calls older than 3 days; sampling ${sample.length} (${winners.length} winners, ${others.length} others); budget ${BUDGET} credits`);

  const rows: O[] = [];
  let done = 0, reached = 0;
  for (const t of sample) {
    if (credits + CREDITS_PER_CALL > BUDGET) { console.log("budget reached, stopping"); break; }
    const mint = String(t.address);
    const { swaps, pages, reachedStart } = await curveSwaps(mint);
    done++; if (reachedStart) reached++;
    if (!swaps.length) { rows.push({ mint, symbol: t.symbol, pages, reachedStart, swaps: 0 }); continue; }
    const t0 = swaps[0].ts;
    const early = new Map<string, { buyAt: number; sol: number; soldAt?: number; soldFrac: number; tokens: number; soldTokens: number }>();
    for (const s of swaps) {
      if (s.ts - t0 > 3_600_000) break;
      if (s.side === "buy") { const e = early.get(s.wallet) ?? { buyAt: s.ts, sol: 0, soldFrac: 0, tokens: 0, soldTokens: 0 }; e.sol += s.sol; e.tokens += s.tokens; early.set(s.wallet, e); }
    }
    for (const s of swaps) {
      const e = early.get(s.wallet);
      if (!e || s.side !== "sell" || s.ts < e.buyAt) continue;
      e.soldTokens += s.tokens; e.soldAt = e.soldAt ?? s.ts;
    }
    const wallets = [...early.entries()].map(([w, e]) => ({ w, sol: +e.sol.toFixed(3), buyOffsetMin: +((e.buyAt - t0) / 60000).toFixed(1), heldMin: e.soldAt ? +((e.soldAt - e.buyAt) / 60000).toFixed(1) : null, soldPct: e.tokens ? Math.min(100, Math.round((e.soldTokens / e.tokens) * 100)) : 0 }));
    rows.push({
      mint, symbol: t.symbol, win: win(t), spottedAt: t.spottedAt, ratioPeak: +(num(t.peakMcap) / num(t.spottedMcap)).toFixed(2), ratioLast: +(num(t.lastMcap) / num(t.spottedMcap)).toFixed(3),
      pages, reachedStart, swaps: swaps.length, firstTradeAt: t0, earlyWallets: wallets,
    });
    if (done % 5 === 0) console.log(`  ${done}/${sample.length} tokens, ${credits} credits used`);
    mkdirSync("scripts/.pilot", { recursive: true });
    writeFileSync("scripts/.pilot/pilot.json", JSON.stringify(rows)); // saved after every token, so a stop never loses work
  }
  const ok = rows.filter((r) => num(r.swaps) > 0);
  console.log(`\nDONE: ${done} tokens, ${calls} API calls, ~${credits} credits (${done ? Math.round(credits / done) : 0} per token)`);
  console.log(`reached the token's very first trade: ${reached}/${done}; tokens with usable swaps: ${ok.length}`);
  const avgPages = ok.length ? ok.reduce((s, r) => s + num(r.pages), 0) / ok.length : 0;
  console.log(`average pages per token: ${avgPages.toFixed(1)}; early wallets per token (first hour): ${ok.length ? Math.round(ok.reduce((s, r) => s + arr(r.earlyWallets).length, 0) / ok.length) : 0}`);
  const wl = ok.flatMap((r) => arr(r.earlyWallets).map(o)).filter((w) => w.heldMin !== null);
  const held = wl.map((w) => num(w.heldMin)).sort((a, b) => a - b);
  if (held.length) console.log(`holding time of early buyers that sold (minutes): median ${held[Math.floor(held.length / 2)]}, p25 ${held[Math.floor(held.length * 0.25)]}, p75 ${held[Math.floor(held.length * 0.75)]}  (n=${held.length})`);
  const per1M = credits && done ? Math.round((1_000_000 / (credits / done))) : 0;
  console.log(`=> at this cost, 1,000,000 credits covers about ${per1M} tokens`);
}
main().catch((e) => { console.error(e); process.exit(1); });
