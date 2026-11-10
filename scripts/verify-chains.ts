/**
 * Read-only check of every chain Wraith moves money on. Sends nothing, signs nothing.
 *   npx tsx scripts/verify-chains.ts
 * 1) each cash token exists on-chain and its decimals match lib/cashTokens.ts
 * 2) each chain RPC answers
 * 3) LI.FI can quote a withdraw route from every chain to every other chain (a dummy sender, so only "is there a route")
 */
import { createPublicClient, http, parseAbi, parseUnits } from "viem";
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.NEXT_PUBLIC_ARC_RPC ||= "https://rpc.mainnet.arc.io";
import { CASH_TOKENS, VIEM_CHAINS, rpcFor, DEPOSIT_CHAINS, lifiSource } from "../lib/cashTokens";
import { NATIVE_ADDR, SOLANA_LIFI_ID } from "../lib/lifi";

const ERC = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const EVM_DUMMY = "0x000000000000000000000000000000000000dEaD";
const SOL_DUMMY = "11111111111111111111111111111112";

const ok = (b: boolean) => (b ? "OK  " : "FAIL");
let fails = 0;
const bad = (m: string) => { fails++; console.log("  FAIL " + m); };

async function tokens() {
  console.log("\n== cash tokens on-chain ==");
  for (const t of CASH_TOKENS) {
    if (t.chain === "solana") {
      const r = await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [t.address] }) }).then((x) => x.json()).catch(() => null);
      const dec = r?.result?.value?.decimals;
      console.log(`${ok(dec === t.decimals)} solana ${t.symbol} decimals on-chain=${dec} config=${t.decimals}`);
      if (dec !== t.decimals) fails++;
      continue;
    }
    const chain = VIEM_CHAINS[t.chain];
    const rpc = rpcFor(chain);
    if (!rpc) { bad(`${t.chain}: no RPC configured`); continue; }
    const pc = createPublicClient({ chain, transport: http(rpc) });
    try {
      const block = await pc.getBlockNumber();
      if (t.native) { console.log(`OK   ${t.chain} ${t.symbol} native (block ${block})`); continue; }
      const [dec, sym] = await Promise.all([
        pc.readContract({ address: t.address as `0x${string}`, abi: ERC, functionName: "decimals" }),
        pc.readContract({ address: t.address as `0x${string}`, abi: ERC, functionName: "symbol" }).catch(() => "?"),
      ]);
      const good = Number(dec) === t.decimals;
      console.log(`${ok(good)} ${t.chain} ${t.symbol} contract symbol=${sym} decimals on-chain=${dec} config=${t.decimals}`);
      if (!good) fails++;
    } catch (e) {
      bad(`${t.chain} ${t.symbol}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

async function routes() {
  console.log("\n== LI.FI withdraw routes (quote only) ==");
  const idOf = (k: string) => (k === "solana" ? SOLANA_LIFI_ID : VIEM_CHAINS[k].id);
  const tok = (k: string) => {
    const d = DEPOSIT_CHAINS.find((c) => c.key === k)!;
    const t = CASH_TOKENS.find((c) => c.chain === k && c.symbol === d.symbol)!;
    const ls = lifiSource({ chain: k, native: !!t.native, address: t.address, decimals: t.decimals });
    return { t: { ...t, decimals: ls.decimals }, addr: ls.native ? NATIVE_ADDR : ls.token };
  };
  const keys = DEPOSIT_CHAINS.map((c) => c.key);
  for (const a of keys) for (const b of keys) {
    if (a === b) continue;
    const from = tok(a), to = tok(b);
    const p = new URLSearchParams({
      fromChain: String(idOf(a)), toChain: String(idOf(b)), fromToken: from.addr, toToken: to.addr,
      fromAmount: parseUnits("20", from.t.decimals).toString(),
      fromAddress: a === "solana" ? SOL_DUMMY : EVM_DUMMY, toAddress: b === "solana" ? SOL_DUMMY : EVM_DUMMY, slippage: "0.01",
    });
    const r = await fetch("https://li.quest/v1/quote?" + p, { headers: { accept: "application/json" } }).then(async (x) => ({ s: x.status, j: await x.json().catch(() => ({})) })).catch(() => ({ s: 0, j: {} as Record<string, unknown> }));
    const j = r.j as { estimate?: { toAmountMin?: string }; message?: string; tool?: string };
    const good = r.s === 200 && !!j.estimate?.toAmountMin;
    console.log(`${ok(good)} ${a} -> ${b}${good ? ` via ${j.tool}` : ` (${r.s}) ${String(j.message ?? "").slice(0, 90)}`}`);
    if (!good) fails++;
    await new Promise((x) => setTimeout(x, 400));
  }
}

(async () => {
  await tokens();
  await routes();
  console.log(fails ? `\n${fails} problem(s)` : "\nall good");
  process.exit(fails ? 1 : 0);
})();
