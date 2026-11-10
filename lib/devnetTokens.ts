// Server-only: sandbox token lookups shared by price / chart / holding checks.
import { getDb } from "@/lib/mongoClient";
import { getSolUsd } from "@/lib/marketProviders";
import { TEST_TOKEN_DEFS } from "@/lib/devnet";

export interface SandboxToken { symbol: string; name: string; mint: string; priceSol: number; decimals: number; createdAt: number }

let cache: { ts: number; list: SandboxToken[] } | null = null;

export async function listSandboxTokens(): Promise<SandboxToken[]> {
  if (cache && Date.now() - cache.ts < 30_000) return cache.list;
  const docs = await (await getDb()).collection("devnet_tokens").find({}).toArray();
  const list: SandboxToken[] = TEST_TOKEN_DEFS.flatMap((d) => {
    const doc = docs.find((x) => x.symbol === d.symbol);
    return doc ? [{ symbol: d.symbol, name: d.name, mint: String(doc.mint), priceSol: d.priceSol, decimals: d.decimals, createdAt: Number(doc.createdAt ?? Date.now()) }] : [];
  });
  if (list.length) cache = { ts: Date.now(), list };
  return list;
}

export async function getSandboxToken(mint: string): Promise<SandboxToken | null> {
  try {
    return (await listSandboxTokens()).find((t) => t.mint === mint) ?? null;
  } catch {
    return null;
  }
}

export async function sandboxSnapshot(t: SandboxToken): Promise<Record<string, unknown>> {
  const solUsd = await getSolUsd();
  const priceUsd = t.priceSol * solUsd;
  const supply = 1_000_000_000;
  const zero = { m5: 0, h1: 0, h6: 0, h24: 0 };
  const z = { buys: 0, sells: 0 };
  return {
    mint: t.mint,
    priceUsd,
    name: t.name,
    symbol: t.symbol,
    description: "Wraith devnet sandbox token. Fixed price, play money.",
    marketCap: priceUsd * supply,
    liquidity: 100_000,
    volume24h: 0,
    buys24h: 0,
    sells24h: 0,
    priceChange: zero,
    dexId: "wraith-sandbox",
    pairCreatedAt: t.createdAt,
    website: null,
    twitter: null,
    telegram: null,
    updatedAt: new Date().toISOString(),
    imageUrl: null,
    pairAddress: null,
    supply,
    volume: zero,
    txns: { m5: z, h1: z, h6: z, h24: z },
    onCurve: false,
    graduated: false,
    curveProgress: null,
    sandbox: true,
  };
}

export function sandboxCandles(priceUsd: number, sec: number, n = 120) {
  const now = Math.floor(Date.now() / 1000 / sec) * sec;
  return Array.from({ length: n }, (_, i) => {
    const t = (now - (n - 1 - i) * sec) * 1000;
    // Fixed-price sandbox token: a flat line.
    return { t, o: priceUsd, h: priceUsd, l: priceUsd, c: priceUsd, v: 0 };
  });
}
