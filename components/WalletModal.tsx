"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const MONO = {
  fontFamily: "'JetBrains Mono', 'Fira Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function WalletModal({ open, onClose }: Props) {
  const { wallet, wallets, select, connect, connecting, connected } =
    useWallet();
  const [hovered, setHovered] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const pendingWalletName = useRef<string | null>(null);

  useEffect(() => {
    if (connected && open) onClose();
  }, [connected, open, onClose]);

  // select() only switches which adapter is "current" in context — it does NOT
  // connect. Wait for `wallet` in context to actually become the one the user
  // clicked, then call the context's own connect(). Calling connect() directly
  // on the raw adapter (old code) raced against the provider's internal
  // autoConnect effect and any errors were silently swallowed.
  useEffect(() => {
    if (
      pendingWalletName.current &&
      wallet?.adapter.name === pendingWalletName.current &&
      !connecting &&
      !connected
    ) {
      const name = pendingWalletName.current;
      pendingWalletName.current = null;
      connect().catch((err) => {
        setConnectError(
          err?.message || `Failed to connect to ${name}. Please try again.`,
        );
      });
    }
  }, [wallet, connecting, connected, connect, pendingWalletName]);

  const handleWalletClick = (adapterWallet: (typeof wallets)[number]) => {
    setConnectError(null);
    pendingWalletName.current = adapterWallet.adapter.name;
    select(adapterWallet.adapter.name);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  // Only "Installed" = truly installed in browser. "Loadable" = NOT installed, just downloadable.
  const installedWallets = wallets.filter((w) => w.readyState === "Installed");
  const notInstalledWallets = wallets.filter(
    (w) => w.readyState !== "Installed",
  );

  // Show installed first, then up to 3 popular not-installed ones
  const popularNotInstalled = notInstalledWallets
    .filter((w) =>
      ["Phantom", "Solflare", "Backpack", "Coinbase Wallet"].includes(
        w.adapter.name,
      ),
    )
    .slice(0, 3);

  const displayWallets =
    installedWallets.length > 0
      ? installedWallets
      : popularNotInstalled.length > 0
        ? popularNotInstalled
        : wallets.slice(0, 4);

  const showNotInstalled =
    installedWallets.length > 0 && popularNotInstalled.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.85)",
          backdropFilter: "blur(4px)",
          zIndex: 999,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 1000,
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          background: "#060606",
          border: "1px solid #e8490f33",
          borderRadius: 10,
          boxShadow: "0 0 60px #e8490f1a, 0 24px 80px #00000088",
          overflow: "hidden",
        }}
      >
        {/* Header glow strip */}
        <div
          style={{
            height: 2,
            background:
              "linear-gradient(90deg, transparent, #e8490f, transparent)",
          }}
        />

        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #111",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  color: "#e8490f",
                  fontSize: 13,
                  fontWeight: 900,
                  letterSpacing: "0.2em",
                  ...MONO,
                }}
              >
                WRAITH
              </span>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#e8490f",
                  boxShadow: "0 0 6px #e8490f",
                  display: "inline-block",
                }}
              />
              <span
                style={{
                  color: "#333",
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  ...MONO,
                }}
              >
                CONNECT WALLET
              </span>
            </div>
            <div style={{ color: "#2a2a2a", fontSize: 10, ...MONO }}>
              {installedWallets.length > 0
                ? `${installedWallets.length} wallet${installedWallets.length > 1 ? "s" : ""} detected`
                : "No wallets detected — install one below"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #1a1a1a",
              color: "#333",
              width: 28,
              height: 28,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: 12,
              ...MONO,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "#e8490f44";
              (e.currentTarget as HTMLElement).style.color = "#e8490f";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "#1a1a1a";
              (e.currentTarget as HTMLElement).style.color = "#333";
            }}
          >
            ✕
          </button>
        </div>

        {/* Wallet list */}
        <div style={{ padding: "12px 16px" }}>
          {connecting && (
            <div
              style={{
                textAlign: "center",
                padding: "24px 0",
                color: "#e8490f",
                fontSize: 11,
                ...MONO,
                letterSpacing: "0.15em",
              }}
            >
              <div style={{ marginBottom: 8 }}>◈ CONNECTING...</div>
              <div style={{ color: "#333", fontSize: 9 }}>
                Approve in your wallet
              </div>
            </div>
          )}

          {!connecting && connectError && (
            <div
              style={{
                background: "#1a0800",
                border: "1px solid #e8490f44",
                borderRadius: 5,
                padding: "8px 12px",
                marginBottom: 12,
                color: "#e8490f",
                fontSize: 10,
                ...MONO,
              }}
            >
              {connectError}
            </div>
          )}

          {!connecting && (
            <>
              {/* Installed wallets */}
              {installedWallets.length === 0 && (
                <div
                  style={{
                    background: "#0d0d0d",
                    border: "1px solid #1a1a1a",
                    borderRadius: 5,
                    padding: "12px",
                    marginBottom: 12,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      color: "#444",
                      fontSize: 10,
                      ...MONO,
                      marginBottom: 4,
                    }}
                  >
                    NO WALLETS INSTALLED
                  </div>
                  <div style={{ color: "#222", fontSize: 9, ...MONO }}>
                    Install a Solana wallet extension to continue
                  </div>
                </div>
              )}

              {installedWallets.length > 0 && (
                <div style={{ marginBottom: showNotInstalled ? 12 : 0 }}>
                  <div
                    style={{
                      color: "#00c47a",
                      fontSize: 8,
                      ...MONO,
                      letterSpacing: "0.14em",
                      marginBottom: 6,
                    }}
                  >
                    ● INSTALLED
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {installedWallets.map((wallet) => {
                      const isHovered = hovered === wallet.adapter.name;
                      return (
                        <button
                          key={wallet.adapter.name}
                          onClick={() => handleWalletClick(wallet)}
                          onMouseEnter={() => setHovered(wallet.adapter.name)}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            background: isHovered ? "#0d0d0d" : "transparent",
                            border: `1px solid ${isHovered ? "#e8490f33" : "#141414"}`,
                            borderRadius: 6,
                            padding: "12px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            cursor: "pointer",
                            width: "100%",
                            transition: "all 0.15s",
                          }}
                        >
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 8,
                              background: "#111",
                              border: `1px solid ${isHovered ? "#e8490f22" : "#1a1a1a"}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              overflow: "hidden",
                            }}
                          >
                            {wallet.adapter.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={wallet.adapter.icon}
                                alt={wallet.adapter.name}
                                width={22}
                                height={22}
                                style={{ borderRadius: 4 }}
                              />
                            ) : (
                              <span style={{ color: "#555", fontSize: 16 }}>
                                ◈
                              </span>
                            )}
                          </div>
                          <div style={{ flex: 1, textAlign: "left" }}>
                            <div
                              style={{
                                color: isHovered ? "#f0f0f0" : "#c0c0c0",
                                fontSize: 13,
                                fontWeight: 700,
                                ...MONO,
                                letterSpacing: "0.04em",
                              }}
                            >
                              {wallet.adapter.name}
                            </div>
                            <div
                              style={{
                                color: "#00c47a",
                                fontSize: 9,
                                ...MONO,
                                marginTop: 1,
                              }}
                            >
                              Detected in browser
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 8,
                              color: "#00c47a",
                              border: "1px solid #00c47a33",
                              padding: "2px 7px",
                              borderRadius: 3,
                              ...MONO,
                              background: "#001a0a",
                              flexShrink: 0,
                            }}
                          >
                            READY
                          </span>
                          {isHovered && (
                            <span
                              style={{
                                color: "#e8490f",
                                fontSize: 11,
                                ...MONO,
                              }}
                            >
                              →
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Not installed — download links */}
              {showNotInstalled && (
                <div>
                  <div
                    style={{
                      color: "#2a2a2a",
                      fontSize: 8,
                      ...MONO,
                      letterSpacing: "0.14em",
                      marginBottom: 6,
                    }}
                  >
                    GET A WALLET
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 5 }}
                  >
                    {popularNotInstalled.map((wallet) => {
                      const isHovered = hovered === wallet.adapter.name + "_ni";
                      const installUrl =
                        wallet.adapter.name === "Phantom"
                          ? "https://phantom.app"
                          : wallet.adapter.name === "Solflare"
                            ? "https://solflare.com"
                            : wallet.adapter.name === "Backpack"
                              ? "https://backpack.app"
                              : "https://solana.com/ecosystem/wallets";
                      return (
                        <a
                          key={wallet.adapter.name}
                          href={installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                          onMouseEnter={() =>
                            setHovered(wallet.adapter.name + "_ni")
                          }
                          onMouseLeave={() => setHovered(null)}
                        >
                          <div
                            style={{
                              background: isHovered ? "#0d0d0d" : "transparent",
                              border: `1px solid ${isHovered ? "#333" : "#111"}`,
                              borderRadius: 6,
                              padding: "9px 14px",
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                background: "#111",
                                border: "1px solid #1a1a1a",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                overflow: "hidden",
                                opacity: 0.5,
                              }}
                            >
                              {wallet.adapter.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={wallet.adapter.icon}
                                  alt={wallet.adapter.name}
                                  width={18}
                                  height={18}
                                  style={{ borderRadius: 3 }}
                                />
                              ) : (
                                <span style={{ color: "#333", fontSize: 12 }}>
                                  ◈
                                </span>
                              )}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  color: "#555",
                                  fontSize: 11,
                                  fontWeight: 600,
                                  ...MONO,
                                }}
                              >
                                {wallet.adapter.name}
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 8,
                                color: "#333",
                                border: "1px solid #1a1a1a",
                                padding: "2px 7px",
                                borderRadius: 3,
                                ...MONO,
                                flexShrink: 0,
                              }}
                            >
                              INSTALL ↗
                            </span>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Edge case: no wallets at all */}
              {installedWallets.length === 0 &&
                popularNotInstalled.length === 0 && (
                  <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
                    <a
                      href="https://phantom.app"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#e8490f",
                        textDecoration: "none",
                        fontSize: 10,
                        border: "1px solid #e8490f33",
                        padding: "8px 18px",
                        borderRadius: 4,
                        display: "inline-block",
                        ...MONO,
                      }}
                    >
                      Get Phantom Wallet ↗
                    </a>
                  </div>
                )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: "1px solid #0d0d0d",
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#1a1a1a", fontSize: 9, ...MONO }}>
            Non-custodial · you control your keys
          </span>
          <span
            style={{
              color: "#e8490f33",
              fontSize: 9,
              ...MONO,
              letterSpacing: "0.1em",
            }}
          >
            SOLANA
          </span>
        </div>
      </div>

      <style>{`
        @keyframes softPulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
      `}</style>
    </>
  );
}
