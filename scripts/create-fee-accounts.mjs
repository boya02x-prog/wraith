// One-time: creates the Wraith treasury's token accounts (WSOL, USDC, USDT) so Jupiter can pay platform fees into them.
// Anyone can pay the rent (~0.006 SOL total); the accounts belong to the fee wallet. Use a throwaway wallet with ~0.01 SOL.
//   PowerShell:  $env:PAYER_SECRET="<base58 secret key>"; node scripts/create-fee-accounts.mjs
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const FEE_WALLET = new PublicKey("FnpcuNmMhGjTLKJLbXTecaCYCKmdCzeA6cg3fkbSz92g");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MINTS = {
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFmCqLMqMHhM9gFm",
};
const secret = process.env.PAYER_SECRET;
if (!secret) { console.error("Set PAYER_SECRET (base58 secret key of a wallet with ~0.01 SOL)."); process.exit(1); }
const payer = Keypair.fromSecretKey(bs58.decode(secret));
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", "confirmed");

for (const [name, m] of Object.entries(MINTS)) {
  const mint = new PublicKey(m);
  const [ata] = PublicKey.findProgramAddressSync([FEE_WALLET.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA);
  if (await conn.getAccountInfo(ata)) { console.log(name, "already exists", ata.toBase58()); continue; }
  const ix = new TransactionInstruction({
    programId: ATA, data: Buffer.from([1]), // CreateIdempotent
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: FEE_WALLET, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
  });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [payer]);
  console.log(name, "created", ata.toBase58(), sig);
}
console.log("Done. Now set SOLANA_FEE_ENABLED=1 in Vercel and redeploy.");
