import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { reportQuestTrade } from "@/lib/questTrade";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export class SwapError extends Error {
  code:
    | "NO_WALLET"
    | "INSUFFICIENT_SOL"
    | "NO_ROUTE"
    | "NO_TOKENS"
    | "QUOTE_FAILED"
    | "BUILD_FAILED"
    | "SIGN_REJECTED"
    | "SEND_FAILED"
    | "CONFIRM_TIMEOUT"
    | "UNKNOWN";
  constructor(code: SwapError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "SwapError";
  }
}

export interface QuickBuyResult {
  signature: string;
  outAmount: string;
}

interface JupQuoteResponse {
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
  [key: string]: unknown;
}

export interface SwapWallet {
  publicKey: PublicKey | null;
  signTransaction?: (
    transaction: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
}

/**
 * Fetch a Jupiter quote for buying `outputMint` with `amountSol` SOL.
 * Thrown SwapError codes map directly to user-facing toast copy —
 * see QuickBuyButton's catch block.
 */
export async function getBuyQuote(
  outputMint: string,
  amount: number,
  slippageBps = 100,
  input: { mint: string; decimals: number } = { mint: SOL_MINT, decimals: 9 },
): Promise<JupQuoteResponse> {
  const amountUnits = Math.round(amount * 10 ** input.decimals);
  const params = new URLSearchParams({
    inputMint: input.mint,
    outputMint,
    amount: String(amountUnits),
    slippageBps: String(slippageBps),
  });
  params.set("endpoint", "quote");
  let res: Response;
  try {
    res = await fetch(`/api/jupiter?${params.toString()}`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SwapError("QUOTE_FAILED", "Couldn't reach Jupiter for a quote");
  }
  if (!res.ok) {
    if (res.status === 400) {
      throw new SwapError("NO_ROUTE", "No swap route found for this token");
    }
    throw new SwapError("QUOTE_FAILED", `Quote failed (${res.status})`);
  }
  const data = (await res.json()) as JupQuoteResponse;
  if (!data.routePlan || (data.routePlan as unknown[]).length === 0) {
    throw new SwapError("NO_ROUTE", "No swap route found for this token");
  }
  return data;
}

/**
 * Full quick-buy flow: quote -> build tx -> wallet signs -> send -> confirm.
 * `wallet` is the object returned by useWallet(). `connection` from
 * useConnection(). Checks the wallet's live SOL balance against the
 * requested spend + a small fee buffer before ever hitting Jupiter, so the
 * "Not enough SOL" case is caught immediately and cheaply, same as
 * Telemetry's inline toast.
 */
export async function executeQuickBuy(
  outputMint: string,
  amountSol: number,
  wallet: SwapWallet,
  connection: Connection,
  opts?: { slippageBps?: number; priorityFeeLamports?: number; input?: { mint: string; decimals: number } },
): Promise<QuickBuyResult> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new SwapError("NO_WALLET", "Connect a wallet first");
  }

  // Fee buffer covers network fee + priority fee + rent.
  const input = opts?.input;
  const spendingSol = !input || input.mint === SOL_MINT;
  const FEE_BUFFER_SOL = spendingSol ? 0.01 : 0.0035;
  const balanceLamports = await connection.getBalance(wallet.publicKey);
  const requiredLamports = Math.round((FEE_BUFFER_SOL + (spendingSol ? amountSol : 0)) * 1e9);
  if (balanceLamports < requiredLamports) {
    throw new SwapError(
      "INSUFFICIENT_SOL",
      spendingSol ? "Not enough SOL — lower size or priority fee" : "Solana network fees are paid in SOL. Send about 0.004 SOL (roughly $0.60) to your Solana deposit address, then try again",
    );
  }

  const quote = await getBuyQuote(
    outputMint,
    amountSol,
    opts?.slippageBps ?? 100,
    input,
  );

  let swapRes: Response;
  try {
    swapRes = await fetch("/api/jupiter?endpoint=swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: opts?.priorityFeeLamports ?? "auto",
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new SwapError("BUILD_FAILED", "Couldn't build the swap transaction");
  }
  if (!swapRes.ok) {
    throw new SwapError(
      "BUILD_FAILED",
      `Swap build failed (${swapRes.status})`,
    );
  }
  const { swapTransaction } = (await swapRes.json()) as {
    swapTransaction: string;
  };

  const txBuf = Buffer.from(swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);

  let signed: VersionedTransaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch {
    throw new SwapError("SIGN_REJECTED", "Transaction rejected in wallet");
  }

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 2,
    });
  } catch (e) {
    throw new SwapError(
      "SEND_FAILED",
      e instanceof Error ? e.message : "Failed to send transaction",
    );
  }

  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature, ...latestBlockhash },
      "confirmed",
    );
  } catch {
    // Sent but confirmation timed out — not necessarily a failure, the
    // caller can still show the signature so the user can check an explorer.
    throw new SwapError(
      "CONFIRM_TIMEOUT",
      "Sent, but confirmation timed out — check explorer",
    );
  }

  reportQuestTrade("solana", signature);
  return { signature, outAmount: quote.outAmount };
}

export function explorerUrl(signature: string) {
  return `https://solscan.io/tx/${signature}`;
}

/** Sell a percentage of the connected wallet's token balance back to SOL. */
export async function executeQuickSell(
  inputMint: string,
  percent: number,
  wallet: SwapWallet,
  connection: Connection,
  opts?: { outputMint?: string; slippageBps?: number },
): Promise<QuickBuyResult> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new SwapError("NO_WALLET", "Connect a wallet first");
  }
  const safePercent = Math.min(100, Math.max(1, Math.round(percent)));
  const accounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
    mint: new PublicKey(inputMint),
  }).catch(() => {
    throw new SwapError("NO_TOKENS", "Could not read this wallet's token balance");
  });
  const total = accounts.value.reduce((sum, account) => {
    const raw = account.account.data.parsed.info.tokenAmount.amount;
    try { return sum + BigInt(raw); } catch { return sum; }
  }, BigInt(0));
  const amount = (total * BigInt(safePercent)) / BigInt(100);
  if (amount <= BigInt(0)) throw new SwapError("NO_TOKENS", "No tokens to sell in this wallet");

  const params = new URLSearchParams({
    endpoint: "quote",
    inputMint,
    outputMint: opts?.outputMint ?? SOL_MINT,
    amount: amount.toString(),
    slippageBps: String(Math.min(5000, Math.max(50, Math.round(opts?.slippageBps ?? 500)))),
  });
  let quoteResponse: Response;
  try {
    quoteResponse = await fetch(`/api/jupiter?${params}`, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new SwapError("QUOTE_FAILED", "Couldn't reach Jupiter for a sell quote");
  }
  const quote = await quoteResponse.json().catch(() => null) as JupQuoteResponse | { error?: unknown } | null;
  const quoteError = typeof quote === "object" && quote !== null && "error" in quote && typeof quote.error === "string"
    ? quote.error
    : undefined;
  if (!quoteResponse.ok || !quote || !("routePlan" in quote) || !quote.routePlan?.length) {
    throw new SwapError("NO_ROUTE", quoteError || "No sell route found for this token");
  }

  let swapResponse: Response;
  try {
    swapResponse = await fetch("/api/jupiter?endpoint=swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new SwapError("BUILD_FAILED", "Couldn't build the sell transaction");
  }
  const swap = await swapResponse.json().catch(() => null) as { swapTransaction?: string; error?: string } | null;
  if (!swapResponse.ok || !swap?.swapTransaction) {
    throw new SwapError("BUILD_FAILED", swap?.error || "Couldn't build the sell transaction");
  }

  let signed: VersionedTransaction;
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
    signed = await wallet.signTransaction(transaction);
  } catch {
    throw new SwapError("SIGN_REJECTED", "Transaction rejected in wallet");
  }
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 2 });
  } catch (error) {
    throw new SwapError("SEND_FAILED", error instanceof Error ? error.message : "Failed to send transaction");
  }
  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
  } catch {
    throw new SwapError("CONFIRM_TIMEOUT", "Sent, but confirmation timed out");
  }
  reportQuestTrade("solana", signature);
  return { signature, outAmount: quote.outAmount };
}

