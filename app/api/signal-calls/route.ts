import { after, NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE } from "@/lib/market";
import { listCalls, refreshCalls } from "@/lib/signalCalls";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (mint && !SOLANA_MINT_RE.test(mint) && !/^0x[0-9a-fA-F]{40}$/.test(mint)) return NextResponse.json({ calls: [] }, { status: 400 });
  try {
    // the stored calls are returned at once; re-pricing them (a slow job, throttled inside refreshCalls) happens after the answer is sent
    after(() => refreshCalls().catch((e) => console.error("[signal-calls refresh]", e)));
    const calls = await listCalls(mint ? 1 : 120, mint || undefined);
    return edge(NextResponse.json({ calls, updatedAt: Date.now() }), 8, 30);
  } catch (e) {
    console.error("[signal-calls GET]", e);
    return NextResponse.json({ calls: [], error: "Could not load tracked calls." }, { status: 500 });
  }
}
