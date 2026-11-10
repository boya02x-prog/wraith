"use client";

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useMemo,
} from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { PublicKey } from "@solana/web3.js";
import { useWraithSession } from "@/components/SessionProvider";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import {
  WRAITH_MINT,
  getTierFromBalance,
  canUse,
  TIERS,
  type TierKey,
} from "@/lib/tiers";
import {
  isEmailWhitelisted,
  isWhitelisted,
  getTierOverride,
} from "@/lib/whitelist";
import { useLaunchSettings } from "@/hooks/useLaunchSettings";
import { MINT_RE } from "@/lib/launchSettings";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WraithTierState {
  tier: (typeof TIERS)[TierKey];
  rawBalance: number;
  loading: boolean;
  /** Every tool is unlocked because the launch-control beta switch is on. */
  isWhitelistMember: boolean;
  /** True when access comes from the beta switch rather than a whitelist or real OMEN. Fees stay at the real tier. */
  earlyAccess: boolean;
  canUse: (feature: string) => boolean;
  refresh: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const WraithTierContext = createContext<WraithTierState | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function WraithTierProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!PRIVY_WALLETS_ENABLED) {
    return (
      <UnavailableWalletTierProvider>{children}</UnavailableWalletTierProvider>
    );
  }
  return <EmbeddedWalletTierProvider>{children}</EmbeddedWalletTierProvider>;
}

function EmbeddedWalletTierProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { connection } = useConnection();
  const { data: session, status } = useWraithSession();
  const { ready: privyReady, authenticated, user, getAccessToken } = usePrivy();
  const embeddedSolana = user?.linkedAccounts.find(
    (account) =>
      account.type === "wallet" &&
      account.chainType === "solana" &&
      account.walletClientType === "privy",
  );
  const walletAddress =
    embeddedSolana?.type === "wallet" ? embeddedSolana.address : null;
  const publicKey = useMemo(
    () => (walletAddress ? new PublicKey(walletAddress) : null),
    [walletAddress],
  );

  const { settings: launch } = useLaunchSettings();
  const liveMint = launch.tiersLive ? launch.omenMint || WRAITH_MINT : "";
  const omenMint = MINT_RE.test(liveMint) ? liveMint : "";

  const [rawBalance, setRawBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isWalletWhitelistMember, setIsWalletWhitelistMember] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!privyReady) {
      setLoading(true);
      return;
    }
    if (!authenticated) {
      setRawBalance(0);
      setIsWalletWhitelistMember(false);
      setLoading(false);
      return;
    }
    if (!publicKey) {
      setRawBalance(0);
      setIsWalletWhitelistMember(false);
      setLoading(false);
      return;
    }

    const walletStr = publicKey.toString();

    // Whitelist check — skip RPC entirely, force WRAITH
    if (isWhitelisted(walletStr)) {
      setIsWalletWhitelistMember(true);
      setRawBalance(0);
      setLoading(false);
      return;
    }

    setIsWalletWhitelistMember(false);

    // Tiers not live yet (or no mint set in launch control): skip RPC
    if (!omenMint) {
      setRawBalance(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const mintPubkey = new PublicKey(omenMint);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: mintPubkey },
      );

      const balance = tokenAccounts.value.reduce((sum, acc) => {
        const amount =
          acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        return sum + amount;
      }, 0);

      setRawBalance(balance);
    } catch (err) {
      console.error("[WraithTier] Failed to fetch balance:", err);
      setRawBalance(0);
    } finally {
      setLoading(false);
    }
  }, [authenticated, connection, privyReady, publicKey, omenMint]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // ─── Tier resolution priority ────────────────────────────────────────────
  // 1. WHITELISTED_WALLETS → always WRAITH
  // 2. WALLET_TIER_OVERRIDES → forced tier (for testing)
  // 3. Token balance → computed tier
  const walletStr = publicKey?.toString() ?? null;
  const tierOverride = getTierOverride(walletStr);
  const realWhitelist = isWalletWhitelistMember || isEmailWhitelisted(session?.user?.email);
  // Beta switch: every tool unlocked, but the shown tier (and its fee) stays the real one.
  const isWhitelistMember = launch.featuresFree || realWhitelist;
  const earlyAccess = launch.featuresFree && !realWhitelist;

  const tier = realWhitelist
    ? TIERS.WRAITH
    : tierOverride
      ? TIERS[tierOverride]
      : getTierFromBalance(rawBalance);

  // ─── Sync tier to MongoDB so alert broadcaster knows who to send to ──────
  useEffect(() => {
    if (status !== "authenticated" || !privyReady || !authenticated) return;
    if (loading) return;
    const tierKey = tier.key;
    let cancelled = false;
    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken || cancelled) return;
        const sessionResponse = await fetch("/api/auth/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!sessionResponse.ok) {
          throw new Error(
            `Could not refresh the authenticated session (${sessionResponse.status}).`,
          );
        }
        if (cancelled) return;
        const res = await fetch("/api/user/tier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tier: tierKey,
            walletAddress: walletStr ?? undefined,
          }),
        });
        if (!res.ok && !cancelled) {
          console.warn("[WraithTier] Tier sync rejected:", res.status);
        }
      } catch (error) {
        console.error("[WraithTier] Failed to sync tier:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    getAccessToken,
    authenticated,
    tier.key,
    status,
    loading,
    isWhitelistMember,
    walletStr,
    privyReady,
  ]);

  const canUseFeature = useCallback(
    (feature: string) => {
      if (isWhitelistMember) return true;
      return canUse(tier, feature);
    },
    [tier, isWhitelistMember],
  );

  return (
    <WraithTierContext.Provider
      value={{
        tier,
        rawBalance,
        loading,
        isWhitelistMember,
        earlyAccess,
        canUse: canUseFeature,
        refresh: fetchBalance,
      }}
    >
      {children}
    </WraithTierContext.Provider>
  );
}

function UnavailableWalletTierProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useWraithSession();
  const { settings: launch } = useLaunchSettings();
  const realWhitelist =
    status === "authenticated" && isEmailWhitelisted(session?.user?.email);
  const isWhitelistMember = realWhitelist || (status === "authenticated" && launch.featuresFree);
  const earlyAccess = isWhitelistMember && !realWhitelist;
  const tier = realWhitelist ? TIERS.WRAITH : TIERS.GHOST;
  const canUseFeature = useCallback(
    (feature: string) => isWhitelistMember || canUse(tier, feature),
    [isWhitelistMember, tier],
  );
  const refresh = useCallback(() => {}, []);

  useEffect(() => {
    if (status !== "authenticated" || !isWhitelistMember) return;
    // The server decides the tier (whitelist or beta switch); this just asks it to record it.
    fetch("/api/user/tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "WRAITH" }),
    }).catch((error) =>
      console.error("[WraithTier] Failed to sync account access:", error),
    );
  }, [isWhitelistMember, status]);

  return (
    <WraithTierContext.Provider
      value={{
        tier,
        rawBalance: 0,
        loading: false,
        isWhitelistMember,
        earlyAccess,
        canUse: canUseFeature,
        refresh,
      }}
    >
      {children}
    </WraithTierContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWraithTier(): WraithTierState {
  const ctx = useContext(WraithTierContext);
  if (!ctx)
    throw new Error("useWraithTier must be used inside <WraithTierProvider>");
  return ctx;
}

// ─── UI Components ───────────────────────────────────────────────────────────

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
};

const TIER_COLOR: Record<TierKey, string> = {
  GHOST: "#555566",
  SHADE: "#00b4d8",
  SPECTER: "#a855f7",
  WRAITH: "#e8490f",
};

export function TierBadge({ compact = false }: { compact?: boolean }) {
  const { tier, isWhitelistMember, earlyAccess } = useWraithTier();
  const color = earlyAccess && tier.key === "GHOST" ? TIER_COLOR.WRAITH : TIER_COLOR[tier.key];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: `${color}14`,
        border: `1px solid ${color}40`,
        borderRadius: 3,
        padding: compact ? "4px 10px" : "6px 14px",
        ...MONO,
      }}
    >
      <span
        style={{
          color,
          fontSize: compact ? 9 : 10,
          fontWeight: 900,
          letterSpacing: ".12em",
        }}
      >
        {earlyAccess && tier.key === "GHOST" ? "BETA" : tier.key}
      </span>
      {isWhitelistMember && (
        <span
          style={{
            fontSize: 7,
            color: `${color}bb`,
            letterSpacing: ".08em",
            borderLeft: `1px solid ${color}30`,
            paddingLeft: 6,
          }}
        >
          ACCESS
        </span>
      )}
    </div>
  );
}

export function TierGate({
  feature,
  children,
  fallback,
}: {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { canUse } = useWraithTier();
  if (canUse(feature)) return <>{children}</>;
  return fallback ? <>{fallback}</> : null;
}
