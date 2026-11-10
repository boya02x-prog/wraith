/** Why did the Helius rebuild find no trades for some calls?   npx tsx scripts/probe-helius-parse.ts */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { dexPairs, type PathRec } from "./pathlib";

const KEY = (process.env.HELIUS_RESEARCH_KEY ?? "").trim();
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
type O = Record<string, unknown>;
const o = (v: unknown): O => (v && typeof v === "object" ? (v as O) : {});

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()) as { result?: { data?: O[] }; error?: unknown };
}

(async () => {
  const done = JSON.parse(readFileSync("scripts/.pilot/paths-helius.json", "utf8")) as Record<string, PathRec>;
  const want = process.argv[2]; const bad = Object.values(done).filter((r) => !r.ok && (!want || r.addr.startsWith(want))).slice(0, 2);
  const calls = readFileSync("scripts/.pilot/candles.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { addr: string; at: number });
  const at = new Map(calls.map((c) => [c.addr, c.at]));
  const pairs = await dexPairs(bad.map((b) => b.addr));
  for (const b of bad) {
    const t0 = Math.floor((at.get(b.addr) ?? Date.now()) / 1000);
    const pr = pairs.get(b.addr);
    const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(b.addr).toBuffer()], PUMP)[0].toBase58();
    console.log(`\n=== ${b.addr.slice(0, 8)}  pair ${pr?.pair?.slice(0, 8)} (${pr?.dex})  call ${new Date(t0 * 1000).toISOString()}`);
    for (const [name, addr] of [["curve", curve], ["pair", pr?.pair ?? ""]] as const) {
      if (!addr) continue;
      const r = await rpc("getTransactionsForAddress", [addr, { transactionDetails: "full", encoding: "jsonParsed", maxSupportedTransactionVersion: 1, sortOrder: "asc", limit: 3, filters: { status: "succeeded", blockTime: { gte: t0 - 900, lte: t0 + 86400 } } }]);
      const data = r.result?.data ?? [];
      console.log(`  ${name}: ${r.error ? "ERR " + JSON.stringify(r.error).slice(0, 120) : data.length + " txs"}`);
      for (const d of data.slice(0, 2)) {
        const meta = o(d.meta);
        const keys = (Array.isArray(o(o(d.transaction).message).accountKeys) ? (o(o(d.transaction).message).accountKeys as unknown[]) : []).map((k) => (typeof k === "string" ? k : String(o(k).pubkey)));
        const owners = (arr: unknown) => (Array.isArray(arr) ? (arr as O[]) : []).map((x) => `${String(x.owner).slice(0, 6)}:${String(x.mint).slice(0, 5)}:${o(x.uiTokenAmount).uiAmount}`).join(" ");
        console.log(`    keyIndexOfAddr ${keys.indexOf(addr)}  pre[${owners(meta.preTokenBalances)}]`);
        console.log(`                     post[${owners(meta.postTokenBalances)}]`);
        console.log(`    (looking for owner ${addr.slice(0, 6)})`);
      }
    }
  }
})();
