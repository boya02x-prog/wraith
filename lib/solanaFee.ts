// Server-only. Solana platform fee via Jupiter: tier-based bps injected on the SERVER (the browser can't lower it),
// collected into the treasury's token account for whichever of the pair's mints is SOL/USDC/USDT.
// Turn on with SOLANA_FEE_ENABLED=1 AFTER running scripts/create-fee-accounts.mjs once.
import { PublicKey } from "@solana/web3.js";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";
import { TIERS, FEE_WALLET } from "@/lib/tiers";
import { paidTier } from "@/lib/launchSettingsServer";

export const WSOL = "So11111111111111111111111111111111111111112";
export const FEE_MINTS = [
  WSOL,
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFmCqLMqMHhM9gFm", // USDT
];
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export const solanaFeeEnabled = () => process.env.SOLANA_FEE_ENABLED === "1";

export function feeAta(mint: string): string {
  return PublicKey.findProgramAddressSync([new PublicKey(FEE_WALLET).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()], ATA_PROGRAM)[0].toBase58();
}

/** Which of the pair's mints the fee is taken in (prefer the output side, else the input side). */
export function feeMintFor(inputMint: string, outputMint: string): string | null {
  if (FEE_MINTS.includes(outputMint)) return outputMint;
  if (FEE_MINTS.includes(inputMint)) return inputMint;
  return null;
}

export async function feeBpsForUser(userId: string): Promise<number> {
  try {
    if (!ObjectId.isValid(userId)) return TIERS.GHOST.feeBps;
    const u = await (await getDb()).collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { tier: 1, tierSource: 1 } });
    // Only a server-verified tier (OMEN on-chain or whitelist) lowers the fee. The early-access beta unlocks features, not fees.
    return TIERS[await paidTier(u as { tier?: unknown; tierSource?: unknown } | null)].feeBps;
  } catch { return TIERS.GHOST.feeBps; }
}
