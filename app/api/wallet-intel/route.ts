// GET /api/wallet-intel?mint= → deployer history + familiar wallets for a Solana token (evidence only, cached 3 min).
import { NextRequest, NextResponse } from "next/server";
import { SOLANA_MINT_RE } from "@/lib/market";
import { walletIntel } from "@/lib/walletIntel";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (!SOLANA_MINT_RE.test(mint)) return NextResponse.json({ error: "Invalid mint" }, { status: 400 });
  try {
    return NextResponse.json(await walletIntel(mint));
  } catch (e) {
    console.warn("[wallet-intel]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
