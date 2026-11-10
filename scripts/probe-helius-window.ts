/**
 * Probe: can the research key read a token's trades inside a time window (getTransactionsForAddress with filters)?
 * Uses one call that already has Gecko candles, so the answer can be compared later.   npx tsx scripts/probe-helius-window.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";

const KEY = (process.env.HELIUS_RESEARCH_KEY ?? "").trim();
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()) as { result?: { data?: unknown[]; paginationToken?: string }; error?: unknown };
}

(async () => {
  const lines = readFileSync("scripts/.pilot/candles.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { addr: string; at: number });
  const pick = lines.find((l) => l.addr.endsWith("pump")) ?? lines[0];
  const t0 = Math.floor(pick.at / 1000);
  const mint = pick.addr;
  const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();
  const dex = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`).then((r) => r.json()).catch(() => []) as { pairAddress?: string; dexId?: string; liquidity?: { usd?: number } }[];
  const pair = dex.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  console.log(`mint ${mint.slice(0, 8)}, call at ${new Date(t0 * 1000).toISOString()}, curve ${curve.slice(0, 8)}, dex pair ${pair?.pairAddress?.slice(0, 8)} (${pair?.dexId})`);
  for (const [name, addr] of [["curve", curve], ["pair", pair?.pairAddress ?? ""]] as const) {
    if (!addr) continue;
    const r = await rpc("getTransactionsForAddress", [addr, { transactionDetails: "signatures", sortOrder: "asc", limit: 1000, filters: { status: "succeeded", blockTime: { gte: t0 - 600, lte: t0 + 86400 } } }]);
    const d = r.result?.data ?? [];
    console.log(`${name}: ${r.error ? "ERROR " + JSON.stringify(r.error).slice(0, 160) : `${d.length} succeeded txs in the window (first page)${r.result?.paginationToken ? ", more pages" : ""}`}`);
  }
})();
