// POST /api/quests/trade  { chain: "solana" | "<evm chain id>", tx }
// Called by the app right after a swap confirms. The server checks the trade on-chain before any point is given.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { checkLimit, tradeLimiter } from "@/lib/ratelimit";
import { recordTrade } from "@/lib/quests";

export async function POST(req: NextRequest) {
  const session = await getAppSession(req);
  if (!session?.user?.id) return NextResponse.json({ status: "rejected", message: "Sign in first." }, { status: 401 });
  const { success } = await checkLimit(tradeLimiter, `quest-trade:${session.user.id}`);
  if (!success) return NextResponse.json({ status: "pending", message: "Busy, retrying shortly." }, { status: 429 });
  if (!(await getLaunchSettings()).questsOpen) return NextResponse.json({ status: "rejected", message: "Quests are paused." });
  let body: { chain?: unknown; tx?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const chain = typeof body.chain === "string" || typeof body.chain === "number" ? String(body.chain) : "";
  const tx = typeof body.tx === "string" ? body.tx.trim() : "";
  if (!chain || !tx) return NextResponse.json({ status: "rejected", message: "Missing trade." }, { status: 400 });
  try {
    return NextResponse.json(await recordTrade(session.user.id, chain, tx));
  } catch (e) {
    console.error("[quests trade]", e);
    return NextResponse.json({ status: "pending", message: "Couldn't check the trade yet." }, { status: 500 });
  }
}
