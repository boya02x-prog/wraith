// lib/fee.ts
import {
  Transaction,
  SystemProgram,
  PublicKey,
  Connection,
} from "@solana/web3.js";

export const FEE_WALLET = new PublicKey("YOUR_TREASURY_WALLET");


// Or percentage-based (1%)
export function calcFee(tradeAmountLamports: number) {
  return Math.floor(tradeAmountLamports * 0.01);
}

export function addFeeInstruction(
  tx: Transaction,
  userPubkey: PublicKey,
  tradeAmountLamports: number,
) {
  tx.add(
    SystemProgram.transfer({
      fromPubkey: userPubkey,
      toPubkey: FEE_WALLET,
      lamports: calcFee(tradeAmountLamports),
    }),
  );
  return tx;
}
