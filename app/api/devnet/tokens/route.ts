import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { ensureTokens, getTreasury, treasuryAta } from "@/lib/devnet";
import { listSandboxTokens } from "@/lib/devnetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("lite")) {
      // Database-only lookup (no RPC) so ordinary token pages stay fast.
      const list = await listSandboxTokens();
      const tr = (await getTreasury()).publicKey;
      return NextResponse.json({
        tokens: list.map((t) => ({ symbol: t.symbol, name: t.name, mint: t.mint, priceSol: t.priceSol, decimals: t.decimals, treasuryAta: treasuryAta(tr, new PublicKey(t.mint)).toBase58() })),
        treasury: tr.toBase58(),
      });
    }
    const r = await ensureTokens();
    const tr = new PublicKey(r.treasury);
    return NextResponse.json({
      tokens: r.tokens.map((t) => ({ ...t, treasuryAta: treasuryAta(tr, new PublicKey(t.mint)).toBase58() })),
      treasury: r.treasury,
      treasurySol: r.treasurySol,
      error: r.error ?? null,
    });
  } catch (e) {
    console.error("[devnet tokens]", e);
    return NextResponse.json({ tokens: [], error: "Devnet sandbox unavailable right now." }, { status: 500 });
  }
}
