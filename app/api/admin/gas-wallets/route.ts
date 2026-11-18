// GET /api/admin/gas-wallets (owner only): the addresses and balances of the two wallets that pay users' gas, so the owner can fund them.
// Addresses are public on-chain anyway; the private keys are never sent.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";
import { evmGasWallet, solanaGasWallet } from "@/lib/gasWallets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getAppSession(req).catch(() => null);
  if (!session?.user?.id || !isQuestAdmin(session.user.id, session.user.email)) return NextResponse.json({ isAdmin: false }, { status: 403 });
  const [solana, evm] = await Promise.all([solanaGasWallet(), evmGasWallet()]);
  return NextResponse.json({ isAdmin: true, solana, evm }, { headers: { "cache-control": "private, no-store" } });
}
