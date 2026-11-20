import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { walletNetWorth, type Holding } from "@/lib/walletAssets";
import { userWallets } from "@/lib/quests";

// The balance block on someone's profile: what their Solana wallets are worth, how much of it is cash (stablecoins), the tokens they hold, and a
// line of that value over time. Shown ONLY when the trader turned on "Show my balance" (and "Share my trading activity") in Edit profile; their
// own page always shows it to them. Wallet addresses never leave the server. Only Solana wallets are counted for now.
// The history is built by Wraith itself: every look at a profile saves one point per half hour, so the line grows over time (nothing exists
// from before the toggle was switched on).
export const dynamic = "force-dynamic";
export const maxDuration = 25;

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USDG", "PYUSD", "USDS", "DAI"]);
const BUCKET_MS = 30 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[a-f\d]{24}$/i.test(userId)) return NextResponse.json({ enabled: false }, { status: 404 });
  try {
    const db = await getDb();
    const profile = await db.collection("profiles").findOne({ userId }, { projection: { _id: 0, publicTrading: 1, publicBalance: 1 } });
    const viewer = await getPrivySession().catch(() => null);
    const isSelf = !!viewer?.user?.id && viewer.user.id === userId;
    if (!profile || (!isSelf && !(profile.publicTrading === true && profile.publicBalance === true))) {
      return NextResponse.json({ enabled: false, isSelf });
    }

    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < 60_000) return NextResponse.json({ ...(hit.body as object), isSelf });

    const wallets = [...(await userWallets(userId)).sol].slice(0, 3);
    const nets = (await Promise.all(wallets.map((w) => walletNetWorth(w).catch(() => null)))).filter((n): n is NonNullable<typeof n> => !!n);
    if (!nets.length) {
      const body = { enabled: true, wallets: wallets.length, totalUsd: 0, cashUsd: 0, positions: [] as Holding[], series: [] as { t: number; usd: number }[] };
      return NextResponse.json({ ...body, isSelf });
    }

    let solUsd = 0, solAmount = 0;
    const byMint = new Map<string, Holding>();
    for (const n of nets) {
      solUsd += n.solUsd; solAmount += n.solBalance;
      for (const h of n.holdings) {
        const cur = byMint.get(h.mint);
        if (cur) { cur.amount += h.amount; cur.usd += h.usd; } else byMint.set(h.mint, { ...h });
      }
    }
    const all = [...byMint.values()];
    const cashUsd = all.filter((h) => STABLE_SYMBOLS.has(h.symbol.toUpperCase())).reduce((s, h) => s + h.usd, 0);
    const positions: Holding[] = all
      .filter((h) => !STABLE_SYMBOLS.has(h.symbol.toUpperCase()) && h.usd >= 0.5)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 60);
    if (solUsd >= 0.5) positions.unshift({ mint: "So11111111111111111111111111111111111111112", symbol: "SOL", image: null, amount: solAmount, usd: solUsd });
    const totalUsd = nets.reduce((s, n) => s + n.totalUsd, 0);

    // one history point per half hour, a month kept
    const col = db.collection("balance_snapshots");
    const now = Date.now();
    await col.updateOne({ userId, t: Math.floor(now / BUCKET_MS) * BUCKET_MS }, { $set: { usd: totalUsd } }, { upsert: true }).catch(() => undefined);
    void col.deleteMany({ userId, t: { $lt: now - 35 * 86_400_000 } }).catch(() => undefined);
    const series = (await col.find({ userId, t: { $gte: now - 31 * 86_400_000 } }, { projection: { _id: 0, t: 1, usd: 1 } }).sort({ t: 1 }).limit(1600).toArray()) as unknown as { t: number; usd: number }[];

    const body = { enabled: true, wallets: wallets.length, totalUsd, cashUsd, solUsd, positions, series };
    cache.set(userId, { at: now, body });
    if (cache.size > 200) for (const [k, v] of cache) if (now - v.at > 120_000) cache.delete(k);
    return NextResponse.json({ ...body, isSelf }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    console.error("[trader portfolio GET]", error);
    return NextResponse.json({ enabled: false, error: "Could not load the balance." }, { status: 500 });
  }
}
