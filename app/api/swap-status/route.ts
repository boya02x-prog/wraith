import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const tx = req.nextUrl.searchParams.get("txHash") ?? "";
  const from = req.nextUrl.searchParams.get("fromChain") ?? "";
  const to = req.nextUrl.searchParams.get("toChain") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx) && !/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(tx)) return NextResponse.json({ error: "bad hash" }, { status: 400 });
  try {
    const res = await fetch(`https://li.quest/v1/status?txHash=${tx}&fromChain=${encodeURIComponent(from)}&toChain=${encodeURIComponent(to)}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
