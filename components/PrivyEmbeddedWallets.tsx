"use client";

import { useEffect, useRef } from "react";
import {
  PrivyProvider,
  useCreateWallet as useCreateEthereumWallet,
  useIdentityToken,
  usePrivy,
  useWallets as useEthereumWallets,
} from "@privy-io/react-auth";
import { useCreateWallet as useCreateSolanaWallet } from "@privy-io/react-auth/solana";
import { WraithAuthProvider } from "@/components/SessionProvider";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { defineChain } from "viem";
import { arc, base, bsc, mainnet, monad, robinhood } from "viem/chains";
import { PRIVY_APP_ID, PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import { DEVNET_RPC_PUBLIC } from "@/lib/publicRpc";
// viem ships Arc with no RPC URL, so give Privy one.
const arcWithRpc = defineChain({ ...arc, rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ARC_RPC || "https://rpc.mainnet.arc.io"] } } });
const evmChains = [base, mainnet, bsc, monad, arcWithRpc, robinhood];

// Lets Privy sign for the Testnet tab (Solana devnet).
const DEVNET_HTTP = DEVNET_RPC_PUBLIC; // keyless on purpose: NEXT_PUBLIC_* values are visible to every visitor
const solanaRpcs = {
  "solana:devnet": {
    rpc: createSolanaRpc(DEVNET_HTTP),
    rpcSubscriptions: createSolanaRpcSubscriptions(DEVNET_HTTP.replace(/^http/, "ws")),
    blockExplorerUrl: "https://explorer.solana.com?cluster=devnet",
  },
};

function PrivySessionCookie() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets: ethereumWallets, ready: ethereumWalletsReady } =
    useEthereumWallets();
  const { createWallet: createEthereumWallet } = useCreateEthereumWallet({
    onError: (error) => console.error("[privy ethereum wallet]", error),
  });
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet();
  const creatingForUser = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const syncSessionCookie = async () => {
      if (!authenticated) {
        const response = await fetch("/api/auth/session", {
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("Could not clear the Privy session cookie.");
        }
        return;
      }
      const accessToken = await getAccessToken();
      if (!accessToken) {
        return;
      }
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(
          `Could not establish the app session (${response.status}).`,
        );
      }
    };
    const sync = () => {
      void syncSessionCookie().catch((error) => {
        if (active) console.error("[Privy session cookie]", error);
      });
    };
    sync();
    const interval = window.setInterval(sync, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authenticated, getAccessToken, identityToken, ready]);

  useEffect(() => {
    if (
      !ready ||
      !authenticated ||
      !user?.id ||
      !ethereumWalletsReady ||
      creatingForUser.current === user.id
    ) {
      return;
    }

    const hasEmbeddedEthereumWallet = ethereumWallets.some(
      (wallet) => wallet.walletClientType === "privy",
    );
    const hasEmbeddedSolanaWallet = user.linkedAccounts.some(
      (account) =>
        account.type === "wallet" &&
        account.chainType === "solana" &&
        account.walletClientType === "privy",
    );
    if (hasEmbeddedEthereumWallet && hasEmbeddedSolanaWallet) return;

    creatingForUser.current = user.id;
    void (async () => {
      try {
        if (!hasEmbeddedEthereumWallet) await createEthereumWallet();
        if (!hasEmbeddedSolanaWallet) await createSolanaWallet();
      } catch (error) {
        console.error("[privy embedded wallet creation]", error);
        creatingForUser.current = null;
      }
    })();
  }, [
    authenticated,
    createEthereumWallet,
    createSolanaWallet,
    ethereumWallets,
    ethereumWalletsReady,
    ready,
    user?.id,
  ]);

  return null;
}

export default function PrivyEmbeddedWallets({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!PRIVY_WALLETS_ENABLED || !PRIVY_APP_ID) {
    return <WraithAuthProvider>{children}</WraithAuthProvider>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["google"],
        appearance: {
          theme: "#0a0605",
          accentColor: "#ff7b3d",
          logo: "/logo.png",
          landingHeader: "Sign in to WRAITH",
          loginMessage: "Your account and embedded wallets, secured by Privy.",
        },
        defaultChain: base,
        supportedChains: evmChains,
        solana: { rpcs: solanaRpcs },
        embeddedWallets: {
          showWalletUIs: false, // no Privy confirm popup: Wraith shows its own themed confirmation / toasts
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <WraithAuthProvider>
        <PrivySessionCookie />
        {children}
      </WraithAuthProvider>
    </PrivyProvider>
  );
}
