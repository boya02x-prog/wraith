// lib/walletHistory.ts  (server only)
// What has this wallet been trading? Reads the wallet's recent swaps from Helius (enhanced transactions) and groups them by token.
// One page = 100 swaps. Cached for 10 minutes so opening a profile twice costs nothing.
import { heliusKey } from "@/lib/heliusSwaps";

const WSOL = "So11111111111111111111111111111111111111112";
type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const tok = (t: O) => { const r = o(t.rawTokenAmount); return r.tokenAmount !== undefined ? n(r.tokenAmount) / 10 ** n(r.decimals) : n(t.tokenAmount); };

export interface WalletToken { mint: string; buys: number; sells: number; buySol: number; sellSol: number; firstAt: number; lastAt: number; holding: boolean }
export interface WalletHistory { tokens: WalletToken[]; swaps: number; fetchedAt: number }

const cache = new Map<string, { ts: number; v: WalletHistory }>();
const TTL = 10 * 60_000;

export async function walletHistory(wallet: string): Promise<WalletHistory | null> {
  const hit = cache.get(wallet);
  if (hit && Date.now() - hit.ts < TTL) return hit.v;
  const key = heliusKey();
  if (!key) return null;
  let rows: O[] = [];
  try {
    // Busy bot wallets are slow here: Helius has to scan past thousands of non-swap transactions to find 100 swaps
    // (measured 11s for a sniper wallet), so the limit leaves room for that instead of giving up at 12s.
    const res = await fetch(`https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&type=SWAP&limit=100`, { signal: AbortSignal.timeout(22000), cache: "no-store" });
    if (!res.ok) return null;
    rows = a(await res.json()).map(o);
  } catch { return null; }

  const by = new Map<string, WalletToken>();
  let swaps = 0;
  for (const tx of rows) {
    const sw = o(o(tx.events).swap);
    let ins = a(sw.tokenInputs).map(o), outs = a(sw.tokenOutputs).map(o);
    let solIn = n(o(sw.nativeInput).amount) / 1e9 + ins.filter((t) => t.mint === WSOL).reduce((s, t) => s + tok(t), 0);
    let solOut = n(o(sw.nativeOutput).amount) / 1e9 + outs.filter((t) => t.mint === WSOL).reduce((s, t) => s + tok(t), 0);
    const ts = n(tx.timestamp) * 1000;
    if (!ts) continue;
    if (!ins.length && !outs.length && solIn === 0 && solOut === 0) {
      // pump.fun trades come without a swap breakdown: read the wallet's own token and SOL movements instead
      const mine = a(tx.tokenTransfers).map(o).filter((t) => typeof t.mint === "string" && t.mint !== WSOL);
      const got = mine.filter((t) => t.toUserAccount === wallet), gave = mine.filter((t) => t.fromUserAccount === wallet);
      const change = n(a(tx.accountData).map(o).find((d) => d.account === wallet)?.nativeBalanceChange) / 1e9;
      const fee = n(tx.fee) / 1e9;
      if (got.length && !gave.length && change < 0) { outs = [{ mint: got[0].mint }]; solIn = -change - fee; }
      else if (gave.length && !got.length && change > 0) { ins = [{ mint: gave[0].mint }]; solOut = change + fee; }
    }
    const bought = outs.find((t) => typeof t.mint === "string" && t.mint !== WSOL);
    const sold = ins.find((t) => typeof t.mint === "string" && t.mint !== WSOL);
    // a clean buy (SOL in, token out) or a clean sell (token in, SOL out); token-for-token swaps are ignored
    if (bought && !sold && solIn > 0) {
      const m = String(bought.mint);
      const e = by.get(m) ?? { mint: m, buys: 0, sells: 0, buySol: 0, sellSol: 0, firstAt: ts, lastAt: ts, holding: false };
      e.buys++; e.buySol += solIn; e.firstAt = Math.min(e.firstAt, ts); e.lastAt = Math.max(e.lastAt, ts); by.set(m, e); swaps++;
    } else if (sold && !bought && solOut > 0) {
      const m = String(sold.mint);
      const e = by.get(m) ?? { mint: m, buys: 0, sells: 0, buySol: 0, sellSol: 0, firstAt: ts, lastAt: ts, holding: false };
      e.sells++; e.sellSol += solOut; e.firstAt = Math.min(e.firstAt, ts); e.lastAt = Math.max(e.lastAt, ts); by.set(m, e); swaps++;
    }
  }
  const tokens = [...by.values()].map((t) => ({ ...t, holding: t.buys > 0 && t.sells === 0 })).sort((x, y) => y.lastAt - x.lastAt);
  const v: WalletHistory = { tokens, swaps, fetchedAt: Date.now() };
  cache.set(wallet, { ts: Date.now(), v });
  if (cache.size > 200) cache.clear();
  return v;
}
