// GET /api/token-age?mint=<solana mint>
// Real launch time of a token. A pool's creation time is NOT the token's age (a graduated pump.fun token's pool is
// created at graduation), so we use, in order of accuracy:
//   1. the oldest on-chain transaction that touches the mint (its creation), found by paging signatures
//   2. the oldest pool across every DEX pair DexScreener knows (lower bound)
// On-chain results never change, so they are stored in MongoDB permanently.
import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { arr, getJson, num, obj } from "@/lib/marketProviders";

const RPCS = [
  ...(process.env.SOLANA_RPC_URL ? [process.env.SOLANA_RPC_URL] : []),
  ...(process.env.NEXT_PUBLIC_SOLANA_RPC ? [process.env.NEXT_PUBLIC_SOLANA_RPC] : []),
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const PAGE = 1000;
const MAX_PAGES = 5;

type Age = { createdAt: number; source: "onchain" | "pairs" };
const mem = new Map<string, { age: Age; ts: number }>();

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      const j = (await res.json()) as { result?: T; error?: unknown };
      if (!j.error && j.result !== undefined) return j.result;
    } catch { /* try the next RPC */ }
  }
  return null;
}

async function oldestPair(mint: string): Promise<number | null> {
  try {
    const data = obj(await getJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, undefined, 5000));
    const times = arr(data.pairs)
      .map(obj)
      .filter((p) => p.chainId === "solana" && obj(p.baseToken).address === mint)
      .map((p) => num(p.pairCreatedAt))
      .filter((n) => n > 0);
    return times.length ? Math.min(...times) : null;
  } catch {
    return null;
  }
}

async function onchainBirth(mint: string): Promise<number | null> {
  type Sig = { signature: string; blockTime?: number | null };
  let before: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const sigs = await rpc<Sig[]>("getSignaturesForAddress", [mint, { limit: PAGE, ...(before ? { before } : {}) }]);
    if (!sigs) return null;
    if (sigs.length < PAGE) {
      const oldest = sigs[sigs.length - 1];
      return oldest?.blockTime ? oldest.blockTime * 1000 : null;
    }
    before = sigs[sigs.length - 1].signature;
  }
  return null; // very busy mint: history too long to walk cheaply
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) return NextResponse.json({ error: "Invalid mint" }, { status: 400 });

  const hot = mem.get(mint);
  if (hot && (hot.age.source === "onchain" || Date.now() - hot.ts < 10 * 60_000)) return edge(NextResponse.json(hot.age), 600, 3600);

  try {
    const db = await getDb();
    const saved = await db.collection("token_birth").findOne({ _id: mint as never });
    if (saved && typeof saved.createdAt === "number") {
      const age: Age = { createdAt: saved.createdAt, source: "onchain" };
      mem.set(mint, { age, ts: Date.now() });
      return edge(NextResponse.json(age), 600, 3600);
    }
  } catch { /* db optional */ }

  const [birth, pair] = await Promise.all([onchainBirth(mint), oldestPair(mint)]);
  // The mint cannot be older than its oldest transaction, and a pool cannot predate the mint: take the earliest sane value.
  if (birth) {
    const createdAt = pair ? Math.min(birth, pair) : birth;
    const age: Age = { createdAt, source: "onchain" };
    mem.set(mint, { age, ts: Date.now() });
    void getDb().then((db) => db.collection("token_birth").updateOne({ _id: mint as never }, { $set: { createdAt, ts: Date.now() } }, { upsert: true })).catch(() => undefined);
    return edge(NextResponse.json(age), 600, 3600);
  }
  if (pair) {
    const age: Age = { createdAt: pair, source: "pairs" };
    mem.set(mint, { age, ts: Date.now() });
    return edge(NextResponse.json(age), 600, 3600);
  }
  return NextResponse.json({ error: "Age unavailable" }, { status: 404 });
}
