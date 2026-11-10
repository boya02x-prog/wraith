// lib/walletAssets.ts  (server only)
// What is this wallet worth right now, and what do tokens look like (name, symbol, picture)? Uses Helius DAS: one call returns the
// SOL balance and every token with its USD value, and token names/pictures come from on-chain metadata, so dead tokens that
// DexScreener has forgotten still get a symbol and a logo.
import { heliusKey, heliusRpcUrl } from "@/lib/heliusSwaps";

type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function rpcUrl(): string | null {
  const k = heliusKey();
  return heliusRpcUrl() ?? (k ? `https://mainnet.helius-rpc.com/?api-key=${k}` : null);
}
async function das(method: string, params: unknown, ms = 8000): Promise<unknown | null> {
  const url = rpcUrl();
  if (!url) return null;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(ms), cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: unknown };
    return j.result ?? null;
  } catch { return null; }
}

export interface Holding { mint: string; symbol: string; image: string | null; amount: number; usd: number }
export interface NetWorth { solBalance: number; solUsd: number; tokensUsd: number; totalUsd: number; holdings: Holding[] }

const nwCache = new Map<string, { ts: number; v: NetWorth | null }>();
export async function walletNetWorth(wallet: string): Promise<NetWorth | null> {
  const hit = nwCache.get(wallet);
  if (hit && Date.now() - hit.ts < 5 * 60_000) return hit.v;
  const r = o(await das("getAssetsByOwner", { ownerAddress: wallet, page: 1, limit: 100, displayOptions: { showFungible: true, showNativeBalance: true } }));
  let v: NetWorth | null = null;
  if (Object.keys(r).length) {
    const nb = o(r.nativeBalance);
    const solBalance = n(nb.lamports) / 1e9;
    const solUsd = n(nb.total_price);
    const holdings: Holding[] = [];
    for (const raw of Array.isArray(r.items) ? r.items : []) {
      const it = o(raw), ti = o(it.token_info), pi = o(ti.price_info);
      const usd = n(pi.total_price);
      const mint = String(it.id ?? "");
      if (!mint || mint === "So11111111111111111111111111111111111111112" || !(usd > 0)) continue;
      const meta = o(o(it.content).metadata), links = o(o(it.content).links);
      holdings.push({ mint, symbol: String(meta.symbol ?? ti.symbol ?? "?").slice(0, 14), image: typeof links.image === "string" ? links.image : null, amount: n(ti.balance) / 10 ** n(ti.decimals), usd });
    }
    holdings.sort((a, b) => b.usd - a.usd);
    const tokensUsd = holdings.reduce((s, h) => s + h.usd, 0);
    v = { solBalance, solUsd, tokensUsd, totalUsd: solUsd + tokensUsd, holdings: holdings.slice(0, 8) };
  }
  nwCache.set(wallet, { ts: Date.now(), v });
  if (nwCache.size > 300) nwCache.clear();
  return v;
}

export interface AssetMeta { symbol: string; name: string; image: string | null }
/** On-chain metadata for up to 100 mints in one call. */
export async function assetMeta(mints: string[]): Promise<Map<string, AssetMeta>> {
  const out = new Map<string, AssetMeta>();
  const ids = [...new Set(mints)].slice(0, 100);
  if (!ids.length) return out;
  const r = await das("getAssetBatch", { ids });
  for (const raw of Array.isArray(r) ? r : []) {
    const it = o(raw);
    if (!it.id) continue;
    const meta = o(o(it.content).metadata), links = o(o(it.content).links);
    const files = Array.isArray(o(it.content).files) ? (o(it.content).files as unknown[]).map(o) : [];
    const image = typeof links.image === "string" ? links.image : typeof files[0]?.uri === "string" ? (files[0].uri as string) : null;
    out.set(String(it.id), { symbol: String(meta.symbol ?? "").trim().slice(0, 14), name: String(meta.name ?? "").trim().slice(0, 40), image });
  }
  return out;
}
