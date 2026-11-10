// POST /api/holdings — every token sitting in the user's Wraith EVM wallet on Base (FOMO-style wallet view).
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createPublicClient, formatEther, formatUnits, getAddress, http, parseAbi } from "viem";
import { base } from "viem/chains";
import { getAppSession } from "@/lib/session";
import { getPrivyClient, verifyPrivyAccessToken } from "@/lib/privyServer";
import { getDb } from "@/lib/mongoClient";
import { CASH_TOKENS } from "@/lib/cashTokens";
import { checkLimit, lightWriteLimiter } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const RPC = process.env.BASE_LOGS_RPC || "https://base-rpc.publicnode.com";
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

interface Holding { address: string; symbol: string; name: string; amount: number; priceUsd: number; valueUsd: number; imageUrl?: string; native?: boolean }

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rl = await checkLimit(lightWriteLimiter, `holdings:${session.user.id}`);
  if (!rl.success) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  try {
    const db = await getDb();
    const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const claims = bearer ? await verifyPrivyAccessToken(bearer) : null;
    const u = (await db.collection("users").findOne({ _id: new ObjectId(session.user.id) })) as { privyUserId?: string } | null;
    const privy = getPrivyClient();
    const pid = claims?.userId ?? u?.privyUserId;
    const pu = privy && pid ? await privy.getUser(pid) : null;
    const acc = pu?.linkedAccounts?.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "ethereum" && "walletClientType" in a && a.walletClientType === "privy");
    const wallet = acc && "address" in acc ? acc.address.toLowerCase() : "";
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return NextResponse.json({ ok: true, holdings: [], wallet: null });

    const pc = createPublicClient({ chain: base, transport: http(RPC) });
    const cash = new Set(CASH_TOKENS.filter((c) => c.chain === "base").map((c) => c.address.toLowerCase()));

    // candidate tokens: indexer first, then anything we've ever traded
    const cand = new Set<string>();
    const ledger = new Set<string>();
    try {
      const r = await fetch(`https://base.blockscout.com/api/v2/addresses/${wallet}/token-balances`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = (await r.json()) as { token?: { address_hash?: string; address?: string; type?: string }; value?: string }[];
        for (const t of j) {
          const a = (t.token?.address_hash ?? t.token?.address ?? "").toLowerCase();
          if (/^0x[0-9a-f]{40}$/.test(a) && (!t.token?.type || t.token.type === "ERC-20") && t.value && t.value !== "0") cand.add(a);
        }
      }
    } catch { /* fall back to ledger */ }
    try {
      const rows = await db.collection("evm_trades").find({ userId: session.user.id, chain: "base" }).project({ address: 1 }).limit(200).toArray();
      for (const r of rows) { const a = String((r as { address?: string }).address ?? "").toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(a)) { cand.add(a); ledger.add(a); } }
    } catch { /* ignore */ }
    // chain scan: every token that ever arrived in this wallet in the last ~6 days (indexers miss new tokens)
    try {
      const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const pad = "0x" + "0".repeat(24) + wallet.slice(2);
      const call = async (from: number, to: number) => {
        for (let a = 0; a < 4; a++) {
          try {
            const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [TRANSFER, null, pad] }] }), signal: AbortSignal.timeout(8000) });
            const j = await r.json();
            if (!j.error && Array.isArray(j.result)) return j.result as { address: string; topics: string[] }[];
          } catch { /* retry */ }
          await new Promise((res) => setTimeout(res, 300 * (a + 1)));
        }
        return [];
      };
      const head = Number(await pc.getBlockNumber());
      for (let b = 0; b < 30; b += 5) {
        const res = await Promise.all(Array.from({ length: 5 }, (_, i) => { const to = head - (b + i) * 9000; return call(to - 8999, to); }));
        for (const logs of res) for (const l of logs) if (l.topics.length === 3) cand.add(l.address.toLowerCase());
      }
    } catch (e) { console.error("[holdings scan]", e); }
    for (const c of cash) cand.delete(c);
    cand.delete("0x4200000000000000000000000000000000000006");

    const list = [...cand].slice(0, 120);
    const bals = await Promise.all(list.map((a) => pc.readContract({ address: getAddress(a), abi: ERC20, functionName: "balanceOf", args: [getAddress(wallet)] }).catch(() => BigInt(0))));
    const held = list.map((a, i) => ({ a, raw: bals[i] })).filter((x) => x.raw > BigInt(0));

    const out: Holding[] = [];
    const eth = await pc.getBalance({ address: getAddress(wallet) }).catch(() => BigInt(0));
    const px = new Map<string, { symbol: string; name: string; price: number; liq: number; img?: string; dec?: number }>();
    const lookup = [...held.map((h) => h.a), "0x4200000000000000000000000000000000000006"];
    for (let i = 0; i < lookup.length; i += 30) {
      try {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/base/${lookup.slice(i, i + 30).join(",")}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const pairs = (await r.json()) as { baseToken: { address: string; symbol: string; name: string }; priceUsd?: string; liquidity?: { usd?: number }; info?: { imageUrl?: string } }[];
        for (const p of pairs) {
          const k = p.baseToken.address.toLowerCase(); const liq = p.liquidity?.usd ?? 0; const cur = px.get(k);
          if (!cur || liq > cur.liq) px.set(k, { symbol: p.baseToken.symbol, name: p.baseToken.name, price: Number(p.priceUsd ?? 0), liq, img: p.info?.imageUrl });
        }
      } catch { /* price optional */ }
    }
    const ethPx = px.get("0x4200000000000000000000000000000000000006")?.price ?? 0;
    const ethAmt = Number(formatEther(eth));
    if (ethAmt * ethPx >= 1) out.push({ address: "native", symbol: "ETH", name: "Ether (Base)", amount: ethAmt, priceUsd: ethPx, valueUsd: ethAmt * ethPx, native: true });

    const decs = await Promise.all(held.map((h) => pc.readContract({ address: getAddress(h.a), abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" }).catch(() => 18)));
    held.forEach((h, i) => {
      const m = px.get(h.a); const amount = Number(formatUnits(h.raw, Number(decs[i])));
      const price = m?.price ?? 0;
      out.push({ address: h.a, symbol: m?.symbol ?? "TOKEN", name: m?.name ?? "", amount, priceUsd: price, valueUsd: amount * price, imageUrl: m?.img });
    });
    // hide worthless / unpriced dust (spam airdrops), keep anything worth at least a cent
    const holdings = out.filter((h) => h.native || h.valueUsd >= 0.01 || (h.priceUsd === 0 && ledger.has(h.address))).sort((a, b) => b.valueUsd - a.valueUsd);
    return NextResponse.json({ ok: true, wallet, holdings });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
