import { NextRequest, NextResponse } from "next/server";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type ParsedInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getDb } from "@/lib/mongoClient";
import { getPrivySession } from "@/lib/privyAuth";
import { getEmbeddedSolanaAddress } from "@/lib/holdingCheck";
import { devnetConnection, getTreasury, TEST_TOKEN_DEFS } from "@/lib/devnet";
import { ataOf, createAtaIdempotentIx, mintToIx } from "@/lib/splLite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function fetchTx(sig: string): Promise<ParsedTransactionWithMeta | null> {
  const conn = devnetConnection();
  for (let i = 0; i < 6; i++) {
    const tx = await conn.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}

// Settles a fixed-price test swap after the user's own devnet transaction confirmed.
export async function POST(req: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: { side?: unknown; mint?: unknown; signature?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const { side, mint, signature } = body;
  if ((side !== "buy" && side !== "sell") || typeof mint !== "string" || typeof signature !== "string" || signature.length < 60 || signature.length > 100) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const db = await getDb();
  const tokenDoc = await db.collection("devnet_tokens").findOne({ mint });
  const def = tokenDoc ? TEST_TOKEN_DEFS.find((d) => d.symbol === tokenDoc.symbol) : null;
  if (!tokenDoc || !def) return NextResponse.json({ error: "Unknown test token." }, { status: 404 });
  const userAddr = await getEmbeddedSolanaAddress(session.user.id);
  if (!userAddr) return NextResponse.json({ error: "No Wraith wallet found." }, { status: 400 });

  const conn = devnetConnection();
  const treasury = await getTreasury();
  const treasuryAddr = treasury.publicKey.toBase58();
  const treasuryTokenAcc = ataOf(treasury.publicKey, new PublicKey(mint)).toBase58();

  const tx = await fetchTx(signature);
  if (!tx || tx.meta?.err) return NextResponse.json({ error: "Transaction not found or failed." }, { status: 400 });
  const ixs = tx.transaction.message.instructions.filter((i): i is ParsedInstruction => "parsed" in i);

  let lamportsIn = 0;
  let rawIn = BigInt(0);
  for (const ix of ixs) {
    const p = ix.parsed as { type?: string; info?: Record<string, unknown> };
    if (side === "buy" && ix.program === "system" && p.type === "transfer" && p.info?.source === userAddr && p.info?.destination === treasuryAddr) {
      lamportsIn += Number(p.info.lamports ?? 0);
    }
    if (side === "sell" && ix.program === "spl-token" && p.type === "transferChecked" && p.info?.authority === userAddr && p.info?.mint === mint && p.info?.destination === treasuryTokenAcc) {
      rawIn += BigInt(String((p.info.tokenAmount as { amount?: string } | undefined)?.amount ?? "0"));
    }
  }

  const decimals = def.decimals;
  try {
    if (side === "buy") {
      if (lamportsIn <= 0) return NextResponse.json({ error: "No payment to the sandbox found in that transaction." }, { status: 400 });
      const tokens = lamportsIn / 1e9 / def.priceSol;
      await db.collection("devnet_trades").insertOne({ _id: signature as unknown as never, userId: session.user.id, side, mint, at: Date.now(), wallet: userAddr, tokens, sol: lamportsIn / 1e9 });
      const raw = BigInt(Math.floor(tokens * 10 ** decimals));
      const userKey = new PublicKey(userAddr);
      const mintKey = new PublicKey(mint);
      const out = new Transaction().add(
        createAtaIdempotentIx(treasury.publicKey, userKey, mintKey),
        mintToIx(mintKey, ataOf(userKey, mintKey), treasury.publicKey, raw),
      );
      const sig = await sendAndConfirmTransaction(conn, out, [treasury], { commitment: "confirmed" });
      return NextResponse.json({ ok: true, tokens, signature: sig });
    }
    if (rawIn <= BigInt(0)) return NextResponse.json({ error: "No token transfer to the sandbox found in that transaction." }, { status: 400 });
    const tokens = Number(rawIn) / 10 ** decimals;
    const payout = Math.floor(tokens * def.priceSol * 1e9);
    const tBal = await conn.getBalance(treasury.publicKey);
    if (tBal < payout + 5_000_000) return NextResponse.json({ error: "The sandbox is low on devnet SOL. Try a smaller sell." }, { status: 503 });
    await db.collection("devnet_trades").insertOne({ _id: signature as unknown as never, userId: session.user.id, side, mint, at: Date.now(), wallet: userAddr, tokens, sol: payout / 1e9 });
    const out = new Transaction().add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: new PublicKey(userAddr), lamports: payout }));
    const sig = await sendAndConfirmTransaction(conn, out, [treasury], { commitment: "confirmed" });
    return NextResponse.json({ ok: true, sol: payout / 1e9, signature: sig });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/duplicate key|E11000/.test(msg)) return NextResponse.json({ error: "That transaction was already settled." }, { status: 409 });
    console.error("[devnet trade]", e);
    return NextResponse.json({ error: "Settlement failed. Try again." }, { status: 500 });
  }
}
