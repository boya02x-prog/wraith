// POST /api/gas-drip  { chain, address }
// Wraith pays the network gas for cash moves: sends a tiny amount of the chain's gas token from a treasury wallet
// to the user's OWN embedded wallet, only when it is nearly empty. Needs env GAS_TREASURY_KEY (0x private key of a
// wallet you fund with a little ETH/BNB/MON). Without it the route answers 503 and the app falls back to the wallet's own gas.
//
// Concurrency: every limit below (refills per chain, daily budget) is counted from the `gas_drips` ledger, and the old code wrote
// to that ledger only AFTER the transfer confirmed. Firing the request ten times in parallel therefore passed the check ten times
// and sent ten transfers. Now (1) one top-up per account at a time (Mongo lock), (2) the drip is booked in the ledger BEFORE the
// money moves (and removed again if the send fails), and (3) the global budget is re-checked inside a short global lock.
import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createPublicClient, createWalletClient, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPrivySession } from "@/lib/privyAuth";
import { getPrivyClient } from "@/lib/privyServer";
import { getDb } from "@/lib/mongoClient";
import { VIEM_CHAINS, rpcFor } from "@/lib/cashTokens";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { gasDecision, dripCostUsd, dailyBudget } from "@/lib/gasPolicy";
import { acquireLock, releaseLock, withLock } from "@/lib/dbLock";
import { checkLimit, gasDripLimiter } from "@/lib/ratelimit";

const SOL_DRIP_LAMPORTS = Number(process.env.GAS_DRIP_SOLANA_LAMPORTS ?? 4_000_000); // 0.004 SOL (trade code needs 0.0035)

// amount sent per top-up (override with GAS_DRIP_<CHAIN>, e.g. GAS_DRIP_BASE=0.00004)
const DRIP: Record<string, string> = { base: "0.00003", ethereum: "0.0004", bsc: "0.0002", monad: "0.2", robinhood: "0.00003" };

type Session = NonNullable<Awaited<ReturnType<typeof getPrivySession>>>;

/** Book the drip in the ledger before sending. Re-checks the global daily budget under a short global lock. */
async function reserveDrip(db: Db, o: { userId: string; chain: string; address: string }) {
  const out = await withLock(
    db,
    "gas-drip:global",
    8_000,
    async () => {
      const drips = db.collection("gas_drips");
      const day = new Date(Date.now() - 24 * 3600 * 1000);
      const spent = (await drips.find({ at: { $gte: day } }).project({ costUsd: 1 }).toArray()).reduce(
        (s, d) => s + Number((d as { costUsd?: number }).costUsd ?? 0.2),
        0,
      );
      const budget = (await dailyBudget(db)) * 0.15;
      if (spent >= budget) return { ok: false as const, reason: "Free gas is paused for today" };
      const r = await drips.insertOne({
        userId: o.userId,
        address: o.address,
        chain: o.chain,
        costUsd: dripCostUsd(o.chain),
        at: new Date(),
        pending: true,
      });
      return { ok: true as const, id: r.insertedId };
    },
    12,
    150,
  );
  return out.ok ? out.value : { ok: false as const, reason: "Busy right now, try again in a moment" };
}

async function finishDrip(db: Db, id: ObjectId, hash: string) {
  await db.collection("gas_drips").updateOne({ _id: id }, { $set: { hash }, $unset: { pending: "" } });
}
async function bookHash(db: Db, id: ObjectId, hash: string) {
  try { await db.collection("gas_drips").updateOne({ _id: id }, { $set: { hash } }); } catch { /* finishDrip tries again */ }
}
/** Give the reservation back, unless a transaction hash was already booked (then the money may have moved, so it stays counted). */
async function cancelDrip(db: Db, id: ObjectId) {
  try {
    const doc = await db.collection("gas_drips").findOne({ _id: id }, { projection: { hash: 1 } });
    if (!doc?.hash) await db.collection("gas_drips").deleteOne({ _id: id });
  } catch { /* the reservation then simply counts as spent */ }
}

export async function POST(req: NextRequest) {
  const key = process.env.GAS_TREASURY_KEY;
  if (!key) return NextResponse.json({ error: "Gas treasury not configured" }, { status: 503 });
  const session = await getPrivySession(req);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // this route moves real money: if the limiter is down, refuse instead of letting everything through
  const rl = await checkLimit(gasDripLimiter, session.user.id, false);
  if (!rl.success) return NextResponse.json({ error: "Too many top-up requests. Try again later." }, { status: 429 });

  let db: Db;
  try { db = await getDb(); } catch { return NextResponse.json({ error: "Try again shortly" }, { status: 503 }); }

  const lockKey = `gas-drip:${session.user.id}`;
  if (!(await acquireLock(db, lockKey, 150_000))) {
    return NextResponse.json({ error: "A top-up is already in progress." }, { status: 429 });
  }
  try {
    return await drip(req, key, session, db);
  } finally {
    await releaseLock(db, lockKey);
  }
}

async function drip(req: NextRequest, key: string, session: Session, db: Db): Promise<NextResponse> {
  let body: { chain?: unknown; address?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const chainKey = typeof body.chain === "string" ? body.chain : "";
  const address = typeof body.address === "string" ? body.address : "";
  const isSol = chainKey === "solana";
  const chain = VIEM_CHAINS[chainKey]; const rpc = chain ? rpcFor(chain) : null;
  if (isSol) {
    const solKey = process.env.GAS_TREASURY_SOL_KEY;
    if (!solKey) return NextResponse.json({ error: "Solana gas treasury not configured" }, { status: 503 });
    let pk: PublicKey; try { pk = new PublicKey(address); } catch { return NextResponse.json({ error: "Unsupported" }, { status: 400 }); }
    let reservation: ObjectId | null = null;
    try {
      const u = ObjectId.isValid(session.user.id) ? await db.collection("users").findOne({ _id: new ObjectId(session.user.id) }) : null;
      const privy = getPrivyClient();
      const pid = (u as { privyUserId?: string } | null)?.privyUserId;
      const pu = privy && pid ? await privy.getUser(pid) : null;
      const owned = pu?.linkedAccounts?.some((a) => a.type === "wallet" && "address" in a && a.address === address);
      if (!owned) return NextResponse.json({ error: "Wallet is not linked to this account" }, { status: 403 });
      const conn = new Connection(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", "confirmed");
      const bal = await conn.getBalance(pk);
      if (bal >= 3_500_000) return NextResponse.json({ ok: true, skipped: true });
      const evmAddr = pu?.linkedAccounts?.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "ethereum" && "address" in a) as { address?: string } | undefined;
      const d = await gasDecision(db, { userId: session.user.id, chain: "solana", evm: evmAddr?.address ?? null, sol: address });
      if (!d.ok) return NextResponse.json({ error: d.reason }, { status: 429 });
      const r = await reserveDrip(db, { userId: session.user.id, chain: "solana", address });
      if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 429 });
      reservation = r.id;
      const payer = Keypair.fromSecretKey(bs58.decode(solKey));
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pk, lamports: SOL_DRIP_LAMPORTS }));
      const latest = await conn.getLatestBlockhash("confirmed");
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = latest.blockhash;
      tx.sign(payer);
      const sig = await conn.sendRawTransaction(tx.serialize());
      await bookHash(db, reservation, sig); // from here the money may move, so the drip stays on the ledger even if confirming fails
      const conf = await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
      if (conf.value.err) throw new Error("drip transaction failed on chain");
      await finishDrip(db, reservation, sig);
      return NextResponse.json({ ok: true, hash: sig });
    } catch (e) {
      console.warn("[gas-drip solana]", e);
      if (reservation) await cancelDrip(db, reservation);
      return NextResponse.json({ error: "Drip failed" }, { status: 500 });
    }
  }
  const dripStr = process.env[`GAS_DRIP_${chainKey.toUpperCase()}`] ?? DRIP[chainKey];
  if (!chain || !rpc || !dripStr || !isAddress(address)) return NextResponse.json({ error: "Unsupported" }, { status: 400 });

  // the wallet must belong to this account
  let reservation: ObjectId | null = null;
  try {
    const u = ObjectId.isValid(session.user.id) ? await db.collection("users").findOne({ _id: new ObjectId(session.user.id) }) : null;
    const privy = getPrivyClient();
    const pid = (u as { privyUserId?: string } | null)?.privyUserId;
    const pu = privy && pid ? await privy.getUser(pid) : null;
    const owned = pu?.linkedAccounts?.some((a) => a.type === "wallet" && "address" in a && a.address.toLowerCase() === address.toLowerCase());
    if (!owned) return NextResponse.json({ error: "Wallet is not linked to this account" }, { status: 403 });

    const drip = parseEther(dripStr);
    const pc = createPublicClient({ chain, transport: http(rpc) });
    const bal = await pc.getBalance({ address });
    if (bal >= drip / BigInt(2)) return NextResponse.json({ ok: true, skipped: true });

    // limit per account per day
    const solAcc = pu?.linkedAccounts?.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "solana" && "address" in a) as { address?: string } | undefined;
    const d = await gasDecision(db, { userId: session.user.id, chain: chainKey, evm: address, sol: solAcc?.address ?? null });
    if (!d.ok) return NextResponse.json({ error: d.reason }, { status: 429 });
    const r = await reserveDrip(db, { userId: session.user.id, chain: chainKey, address });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 429 });
    reservation = r.id;

    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
    const wc = createWalletClient({ account, chain, transport: http(rpc) });
    const hash = await wc.sendTransaction({ to: address, value: drip });
    await bookHash(db, reservation, hash);
    await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
    await finishDrip(db, reservation, hash);
    return NextResponse.json({ ok: true, hash });
  } catch (e) {
    console.warn("[gas-drip]", e);
    if (reservation) await cancelDrip(db, reservation);
    return NextResponse.json({ error: "Drip failed" }, { status: 500 });
  }
}
