import { after, NextRequest, NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { SOLANA_MINT_RE } from "@/lib/market";
import { listCalls, refreshCalls, type CallRange } from "@/lib/signalCalls";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint") ?? "";
  if (mint && !SOLANA_MINT_RE.test(mint) && !/^0x[0-9a-fA-F]{40}$/.test(mint)) return NextResponse.json({ calls: [] }, { status: 400 });
  try {
    // the stored calls are returned at once; re-pricing them (a slow job, throttled inside refreshCalls) happens after the answer is sent
    after(() => refreshCalls().catch((e) => console.error("[signal-calls refresh]", e)));
    // the whole 7-day record (about 200-300 calls), not only the newest 120: with the cap, a big winner called a few days ago (HOGE, 70x) dropped off the
    // Wins page while the site header and the landing page still counted it
    const r = req.nextUrl.searchParams.get("range");
    const range: CallRange = r === "last" || r === "month" || r === "all" ? r : "week";
    const calls = await listCalls(mint ? 1 : range === "week" ? 600 : 1500, mint || undefined, range);
    return edge(NextResponse.json({ calls, updatedAt: Date.now() }), 8, 30);
  } catch (e) {
    console.error("[signal-calls GET]", e);
    return NextResponse.json({ calls: [], error: "Could not load tracked calls." }, { status: 500 });
  }
}
