// GET /api/evm-token?address=0x…&chain=base  (chain optional: resolved by deepest pool)
import { NextRequest, NextResponse } from "next/server";
import { getEvmSnapshot } from "@/lib/evmData";
import { EVM_ADDR_RE } from "@/lib/chains";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const chain = req.nextUrl.searchParams.get("chain");
  if (!EVM_ADDR_RE.test(address)) return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  try {
    const snap = await getEvmSnapshot(address, chain);
    if (!snap) return NextResponse.json({ error: "No market found for this token yet." }, { status: 404 });
    return NextResponse.json(snap);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Provider error" }, { status: 502 });
  }
}
