import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WSOL = "So11111111111111111111111111111111111111112";
const cache = new Map<string, unknown>();

function heliusKey(): string | null {
  const raw = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || process.env.SOLANA_RPC || "";
  try {
    return new URL(raw).searchParams.get("api-key");
  } catch {
    return null;
  }
}

/** Turns a confirmed signature into a buy/sell of `mint` (side, SOL, tokens, trader). */
export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return NextResponse.json({ trade: null }, { status: 400 });
  }
  const key = `${sig}:${mint}`;
  if (cache.has(key)) return NextResponse.json({ trade: cache.get(key) });
  const apiKey = heliusKey();
  if (!apiKey) return NextResponse.json({ trade: null, error: "no-key" }, { status: 503 });
  try {
    const res = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: [sig] }),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ trade: null }, { status: 502 });
    const arr = (await res.json()) as Array<Record<string, any>>;
    const tx = arr?.[0];
    if (!tx || tx.transactionError) return NextResponse.json({ trade: null });
    const payer: string = tx.feePayer;
    const tts: Array<Record<string, any>> = tx.tokenTransfers ?? [];
    const nts: Array<Record<string, any>> = tx.nativeTransfers ?? [];
    let bought = 0;
    let sold = 0;
    for (const t of tts) {
      if (t.mint !== mint) continue;
      if (t.toUserAccount === payer) bought += Number(t.tokenAmount) || 0;
      if (t.fromUserAccount === payer) sold += Number(t.tokenAmount) || 0;
    }
    if (bought === 0 && sold === 0) return NextResponse.json({ trade: null });
    const side = bought > sold ? "buy" : "sell";
    const tokens = side === "buy" ? bought : sold;
    // SOL leg = largest single SOL/wSOL movement out of (buy) or into (sell) the trader; tips/fees are smaller separate transfers.
    let sol = 0;
    for (const n of nts) {
      const amt = (Number(n.amount) || 0) / 1e9;
      if (side === "buy" && n.fromUserAccount === payer) sol = Math.max(sol, amt);
      if (side === "sell" && n.toUserAccount === payer) sol = Math.max(sol, amt);
    }
    for (const t of tts) {
      if (t.mint !== WSOL) continue;
      const amt = Number(t.tokenAmount) || 0;
      if (side === "buy" && t.fromUserAccount === payer) sol = Math.max(sol, amt);
      if (side === "sell" && t.toUserAccount === payer) sol = Math.max(sol, amt);
    }
    if (!(sol > 0) || !(tokens > 0)) return NextResponse.json({ trade: null });
    const trade = { id: sig, side, sol, tokens, wallet: payer, ts: (Number(tx.timestamp) || 0) * 1000 };
    if (cache.size > 500) cache.clear();
    cache.set(key, trade);
    return NextResponse.json({ trade });
  } catch {
    return NextResponse.json({ trade: null }, { status: 502 });
  }
}
