// GET /api/token-holders?mint= → top 20 holder wallets (owner-resolved, one RPC round trip each) + concentration.
// Server side so the browser never hammers a public RPC with 20+ calls (that is why the tab said "unavailable").
import { NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE } from "@/lib/market";

export const dynamic = "force-dynamic";
const RPCS = [
  ...(process.env.SOLANA_RPC_URL ? [process.env.SOLANA_RPC_URL] : []),
  ...[process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC].filter((u): u is string => !!u),
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const cache = new Map<string, { ts: number; body: unknown }>();

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000), cache: "no-store" });
      const j = (await res.json()) as { result?: T; error?: unknown };
      if (!j.error && j.result !== undefined) return j.result;
    } catch { /* next RPC */ }
  }
  return null;
}


/** Jupiter's own holder list (what its app shows): about 0.1 s, includes names for pools and bonding curves, and the true holder count.
 *  The RPC route below stays as the fallback. */
async function jupiterHolders(mint: string) {
  try {
    const [h, t] = await Promise.all([
      fetch(`https://datapi.jup.ag/v1/holders/${mint}`, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } }),
      fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } }),
    ]);
    if (!h.ok) return null;
    const hj = (await h.json()) as { holders?: { address: string; amount: number; tags?: { name?: string }[] }[]; count?: number };
    const tj = t.ok ? ((await t.json()) as { id?: string; totalSupply?: number; circSupply?: number; holderCount?: number }[]) : [];
    const info = tj.find((x) => x.id === mint);
    const total = Number(info?.totalSupply ?? info?.circSupply ?? 0);
    const rows = (hj.holders ?? []).filter((x) => x.amount > 0);
    if (!rows.length || !(total > 0)) return null;
    const holders = rows.slice(0, 20).map((x) => ({ wallet: x.address, quantity: x.amount, share: (x.amount / total) * 100, label: x.tags?.[0]?.name ?? null }));
    return { holders, top10: holders.slice(0, 10).reduce((a, x) => a + x.share, 0), total, count: hj.count ?? info?.holderCount ?? null };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) return NextResponse.json({ error: "Invalid mint" }, { status: 400 });
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < 30_000) return edge(NextResponse.json(hit.body), 15, 60);

  const fast = await jupiterHolders(mint);
  if (fast) { cache.set(mint, { ts: Date.now(), body: fast }); return edge(NextResponse.json(fast), 15, 60); }

  type Largest = { value: { address: string; amount: string; decimals: number; uiAmount: number | null }[] };
  const [largest, supply] = await Promise.all([
    rpc<Largest>("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]),
    rpc<{ value: { amount: string; decimals: number; uiAmount: number | null } }>("getTokenSupply", [mint, { commitment: "confirmed" }]),
  ]);
  if (!largest || !supply) {
    if (hit) return NextResponse.json({ ...(hit.body as object), stale: true });
    return NextResponse.json({ holders: [], error: "RPC busy" }, { status: 502 });
  }
  const accts = largest.value.slice(0, 20);
  const infos = await rpc<{ value: ({ data?: { parsed?: { info?: { owner?: string } } } } | null)[] }>("getMultipleAccounts", [accts.map((a) => a.address), { encoding: "jsonParsed" }]);
  const total = supply.value.uiAmount ?? Number(supply.value.amount) / 10 ** supply.value.decimals;
  const agg = new Map<string, number>();
  accts.forEach((a, i) => {
    const owner = infos?.value?.[i]?.data?.parsed?.info?.owner ?? a.address;
    agg.set(owner, (agg.get(owner) ?? 0) + (a.uiAmount ?? Number(a.amount) / 10 ** a.decimals));
  });
  const holders = [...agg.entries()].map(([wallet, quantity]) => ({ wallet, quantity, share: total > 0 ? (quantity / total) * 100 : 0 })).sort((a, b) => b.quantity - a.quantity);
  const body = { holders, top10: holders.slice(0, 10).reduce((s, h) => s + h.share, 0), total };
  cache.set(mint, { ts: Date.now(), body });
  return edge(NextResponse.json(body), 15, 60);
}
