"use client";

import { useCallback, useEffect, useState } from "react";
import { useCash } from "@/lib/cash";
import { getActivePreset } from "@/lib/quickBuyPresets";
import { Zap, Check, X, Loader2 } from "lucide-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { executeQuickBuy, explorerUrl, SwapError } from "@/lib/jupiterSwap";
import { PAPER_SYNC_EVENT, quickPaperBuy } from "@/lib/paperTrading";
import { useToast } from "@/components/Toast";
import { C } from "@/lib/theme";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";


// Map SwapError codes -> toast copy. INSUFFICIENT_SOL matches Telemetry's
// exact wording from your screenshot.
const ERROR_COPY: Record<SwapError["code"], string> = {
  NO_WALLET: "Embedded wallet is not ready yet",
  INSUFFICIENT_SOL: "Not enough balance — lower the quick buy size",
  NO_ROUTE: "No swap route found for this token",
  NO_TOKENS: "No tokens to sell from this wallet",
  QUOTE_FAILED: "Couldn't get a quote — try again",
  BUILD_FAILED: "Couldn't build the swap — try again",
  SIGN_REJECTED: "Transaction rejected in wallet",
  SEND_FAILED: "Failed to send transaction",
  CONFIRM_TIMEOUT: "Sent, but confirmation timed out",
  UNKNOWN: "Something went wrong",
};

interface Props {
  contractAddress: string;
  symbol: string;
  /** Preset SOL amount this button buys, e.g. 0.1. Matches your global quick-buy size setting. */
  amountSol: number;
  /** Compact = MemeScanner row (28px), large = TokenPanel header (40px) */
  size?: "compact" | "large";
}

/** Quick-buy size comes from the active preset in the user's cash currency; converted to SOL for the swap. */
function useQuickSize(fallbackSol: number) {
  const cash = useCash();
  const [cashAmt, setCashAmt] = useState(0);
  useEffect(() => {
    const read = () => setCashAmt(getActivePreset().amounts[0] || 0);
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, []);
  const sol = cashAmt > 0 ? cash.toSol(cashAmt) : null;
  return {
    // while the SOL price is still loading, a cash-sized buy has no SOL amount yet: 0 blocks the click instead of buying the wrong size
    sol: cashAmt > 0 ? (sol && sol > 0 ? Number(sol.toFixed(sol < 0.01 ? 5 : 4)) : 0) : fallbackSol,
    label: cashAmt > 0 ? cash.fmt(cashAmt) : `${fallbackSol} SOL`,
  };
}

type Status = "idle" | "buying" | "success" | "error";

export function QuickBuyButton({
  ...props
}: Props) {
  if (!PRIVY_WALLETS_ENABLED) {
    return <UnconfiguredQuickBuyButton {...props} />;
  }
  return <EmbeddedWalletQuickBuyButton {...props} />;
}

function UnconfiguredQuickBuyButton({
  contractAddress,
  symbol,
  amountSol: fallbackSol,
  size = "compact",
}: Props) {
  const { push } = useToast();
  const quick = useQuickSize(fallbackSol);
  const amountSol = quick.sol;
  const [busy, setBusy] = useState(false);
  const dim = size === "large" ? 38 : 26;
  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (busy) return;
    if (!(amountSol > 0)) { push("Loading price, try again in a second", "warning"); return; }
    if (localStorage.getItem("wraith_paper_mode_v1") === "true") {
      setBusy(true);
      try {
        const result = await quickPaperBuy({
          mint: contractAddress,
          symbol,
          amountSol,
          amountLabel: quick.label,
        });
        push(
          result.message,
          result.ok ? "success" : "warning",
          result.ok ? { timeoutMs: 6000 } : undefined,
        );
      } catch (error) {
        console.error("[quick paper buy]", error);
        push("Paper buy failed. Try again.", "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    push("Embedded live trading is not configured.", "warning");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={busy ? "Submitting paper buy" : `Quick buy ${quick.label}`}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        display: "grid",
        width: dim,
        height: dim,
        placeItems: "center",
        color: "var(--orange-hot)",
        background: "rgba(255,90,31,.1)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        cursor: busy ? "wait" : "pointer",
      }}
    >
      {busy ? <Loader2 size={14} /> : <Zap size={14} fill="currentColor" />}
    </button>
  );
}

function EmbeddedWalletQuickBuyButton({
  contractAddress,
  symbol,
  amountSol: fallbackSol,
  size = "compact",
}: Props) {
  const { push } = useToast();
  const quick = useQuickSize(fallbackSol);
  const amountSol = quick.sol;
  const { user } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { connection } = useConnection();
  const [hover, setHover] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [paperMode, setPaperMode] = useState(false);
  const embeddedAccount = user?.linkedAccounts.find(
    (account) =>
      account.type === "wallet" &&
      account.chainType === "solana" &&
      account.walletClientType === "privy",
  );
  const embeddedWallet =
    embeddedAccount?.type === "wallet"
      ? solanaWallets.find((wallet) => wallet.address === embeddedAccount.address)
      : undefined;
  const publicKey = embeddedAccount?.type === "wallet"
    ? new PublicKey(embeddedAccount.address)
    : null;

  useEffect(() => {
    const syncMode = () =>
      setPaperMode(localStorage.getItem("wraith_paper_mode_v1") === "true");
    syncMode();
    window.addEventListener("wraith:paper-mode-sync", syncMode);
    window.addEventListener("storage", syncMode);
    window.addEventListener(PAPER_SYNC_EVENT, syncMode);
    return () => {
      window.removeEventListener("wraith:paper-mode-sync", syncMode);
      window.removeEventListener("storage", syncMode);
      window.removeEventListener(PAPER_SYNC_EVENT, syncMode);
    };
  }, []);

  const dim = size === "compact" ? 26 : 38;
  const fontSize = size === "compact" ? 11 : 13; // icon size = fontSize + 3

  const handleBuy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // don't also trigger row selection
      if (status === "buying") return;
      if (!(amountSol > 0)) { push("Loading price, try again in a second", "warning"); return; }

      if (paperMode) {
        setStatus("buying");
        try {
          const result = await quickPaperBuy({
            mint: contractAddress,
            symbol,
            amountSol,
            amountLabel: quick.label,
          });
          if (result.ok) {
            setStatus("success");
            push(result.message, "success", { timeoutMs: 6000 });
          } else {
            setStatus("error");
            push(result.message, "warning");
          }
        } catch (error) {
          console.error("[quick paper buy]", error);
          setStatus("error");
          push("Paper buy failed. Try again.", "error");
        } finally {
          window.setTimeout(() => setStatus("idle"), 1600);
        }
        return;
      }

      if (!embeddedWallet || !publicKey) {
        push(
          "Your embedded Solana wallet is still being set up.",
          "warning",
        );
        return;
      }

      setStatus("buying");
      try {
        const wallet = {
          publicKey,
          signTransaction: async (transaction: VersionedTransaction) => {
            const result = await signTransaction({
              transaction: transaction.serialize(),
              wallet: embeddedWallet,
              chain: "solana:mainnet",
            });
            return VersionedTransaction.deserialize(result.signedTransaction);
          },
        };
        const { signature } = await executeQuickBuy(
          contractAddress,
          amountSol,
          wallet,
          connection,
        );
        setStatus("success");
        push(`Bought ${symbol} — ${quick.label}`, "success", {
          actionLabel: "VIEW TX",
          onAction: () => window.open(explorerUrl(signature), "_blank"),
          timeoutMs: 6000,
        });
        setTimeout(() => setStatus("idle"), 1800);
      } catch (err) {
        setStatus("error");
        const code = err instanceof SwapError ? err.code : "UNKNOWN";
        push(
          ERROR_COPY[code],
          code === "INSUFFICIENT_SOL" ? "error" : "warning",
        );
        setTimeout(() => setStatus("idle"), 1200);
      }
    },
    [
      status,
      embeddedWallet,
      publicKey,
      signTransaction,
      connection,
      contractAddress,
      amountSol,
      symbol,
      paperMode,
      push,
    ],
  );

  const isBuying = status === "buying";
  const isSuccess = status === "success";
  const isError = status === "error";

  const activeColor = isSuccess
    ? "#00c47a"
    : isError
      ? "#ff5252"
      : (C.green ?? "#8bc34a");

  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={handleBuy}
      disabled={isBuying}
      title={`${paperMode ? "Paper buy" : "Quick buy"} ${quick.label}`}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        height: dim,
        width: dim,
        minHeight: dim,
        minWidth: dim,
        maxHeight: dim,
        boxSizing: "border-box",
        padding: 0,
        background: isError
          ? "rgba(255,82,82,.12)"
          : hover || isSuccess
            ? `${activeColor}26`
            : "rgba(57,217,138,.09)",
        border: `1px solid ${isError ? "rgba(255,82,82,.4)" : hover || isSuccess ? activeColor + "77" : "rgba(57,217,138,.26)"}`,
        borderRadius: size === "compact" ? 8 : 10,
        color: isError ? "#ff5252" : isSuccess ? "#00c47a" : "#39d98a",
        cursor: isBuying ? "wait" : "pointer",
        transition: "background .15s ease, border-color .15s ease, color .15s ease",
        flexShrink: 0,
        overflow: "hidden",
        whiteSpace: "nowrap" as const,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {isBuying ? (
        <Loader2
          size={fontSize + 3}
          style={{
            animation: "wraithBuySpin 0.6s linear infinite",
            flexShrink: 0,
          }}
        />
      ) : isSuccess ? (
        <Check
          size={fontSize + 3}
          strokeWidth={2.5}
          style={{ flexShrink: 0 }}
        />
      ) : isError ? (
        <X size={fontSize + 3} strokeWidth={2.5} style={{ flexShrink: 0 }} />
      ) : (
        <Zap
          size={fontSize + 3}
          fill="currentColor"
          strokeWidth={0}
          style={{ flexShrink: 0 }}
        />
      )}
      <style>{`
        @keyframes wraithBuySpin { to { transform: rotate(360deg); } }
      `}</style>
    </button>
  );
}
