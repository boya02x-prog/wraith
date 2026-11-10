import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSolUsd } from "@/lib/marketProviders";
import { hedgedRpc } from "@/lib/rpcHedge";

export const dynamic = "force-dynamic";

const WSOL = "So11111111111111111111111111111111111111112";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58(buf: Buffer): string {
  const ZERO = BigInt(0);
  const BASE = BigInt(58);
  let n = BigInt("0x" + buf.toString("hex"));
  let out = "";
  while (n > ZERO) { out = B58[Number(n % BASE)] + out; n /= BASE; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}

const RPCS = () =>
  [process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC, "https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"].filter(Boolean) as string[];

// Hedged instead of raced: the keyed endpoint answers on its own almost always, the public ones only start if it is slow or down.
async function rpc(method: string, params: unknown[]): Promise<any> {
  const { data } = await hedgedRpc<{ result?: unknown }>(RPCS(), { jsonrpc: "2.0", id: 1, method, params }, { timeoutMs: 4000, hedgeMs: 500 });
  if (data.result === undefined) throw new Error("rpc error"); // never let an RPC error look like an empty account (it would be cached)
  return data.result;
}

const vaults = new Map<string, { base: string; quote: string } | null>();
const out = new Map<string, { at: number; data: unknown }>();
const curveOut = new Map<string, { at: number; data: string }>();
const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
// these caches are keyed by caller-supplied addresses, so cap them (a loop over random addresses must not grow memory forever)
const MAX_CACHE = 3000;
const trim = (m: Map<string, unknown>) => { if (m.size > MAX_CACHE) m.clear(); };

/**
 * Exact on-chain price for PumpSwap pools: quote(wSOL) vault / base(token) vault.
 * Same source pump.fun / fomo use, so it moves the moment a trade lands (no indexer lag).
 */
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  const pool = req.nextUrl.searchParams.get("pool") ?? "";
  const re = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  // pump.fun bonding-curve price: returns the raw curve account (base64). The page decodes it, so there is no provider key in the browser.
  if (req.nextUrl.searchParams.get("curve") === "1") {
    if (!re.test(mint)) return NextResponse.json({ error: "bad" }, { status: 400 });
    const cached = curveOut.get(mint);
    if (cached && Date.now() - cached.at < 700) return NextResponse.json({ curve: cached.data, at: cached.at }, { headers: { "Cache-Control": "no-store" } });
    try {
      const pda = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBytes()], PUMP_PROGRAM)[0].toBase58();
      const acc = await rpc("getAccountInfo", [pda, { encoding: "base64" }]);
      const data = acc?.value?.data?.[0];
      if (typeof data !== "string") return NextResponse.json({ error: "no-curve" }, { status: 404 });
      trim(curveOut);
      curveOut.set(mint, { at: Date.now(), data });
      return NextResponse.json({ curve: data, at: Date.now() }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "rpc" }, { status: 502 });
    }
  }

  if (!re.test(mint) || !re.test(pool)) return NextResponse.json({ error: "bad" }, { status: 400 });

  const hit = out.get(pool);
  if (hit && Date.now() - hit.at < 700) return NextResponse.json(hit.data);

  try {
    let v = vaults.get(pool);
    if (v === undefined) {
      const acc = await rpc("getAccountInfo", [pool, { encoding: "base64" }]);
      const raw = acc?.value?.data?.[0] ? Buffer.from(acc.value.data[0], "base64") : null;
      v = null;
      if (raw && raw.length >= 203) {
        const baseMint = b58(raw.subarray(43, 75));
        const quoteMint = b58(raw.subarray(75, 107));
        if (baseMint === mint && quoteMint === WSOL) {
          v = { base: b58(raw.subarray(139, 171)), quote: b58(raw.subarray(171, 203)) };
        }
      }
      trim(vaults);
      vaults.set(pool, v);
    }
    if (!v) return NextResponse.json({ error: "unsupported-pool" }, { status: 404 });

    const res = await rpc("getMultipleAccounts", [[v.base, v.quote], { encoding: "jsonParsed" }]);
    const amt = (i: number) => Number(res?.value?.[i]?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
    const baseAmt = amt(0);
    const quoteAmt = amt(1);
    if (!(baseAmt > 0) || !(quoteAmt > 0)) return NextResponse.json({ error: "empty" }, { status: 502 });
    const priceSol = quoteAmt / baseAmt;
    const solUsd = await getSolUsd();
    const data = { priceSol, priceUsd: priceSol * solUsd, solUsd, vaults: v, base: baseAmt, quote: quoteAmt, at: Date.now() };
    trim(out);
    out.set(pool, { at: Date.now(), data });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "rpc" }, { status: 502 });
  }
}
