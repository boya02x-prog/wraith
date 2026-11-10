"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { QRCodeSVG } from "qrcode.react";
import bs58 from "bs58";
import { DEPOSIT_CHAINS } from "@/lib/cashTokens";
import ChainLogo from "@/components/ChainLogo";
import CashLogo from "@/components/CashLogo";
import WithdrawCash from "@/components/WithdrawCash";
import { ArrowLeft, Check, Copy, LoaderCircle } from "lucide-react";

type Screen = "deposit-home" | "deposit-crypto" | "withdraw-amount" | "withdraw-recipient" | "withdraw-done";

export default function EmbeddedWalletTransfers({
  initialTab = "receive",
  onClose,
}: {
  initialTab?: "receive" | "send";
  onClose?: () => void;
}) {
  const { connection } = useConnection();
  const { user } = usePrivy();
  const { wallets, ready } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [screen, setScreen] = useState<Screen>(initialTab === "send" ? "withdraw-amount" : "deposit-home");
  const [balance, setBalance] = useState<number | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [txSig, setTxSig] = useState("");
  const [depChain, setDepChain] = useState("solana");
  const [wAsset, setWAsset] = useState<"cash" | "sol">("cash");
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ddOpen) return;
    const close = (e: MouseEvent) => { if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDdOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setDdOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [ddOpen]);

  const embeddedAccount = useMemo(
    () =>
      user?.linkedAccounts.find(
        (account) =>
          account.type === "wallet" &&
          account.chainType === "solana" &&
          account.walletClientType === "privy",
      ) ?? null,
    [user],
  );
  const address = embeddedAccount?.type === "wallet" ? embeddedAccount.address : null;
  const evmAccount = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "ethereum" && a.walletClientType === "privy");
  const evmAddress = evmAccount?.type === "wallet" ? evmAccount.address : null;
  const dep = DEPOSIT_CHAINS.find((c) => c.key === depChain) ?? DEPOSIT_CHAINS[0];
  const depAddress = dep.key === "solana" ? address : evmAddress;
  const wallet = address ? wallets.find((w) => w.address === address) : undefined;
  const publicKey = useMemo(() => (address ? new PublicKey(address) : null), [address]);

  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    let active = true;
    const refresh = async () => {
      try {
        const lamports = await connection.getBalance(publicKey, "confirmed");
        if (active) setBalance(lamports / LAMPORTS_PER_SOL);
      } catch { /* ignore */ }
    };
    void refresh();
    const t = visibleInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(t); };
  }, [connection, publicKey]);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const setAmountPercent = (pct: number) => {
    if (balance === null) return;
    const available = Math.max(0, balance - 0.01);
    setAmount((available * pct / 100).toFixed(4));
  };

  const sendSol = async () => {
    setError("");
    const parsedAmount = Number(amount);
    let submittedSignature: string | null = null;
    try {
      if (!wallet || !publicKey) throw new Error("Embedded wallet not ready.");
      const destination = new PublicKey(recipient.trim());
      if (destination.equals(publicKey)) throw new Error("Cannot send to yourself.");
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Enter a valid SOL amount.");
      const lamports = Math.round(parsedAmount * LAMPORTS_PER_SOL);
      if (parsedAmount > (balance ?? 0) - 0.01) throw new Error("Not enough SOL. Keep at least 0.01 for fees.");
      setBusy(true);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: publicKey, recentBlockhash: blockhash }).add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: destination, lamports }),
      );
      const result = await signAndSendTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
        wallet,
        chain: "solana:mainnet",
      });
      submittedSignature = bs58.encode(result.signature);
      const confirmation = await connection.confirmTransaction(
        { signature: submittedSignature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (confirmation.value.err) throw new Error("Transaction failed on-chain.");
      setTxSig(submittedSignature);
      setScreen("withdraw-done");
      setRecipient("");
      setAmount("");
      const remaining = await connection.getBalance(publicKey, "confirmed");
      setBalance(remaining / LAMPORTS_PER_SOL);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  };

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

  if (!ready || !address) {
    return (
      <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        {ready ? "Your embedded Solana wallet is being set up." : "Loading wallet…"}
      </div>
    );
  }

  return (
    <div className="ewt-shell">

      {/* DEPOSIT HOME */}
      {screen === "deposit-home" && (
        <div className="ewt-screen">
          <h3 className="ewt-title">Deposit with</h3>
          <button type="button" className="ewt-option" onClick={() => setScreen("deposit-crypto")}>
            <span className="ewt-option-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20"/><path d="M2 12h20"/></svg>
            </span>
            <div className="ewt-option-text">
              <strong>Crypto</strong>
              <span>USDC / USDG on 7 networks</span>
            </div>
            <span className="ewt-chevron">›</span>
          </button>
          <button type="button" className="ewt-option ewt-option-dim">
            <span className="ewt-option-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </span>
            <div className="ewt-option-text">
              <strong>Credit or debit</strong>
              <span>Coming soon!</span>
            </div>
          </button>
        </div>
      )}

      {/* DEPOSIT CRYPTO */}
      {screen === "deposit-crypto" && (
        <div className="ewt-screen">
          <button type="button" className="ewt-back" onClick={() => setScreen("deposit-home")}>
            <ArrowLeft size={14} /> Back
          </button>
          <h3 className="ewt-title">Deposit with crypto</h3>
          <div className="ewt-dd" ref={ddRef}>
            <button type="button" className="ewt-dd-btn" aria-haspopup="listbox" aria-expanded={ddOpen} onClick={() => setDdOpen((o) => !o)}>
              <ChainLogo chain={dep.key} size={20} />
              <span className="ewt-dd-name">{dep.name}</span>
              <span className="ewt-dd-tok"><CashLogo symbol={dep.symbol} size={14} />{dep.symbol}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {ddOpen && (
              <ul className="ewt-dd-list" role="listbox" aria-label="Network">
                {DEPOSIT_CHAINS.map((c) => (
                  <li key={c.key}>
                    <button type="button" role="option" aria-selected={c.key === depChain} className={c.key === depChain ? "on" : ""} onClick={() => { setDepChain(c.key); setCopied(false); setDdOpen(false); }}>
                      <ChainLogo chain={c.key} size={20} />
                      <span className="ewt-dd-name">{c.name}</span>
                      <span className="ewt-dd-tok"><CashLogo symbol={c.symbol} size={14} />{c.symbol}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="ewt-deposit-hint">
            Send any token on the {dep.name} network to this address.<br />
            {dep.min ? `Deposit at least $${dep.min.toFixed(2)} ` : "Send "}<b className="ewt-tokname"><CashLogo symbol={dep.symbol} size={15} />{dep.symbol}</b> to add to your cash balance. Other tokens show up as holdings.
          </p>
          {depAddress ? (
            <>
              <div className="ewt-qr-wrap">
                <QRCodeSVG value={depAddress} size={188} level="M" bgColor="#ffffff" fgColor="#0b0b0d" />
              </div>
              <div className="ewt-address-box">
                <code>{shortAddr(depAddress)}</code>
                <button type="button" className="ewt-copy-btn" onClick={() => { void navigator.clipboard.writeText(depAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }} title="Copy address">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </>
          ) : <p className="ewt-deposit-hint">Wallet for this network isn&apos;t ready yet.</p>}
          {dep.key === "solana" && <p className="ewt-balance-line">SOL balance: {balance === null ? "—" : `${balance.toFixed(5)}`}</p>}
        </div>
      )}

      {/* WITHDRAW — AMOUNT */}
      {(screen === "withdraw-amount" || screen === "withdraw-recipient") && (
        <div className="wd-seg" role="tablist" aria-label="Withdraw asset">
          <button type="button" role="tab" aria-selected={wAsset === "cash"} className={wAsset === "cash" ? "on" : ""} onClick={() => { setWAsset("cash"); setScreen("withdraw-amount"); }}>Cash · USDC</button>
          <button type="button" role="tab" aria-selected={wAsset === "sol"} className={wAsset === "sol" ? "on" : ""} onClick={() => setWAsset("sol")}>SOL</button>
        </div>
      )}
      {screen === "withdraw-amount" && wAsset === "cash" && <WithdrawCash onDone={() => { setScreen("deposit-home"); onClose?.(); }} />}
      {screen === "withdraw-amount" && wAsset === "sol" && (
        <div className="ewt-screen">
          <h3 className="ewt-title">Withdraw SOL</h3>
          <div className="ewt-amount-input-wrap">
            <span className="ewt-currency-sign">◎</span>
            <input
              type="number"
              className="ewt-amount-input"
              placeholder="0.0000"
              value={amount}
              min="0"
              step="0.0001"
              onChange={(e) => { setAmount(e.target.value); setError(""); }}
            />
          </div>
          <div className="ewt-pct-row">
            {[10, 25, 50].map((pct) => (
              <button key={pct} type="button" className="ewt-pct-btn" onClick={() => setAmountPercent(pct)}>{pct}%</button>
            ))}
            <button type="button" className="ewt-pct-btn" onClick={() => setAmountPercent(100)}>Max</button>
          </div>
          <p className="ewt-balance-line">Available: {balance === null ? "—" : `${Math.max(0, balance - 0.01).toFixed(5)} SOL`}</p>
          {error && <p className="ewt-error">{error}</p>}
          <button
            type="button"
            className="ewt-primary-btn"
            disabled={!amount || Number(amount) <= 0}
            onClick={() => {
              setError("");
              const v = Number(amount);
              if (!Number.isFinite(v) || v <= 0) { setError("Enter a valid amount."); return; }
              if (v > (balance ?? 0) - 0.01) { setError("Not enough SOL. Keep at least 0.01 for fees."); return; }
              setScreen("withdraw-recipient");
            }}
          >
            Continue
          </button>
        </div>
      )}

      {/* WITHDRAW — RECIPIENT */}
      {screen === "withdraw-recipient" && (
        <div className="ewt-screen">
          <button type="button" className="ewt-back" onClick={() => setScreen("withdraw-amount")}>
            <ArrowLeft size={14} /> Back
          </button>
          <h3 className="ewt-title">Recipient address</h3>
          <p className="ewt-deposit-hint">Sending <strong>{amount} SOL</strong>. Double-check the address — transfers are irreversible.</p>
          <input
            type="text"
            className="ewt-recipient-input"
            placeholder="Solana wallet address"
            value={recipient}
            onChange={(e) => { setRecipient(e.target.value); setError(""); }}
            spellCheck={false}
            autoComplete="off"
          />
          {error && <p className="ewt-error">{error}</p>}
          <button
            type="button"
            className="ewt-primary-btn"
            disabled={busy || !recipient.trim()}
            onClick={() => void sendSol()}
          >
            {busy ? <><LoaderCircle size={14} className="animate-spin" /> Confirming in wallet…</> : "Review & send SOL"}
          </button>
        </div>
      )}

      {/* WITHDRAW — DONE */}
      {screen === "withdraw-done" && (
        <div className="ewt-screen ewt-done">
          <div className="ewt-done-icon">
            <Check size={28} />
          </div>
          <h3 className="ewt-title">Transfer confirmed</h3>
          <p className="ewt-deposit-hint">Your SOL has been sent successfully.</p>
          {txSig && (
            <a
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ewt-tx-link"
            >
              View on Solscan ↗
            </a>
          )}
          <button
            type="button"
            className="ewt-primary-btn"
            onClick={() => { setScreen("deposit-home"); setTxSig(""); onClose?.(); }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
