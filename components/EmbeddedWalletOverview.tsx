"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  isAddress,
  type Address,
} from "viem";
import { arc, base, bsc, mainnet, monad, robinhood } from "viem/chains";
import { rpcFor } from "@/lib/cashTokens";
import { useCashSources } from "@/lib/useCashSources";
import ChainLogo from "@/components/ChainLogo";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  useExportWallet as useExportEthereumWallet,
  usePrivy,
  useWallets as useEthereumWallets,
} from "@privy-io/react-auth";
import { useExportWallet as useExportSolanaWallet } from "@privy-io/react-auth/solana";
import { Check, Copy, KeyRound, QrCode, ShieldAlert, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type WalletBalance = {
  name: string;
  symbol: string;
  address: string;
  balance: string | null | undefined;
};

const NETWORKS = [base, mainnet, bsc, monad, arc, robinhood];

export default function EmbeddedWalletOverview() {
  const { connection } = useConnection();
  const { wallets: ethereumWallets, ready: ethereumReady } =
    useEthereumWallets();
  const { ready: privyReady, user } = usePrivy();
  const { exportWallet: exportEthereumWallet } = useExportEthereumWallet();
  const { exportWallet: exportSolanaWallet } = useExportSolanaWallet();
  const { sources: cashSources, loaded: cashLoaded } = useCashSources();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportWalletTarget, setExportWalletTarget] =
    useState<WalletBalance | null>(null);
  const [exportAcknowledged, setExportAcknowledged] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [depositNetwork, setDepositNetwork] = useState("evm");
  const [walletSetupMissing, setWalletSetupMissing] = useState<string[] | null>(
    null,
  );
  const embeddedEthereum = useMemo(
    () =>
      user?.linkedAccounts.find(
        (account) =>
          account.type === "wallet" &&
          account.chainType === "ethereum" &&
          account.walletClientType === "privy",
      ) ?? null,
    [user],
  );
  const embeddedSolana = useMemo(
    () =>
      user?.linkedAccounts.find(
        (account) =>
          account.type === "wallet" &&
          account.chainType === "solana" &&
          account.walletClientType === "privy",
      ) ?? null,
    [user],
  );

  useEffect(() => {
    let active = true;
    fetch("/api/auth/privy-status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not check embedded wallet configuration.");
        }
        const result: unknown = await response.json();
        if (
          typeof result !== "object" ||
          result === null ||
          !("missing" in result) ||
          !Array.isArray(result.missing) ||
          !result.missing.every((key) => typeof key === "string")
        ) {
          throw new Error("Embedded wallet status response was invalid.");
        }
        if (active) setWalletSetupMissing(result.missing);
      })
      .catch((error) => {
        console.error("[embedded wallet setup status]", error);
        if (active) setWalletSetupMissing(["PRIVY CONFIGURATION STATUS"]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ethereumReady || !privyReady) return;
    let active = true;

    const evmAddress =
      embeddedEthereum?.type === "wallet" &&
      embeddedEthereum.chainType === "ethereum" &&
      isAddress(embeddedEthereum.address)
        ? (embeddedEthereum.address as Address)
        : null;
    const solAddress =
      embeddedSolana?.type === "wallet" && embeddedSolana.chainType === "solana"
        ? embeddedSolana.address
        : null;

    // Show every wallet immediately; balances fill in as each chain answers.
    const placeholders: WalletBalance[] = [];
    if (solAddress) placeholders.push({ name: "Solana", symbol: "SOL", address: solAddress, balance: undefined });
    if (evmAddress) {
      for (const n of NETWORKS) placeholders.push({ name: n.name, symbol: n.nativeCurrency.symbol, address: evmAddress, balance: undefined });
    }
    setBalances((prev) => (prev.length ? prev : placeholders));
    setLoading(false);

    const setOne = (name: string, balance: string | null) => {
      if (!active) return;
      setBalances((prev) => prev.map((w) => (w.name === name ? { ...w, balance } : w)));
    };
    const withTimeout = <T,>(p: Promise<T>, ms = 8000): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => window.setTimeout(() => rej(new Error("timeout")), ms))]);

    const loadBalances = async () => {
      const jobs: Promise<void>[] = [];
      if (solAddress) {
        jobs.push(
          withTimeout(connection.getBalance(new PublicKey(solAddress)))
            .then((lamports) => setOne("Solana", (lamports / 1_000_000_000).toFixed(5)))
            .catch((error) => {
              console.warn("[embedded wallet balance: Solana]", error);
              setOne("Solana", null);
            }),
        );
      }
      if (evmAddress) {
        for (const network of NETWORKS) {
          const rpc = rpcFor(network);
          if (!rpc) {
            // no RPC configured for this chain (e.g. Arc): show "Unavailable" instead of crashing the loader
            setOne(network.name, null);
            continue;
          }
          jobs.push(
            withTimeout(
              createPublicClient({ chain: network, transport: http(rpc) }).getBalance({ address: evmAddress }),
            )
              .then((value) => setOne(network.name, Number(formatEther(value)).toFixed(5)))
              .catch((error) => {
                console.warn(`[embedded wallet balance: ${network.name}]`, error);
                setOne(network.name, null);
              }),
          );
        }
      }
      await Promise.all(jobs);
    };

    void loadBalances();
    const interval = window.setInterval(() => { if (!document.hidden) void loadBalances(); }, 90_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [connection, embeddedEthereum, embeddedSolana, ethereumReady, privyReady]);

  const hasWallets = Boolean(embeddedEthereum || embeddedSolana);
  // One account, two deposit gateways: a single EVM address (all EVM chains) + Solana.
  const evmGateway = balances.find((w) => w.name !== "Solana") ?? null;
  const solGateway = balances.find((w) => w.name === "Solana") ?? null;
  const gateways: { id: "evm" | "solana"; label: string; wallet: WalletBalance }[] = [];
  if (evmGateway) gateways.push({ id: "evm", label: "EVM chains", wallet: evmGateway });
  if (solGateway) gateways.push({ id: "solana", label: "Solana", wallet: solGateway });
  const totalCash = cashSources.reduce((t, x) => t + x.balance, 0);
  const depositWallet = gateways.find((g) => g.id === depositNetwork)?.wallet;

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setActionError(null);
      window.setTimeout(() => setCopiedAddress(null), 1800);
    } catch (error) {
      console.error("[embedded wallet copy address]", error);
      setActionError("Could not copy the address. Check clipboard permissions.");
    }
  };

  const closeExport = () => {
    setExporting(false);
    setExportDialogOpen(false);
    setExportWalletTarget(null);
    setExportAcknowledged(false);
  };

  const exportWallet = async (wallet: WalletBalance) => {
    if (exporting) return;
    setActionError(null);
    setExporting(true);
    // Close our own dialog first so it never stacks on top of / traps focus
    // away from Privy's secure export iframe.
    setExportDialogOpen(false);
    try {
      if (wallet.name === "Solana") {
        await exportSolanaWallet({ address: wallet.address });
      } else {
        await exportEthereumWallet({ address: wallet.address });
      }
    } catch (error) {
      console.error(`[embedded wallet export: ${wallet.name}]`, error);
      const msg = error instanceof Error ? error.message : "";
      setActionError(
        `Could not open the ${wallet.name} key export${msg ? ` (${msg})` : ""}. In the Privy dashboard, enable wallet export and add this site's origin under allowed origins.`,
      );
    } finally {
      closeExport();
    }
  };

  return (
    <section className="embedded-wallet-overview" aria-label="Embedded wallets">
      <div className="embedded-wallet-overview-heading">
        <div>
          <span className="profile-eyebrow">WRAITH ACCOUNT</span>
          <h3>Your account</h3>
        </div>
        <span className="profile-network-pill">
          {hasWallets ? "EMBEDDED ACCOUNT" : "SETTING UP"}
        </span>
      </div>
      {!hasWallets && (!ethereumReady || !privyReady) ? (
        <p>Loading your account wallets…</p>
      ) : !hasWallets && walletSetupMissing?.length ? (
        <p className="embedded-wallet-setup-error" role="alert">
          Privy is not configured. Missing: {walletSetupMissing.join(", ")}.
        </p>
      ) : !hasWallets ? (
        <p>
          Your account wallets are being prepared. Refresh this page in a moment
          if they do not appear.
        </p>
      ) : (
        <div className="embedded-wallet-balance-list">
          <article className="embedded-wallet-balance ew-total">
            <span className="ew-total-label">Total balance</span>
            <strong className="ew-total-amount">{cashLoaded ? `$${totalCash.toFixed(2)}` : "…"}</strong>
            <small>One account · all chains combined</small>
          </article>
          {cashLoaded && cashSources.length > 0 && (
            <div className="ew-holdings">
              {cashSources.map((x) => (
                <span key={x.id} className="ew-hold">
                  <ChainLogo chain={x.chain} size={14} />
                  {x.chainName} · ${x.balance.toFixed(2)} {x.symbol}
                </span>
              ))}
            </div>
          )}
          <p className="ew-gw-title">Deposit addresses</p>
          {gateways.map((g) => (
            <article key={g.id} className="embedded-wallet-balance ew-gateway">
              <span className="ew-gw-chains">
                {(g.id === "evm"
                  ? ["base", "ethereum", "bsc", "monad", "arc", "robinhood"]
                  : ["solana"]
                ).map((k) => (
                  <ChainLogo key={k} chain={k} size={18} />
                ))}
                <strong>{g.label}</strong>
              </span>
              <code title={g.wallet.address}>{g.wallet.address}</code>
              <div className="embedded-wallet-actions">
                <button
                  type="button"
                  onClick={() => void copyAddress(g.wallet.address)}
                  aria-label={`Copy ${g.label} deposit address`}
                >
                  {copiedAddress === g.wallet.address ? <Check size={14} /> : <Copy size={14} />}
                  {copiedAddress === g.wallet.address ? "Copied" : "Copy"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {hasWallets && balances.length > 0 && (
        <div className="embedded-wallet-overview-actions">
          <button
            type="button"
            className="embedded-wallet-deposit-trigger"
            onClick={() => {
              setDepositNetwork(gateways[0]?.id ?? "evm");
              setDepositDialogOpen(true);
            }}
          >
            <QrCode size={15} />
            Deposit
          </button>
          <button
            type="button"
            className="embedded-wallet-export-trigger"
            onClick={() => {
              setExportWalletTarget(null);
              setExportAcknowledged(false);
              setExportDialogOpen(true);
            }}
          >
            <KeyRound size={15} />
            Export keys
          </button>
        </div>
      )}
      {actionError && (
        <p className="embedded-wallet-action-error" role="alert">
          {actionError}
        </p>
      )}
      <p className="embedded-wallet-overview-note">
        These are just entry points into your one WRAITH account: send from any
        supported chain to the matching address and it all counts toward your
        total balance. Send USDC (USDG on Robinhood Chain) to add cash. Export opens Privy’s secure flow—WRAITH
        never reads or stores your private key. Paper funds remain separate.
      </p>
      {depositDialogOpen && (
        <div
          className="embedded-wallet-export-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDepositDialogOpen(false);
            }
          }}
        >
          <section
            className="embedded-wallet-deposit-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="embedded-wallet-deposit-title"
          >
            <div className="embedded-wallet-export-heading">
              <div>
                <h4 id="embedded-wallet-deposit-title">Deposit to WRAITH</h4>
                <p>Choose the network you are sending from.</p>
              </div>
              <button
                type="button"
                aria-label="Close deposit dialog"
                onClick={() => setDepositDialogOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="embedded-wallet-deposit-networks" role="group" aria-label="Deposit network">
              {gateways.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className={depositNetwork === g.id ? "is-active" : ""}
                  aria-pressed={depositNetwork === g.id}
                  onClick={() => setDepositNetwork(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {depositWallet ? (
              <>
                <div className="embedded-wallet-deposit-qr">
                  <QRCodeSVG
                    value={depositWallet.address}
                    size={176}
                    level="M"
                    includeMargin
                  />
                </div>
                <div className="embedded-wallet-deposit-address">
                  <span>{depositNetwork === "evm" ? "EVM address" : "Solana address"}</span>
                  <code>{depositWallet.address}</code>
                  <button
                    type="button"
                    onClick={() => void copyAddress(depositWallet.address)}
                  >
                    {copiedAddress === depositWallet.address ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}
                    {copiedAddress === depositWallet.address
                      ? "Copied"
                      : "Copy address"}
                  </button>
                </div>
                <p className="embedded-wallet-deposit-warning" role="note">
                  {depositNetwork === "evm" ? (
                    <>Works on <strong>Base, Ethereum, BNB Chain, Monad, Arc and Robinhood Chain</strong>. Send <strong>USDC</strong> (USDG on Robinhood Chain). Do not send from Solana to this address.</>
                  ) : (
                    <>Send only <strong>USDC</strong> on <strong>Solana</strong>. Using a different network can permanently lose your funds.{process.env.NEXT_PUBLIC_SOL_GAS_FREE === "1" ? null : <> Solana network fees are paid in SOL, so also send about <strong>0.004 SOL</strong> (roughly $0.60) to this address.</>}</>
                  )}
                </p>
              </>
            ) : (
              <p className="embedded-wallet-deposit-warning" role="status">
                {loading
                  ? "Loading your wallet address…"
                  : "No deposit address is available."}
              </p>
            )}
          </section>
        </div>
      )}
      {exportDialogOpen && (
        <div
          className="embedded-wallet-export-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeExport();
            }
          }}
        >
          <section
            className="embedded-wallet-export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="embedded-wallet-export-title"
          >
            <div className="embedded-wallet-export-heading">
              <h4 id="embedded-wallet-export-title">
                {exportWalletTarget ? "Export wallet key" : "Choose an address"}
              </h4>
              <button
                type="button"
                aria-label="Close export dialog"
                onClick={closeExport}
              >
                <X size={17} />
              </button>
            </div>
            {!exportWalletTarget ? (
              <div className="embedded-wallet-export-list">
                {gateways.map((g) => (
                  <button
                    type="button"
                    key={g.id}
                    onClick={() => {
                      setExportWalletTarget(g.wallet);
                      setExportAcknowledged(false);
                    }}
                  >
                    <span>{g.label}</span>
                    <code>{g.wallet.address}</code>
                  </button>
                ))}
              </div>
            ) : (
              <div className="embedded-wallet-export-warning">
                <p>
                  <ShieldAlert size={17} />
                  Anyone with this private key can control all funds at this
                  address. Never share it or enter it into an untrusted site.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={exportAcknowledged}
                    onChange={(event) =>
                      setExportAcknowledged(event.target.checked)
                    }
                  />
                  I understand the risks and want to continue.
                </label>
                <button
                  type="button"
                  disabled={!exportAcknowledged || exporting}
                  onClick={() => void exportWallet(exportWalletTarget)}
                >
                  {exporting ? "Opening secure export…" : "Continue to Privy"}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
