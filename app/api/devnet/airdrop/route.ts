import { NextResponse } from "next/server";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { getEmbeddedSolanaAddress } from "@/lib/holdingCheck";
import { devnetConnection, getTreasury } from "@/lib/devnet";
import { acquireLock, releaseLock } from "@/lib/dbLock";
import { airdropLimiter, checkLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const COOLDOWN_MS = 5 * 60_000;
const MAX_PER_DAY = 8; // per account, so a script cannot loop the faucet around the clock

// Free devnet SOL for the signed-in user's Wraith wallet.
export async function POST() {
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const rl = await checkLimit(airdropLimiter, session.user.id, false);
  if (!rl.success) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  const address = await getEmbeddedSolanaAddress(session.user.id);
  if (!address) return NextResponse.json({ error: "No Wraith wallet found." }, { status: 400 });
  const db = await getDb();
  // The cooldown is only written after the transfer, so parallel requests used to all pass it. One request per account at a time.
  const lockKey = `airdrop:${session.user.id}`;
  if (!(await acquireLock(db, lockKey, 90_000))) return NextResponse.json({ error: "An airdrop is already in progress." }, { status: 429 });
  try {
    return await airdrop(session.user.id, address, db);
  } finally {
    await releaseLock(db, lockKey);
  }
}

async function airdrop(userId: string, address: string, db: Awaited<ReturnType<typeof getDb>>) {
  const col = db.collection("devnet_faucet");
  const last = await col.findOne({ userId });
  if (last && Date.now() - (last.lastAt as number) < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (Date.now() - (last.lastAt as number))) / 1000);
    return NextResponse.json({ error: `Try again in ${wait}s.` }, { status: 429 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = last && last.day === today ? Number(last.count ?? 0) : 0;
  if (usedToday >= MAX_PER_DAY) return NextResponse.json({ error: "Daily devnet faucet limit reached. Try again tomorrow." }, { status: 429 });
  const conn = devnetConnection();
  const to = new PublicKey(address);
  let signature: string | null = null;
  try {
    const sig = await conn.requestAirdrop(to, 1e9);
    await conn.confirmTransaction(sig, "confirmed");
    signature = sig;
  } catch (e) {
    console.warn("[devnet airdrop] public faucet failed, trying treasury", e);
  }
  if (!signature) {
    try {
      const treasury = await getTreasury();
      const bal = await conn.getBalance(treasury.publicKey);
      if (bal > 1.2e9) {
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: to, lamports: 5e8 }));
        signature = await sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
      }
    } catch (e) {
      console.warn("[devnet airdrop] treasury grant failed", e);
    }
  }
  if (!signature) {
    return NextResponse.json({ error: "The devnet faucet is rate-limited right now. Try faucet.solana.com with your wallet address.", address }, { status: 503 });
  }
  await col.updateOne({ userId }, { $set: { lastAt: Date.now(), address, day: today, count: usedToday + 1 } }, { upsert: true });
  return NextResponse.json({ ok: true, signature, address });
}
