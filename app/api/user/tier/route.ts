// POST /api/user/tier — verifies the caller's tier on the server and stores it.
// The client may send its wallet address, but never its tier: the tier is derived here from
//   1) the email whitelist, 2) the wallet's on-chain OMEN balance once tiers are live,
//   3) otherwise the launch-control beta switch, and only for a wallet linked to this Privy account.
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPrivySession } from "@/lib/privyAuth";
import { getPrivyClient } from "@/lib/privyServer";
import { getDb } from "@/lib/mongoClient";
import { getOmenRaw, omenConfigured, tierForRaw } from "@/lib/omenBalance";
import { type TierKey } from "@/lib/tiers";
import { getLaunchSettings } from "@/lib/launchSettingsServer";
import { isEmailWhitelisted, isWhitelisted } from "@/lib/whitelist";
import { SOLANA_MINT_RE } from "@/lib/market";

export async function POST(req: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id || !ObjectId.isValid(session.user.id))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { walletAddress?: unknown } = {};
  try { body = await req.json(); } catch { /* wallet is optional */ }
  const wallet = typeof body.walletAddress === "string" && SOLANA_MINT_RE.test(body.walletAddress) ? body.walletAddress : null;

  const db = await getDb();
  const users = db.collection("users");
  const user = await users.findOne({ _id: new ObjectId(session.user.id) });

  let tier: TierKey = "GHOST";
  let balance: string | null = null;
  let source: "whitelist" | "early-access" | "chain" | "none" = "none";

  // The wallet must belong to this account before it is used for ANYTHING. The whitelist check used to trust the address the
  // browser sent, so anyone who knew a whitelisted wallet could claim top tier, and any address could be stored as "their" wallet.
  let walletOwned = false;
  if (wallet) {
    try {
      const privy = getPrivyClient();
      const pu = privy && user?.privyUserId ? await privy.getUser(String(user.privyUserId)) : null;
      walletOwned = Boolean(pu?.linkedAccounts?.some((a) => a.type === "wallet" && "address" in a && a.address === wallet));
    } catch { walletOwned = false; }
  }
  const verifiedWallet = wallet && walletOwned ? wallet : null;

  // Order: whitelist -> real OMEN balance (when tiers are live in launch control) -> beta switch -> GHOST.
  // A holder keeps their real tier (and fee discount) even while the beta switch unlocks tools for everyone.
  const launch = await getLaunchSettings();
  const tiersReady = await omenConfigured();
  if (isEmailWhitelisted(session.user.email) || (verifiedWallet && isWhitelisted(verifiedWallet))) {
    tier = "WRAITH"; source = "whitelist";
  } else if (wallet && tiersReady) {
    if (!walletOwned) return NextResponse.json({ error: "Wallet is not linked to this account" }, { status: 403 });
    try {
      const { raw, decimals } = await getOmenRaw(wallet);
      tier = tierForRaw(raw, decimals);
      balance = (Number(raw) / 10 ** decimals).toString();
      source = "chain";
    } catch {
      // RPC down: keep the last verified tier instead of demoting (or promoting) on a failed read.
      const keep = typeof user?.tier === "string" ? (user.tier as TierKey) : "GHOST";
      return NextResponse.json({ ok: true, tier: keep, stale: true });
    }
  } else if (launch.featuresFree) {
    tier = "WRAITH"; source = "early-access";
  }

  await users.updateOne(
    { _id: new ObjectId(session.user.id) },
    { $set: { tier, tierSource: source, ...(verifiedWallet ? { walletAddress: verifiedWallet } : {}), tierUpdatedAt: new Date() } },
  );
  return NextResponse.json({ ok: true, tier, balance, source });
}
