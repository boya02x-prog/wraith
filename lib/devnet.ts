// Server-only: Wraith devnet sandbox (test tokens + fixed-price swaps).
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getDb } from "@/lib/mongoClient";
import { ataOf, createAtaIdempotentIx, createMintIxs, MINT_SPACE } from "@/lib/splLite";

export const DEVNET_RPC = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
export const devnetConnection = () => new Connection(DEVNET_RPC, "confirmed");

export const TEST_TOKEN_DEFS = [
  { symbol: "WFROG", name: "Wraith Frog", priceSol: 0.000002, decimals: 6 },
  { symbol: "WGHOST", name: "Wraith Ghost", priceSol: 0.00001, decimals: 6 },
  { symbol: "WMOON", name: "Wraith Moon", priceSol: 0.0000005, decimals: 6 },
  { symbol: "WDOGE", name: "Wraith Doge", priceSol: 0.00005, decimals: 6 },
];

export async function getTreasury(): Promise<Keypair> {
  const db = await getDb();
  const col = db.collection<{ _id: string; secret: number[] }>("devnet_config");
  const fresh = Keypair.generate();
  await col.updateOne({ _id: "treasury" }, { $setOnInsert: { secret: Array.from(fresh.secretKey) } }, { upsert: true });
  const doc = await col.findOne({ _id: "treasury" });
  return Keypair.fromSecretKey(Uint8Array.from(doc!.secret));
}

/** Top the treasury up from the public devnet faucet when it is low (best effort). */
export async function topUpTreasury(conn: Connection, treasury: Keypair, minSol = 0.5): Promise<number> {
  let bal = await conn.getBalance(treasury.publicKey);
  if (bal < minSol * 1e9) {
    try {
      const sig = await conn.requestAirdrop(treasury.publicKey, 2e9);
      await conn.confirmTransaction(sig, "confirmed");
    } catch (e) {
      console.warn("[devnet] treasury airdrop failed", e);
    }
    bal = await conn.getBalance(treasury.publicKey);
  }
  return bal / 1e9;
}

export interface TestToken { symbol: string; name: string; mint: string; priceSol: number; decimals: number }

export async function ensureTokens(): Promise<{ tokens: TestToken[]; treasury: string; treasurySol: number; error?: string }> {
  const db = await getDb();
  const col = db.collection("devnet_tokens");
  const conn = devnetConnection();
  const treasury = await getTreasury();
  const existing = await col.find({}).toArray();
  const have = new Map(existing.map((t) => [t.symbol as string, t]));
  let treasurySol = (await conn.getBalance(treasury.publicKey)) / 1e9;
  let error: string | undefined;
  for (const def of TEST_TOKEN_DEFS) {
    if (have.has(def.symbol)) continue;
    if (treasurySol < 0.05) treasurySol = await topUpTreasury(conn, treasury, 0.05);
    if (treasurySol < 0.02) {
      error = `Test-token treasury is out of devnet SOL. Send some to ${treasury.publicKey.toBase58()} from faucet.solana.com.`;
      break;
    }
    try {
      const mint = Keypair.generate();
      const rent = await conn.getMinimumBalanceForRentExemption(MINT_SPACE);
      const tx = new Transaction().add(
        ...createMintIxs(treasury.publicKey, mint.publicKey, treasury.publicKey, def.decimals, rent),
        createAtaIdempotentIx(treasury.publicKey, treasury.publicKey, mint.publicKey),
      );
      await sendAndConfirmTransaction(conn, tx, [treasury, mint], { commitment: "confirmed" });
      const doc = { ...def, mint: mint.publicKey.toBase58(), createdAt: Date.now() };
      await col.updateOne({ symbol: def.symbol }, { $setOnInsert: doc }, { upsert: true });
      have.set(def.symbol, doc as unknown as (typeof existing)[number]);
      treasurySol = (await conn.getBalance(treasury.publicKey)) / 1e9;
    } catch (e) {
      console.error("[devnet] create token failed", def.symbol, e);
      error = "Could not create test tokens on devnet right now. Try again in a minute.";
      break;
    }
  }
  const tokens: TestToken[] = TEST_TOKEN_DEFS.flatMap((d) => {
    const t = have.get(d.symbol);
    return t ? [{ symbol: d.symbol, name: d.name, mint: String(t.mint), priceSol: d.priceSol, decimals: d.decimals }] : [];
  });
  return { tokens, treasury: treasury.publicKey.toBase58(), treasurySol, error };
}

export const treasuryAta = (treasury: PublicKey, mint: PublicKey) => ataOf(treasury, mint);
