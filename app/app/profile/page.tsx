"use client";

import { defaultAvatar, defaultCover } from "@/lib/defaultArt";
import { visibleInterval } from "@/lib/visibleInterval";
import Image from "next/image";
import Link from "next/link";
import QuestsCard from "@/components/QuestsCard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import XLinkBridge, { type XLinkApi } from "@/components/XLinkBridge";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import {
  LAMPORTS_PER_SOL,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Info,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Wallet,
  X,
} from "lucide-react";
import Header from "@/components/HeaderSlot";
import PhotoViewer from "@/components/PhotoViewer";
import ProfileFeed from "@/components/ProfileFeed";
import TraderStats from "@/components/TraderStats";
import { useWraithSession } from "@/components/SessionProvider";
import StyledSelect from "@/components/StyledSelect";
import UsernameSetupModal from "@/components/UsernameSetupModal";
import FollowListModal from "@/components/FollowListModal";
import { decryptHotWalletKey } from "@/lib/hotWalletCrypto";
import { readLast, writeLast } from "@/lib/lastGood";
import { useCashSources } from "@/lib/useCashSources";
import {
  DisplayCurrency,
  formatCurrency,
  isDisplayCurrency,
} from "@/lib/currencies";

type Timeframe = "24h" | "7d" | "30d" | "all";
type ProfileData = {
  displayName: string;
  bio: string;
  xHandle: string;
  avatarDataUrl: string;
  coverDataUrl?: string;
  displayCurrency: DisplayCurrency;
  publicTrading: boolean;
  username?: string | null;
};
type Trade = {
  id: string;
  symbol: string;
  mint: string;
  amountSol: number;
  pnlPct?: number;
  currentPnlPct?: number;
  entryMcap: number;
  exitMcap?: number;
  status?: string;
  ts: number;
  imageUrl?: string;
  mode: "PAPER" | "LIVE";
};
type Position = {
  id: string;
  symbol: string;
  mint: string;
  amountSol: number;
  currentPnlPct: number;
  entryMcap: number;
  currentMcap: number;
  ts: number;
  imageUrl?: string;
  status?: string;
  mode: "PAPER" | "LIVE";
};

const PAPER_LOG_KEY = "wraith_paper_log_v1";
const PAPER_POSITIONS_KEY = "wraith_paper_positions_v1";
const HOT_WALLET_KEY = "wraith_hot_wallet_v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PROFILE_EMPTY: ProfileData = {
  displayName: "",
  bio: "",
  xHandle: "",
  avatarDataUrl: "",
  coverDataUrl: "",
  displayCurrency: "USD",
  publicTrading: false,
  username: null,
};

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function toTrade(
  value: Record<string, unknown>,
  mode: Trade["mode"],
): Trade | null {
  if (
    typeof value.id !== "string" ||
    typeof value.symbol !== "string" ||
    typeof value.mint !== "string" ||
    typeof value.amountSol !== "number" ||
    typeof value.entryMcap !== "number" ||
    typeof value.ts !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    symbol: value.symbol,
    mint: value.mint,
    amountSol: value.amountSol,
    pnlPct: typeof value.pnlPct === "number" ? value.pnlPct : undefined,
    currentPnlPct:
      typeof value.currentPnlPct === "number" ? value.currentPnlPct : undefined,
    entryMcap: value.entryMcap,
    exitMcap: typeof value.exitMcap === "number" ? value.exitMcap : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    ts: value.ts,
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : undefined,
    mode,
  };
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function MoneyText({ text }: { text: string }) {
  const m = /^(.*?)([.,]\d{1,2})$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <span className="dim">{m[2]}</span>
    </>
  );
}

export default function ProfilePage() {
  const {
    data: session,
    status,
    reauthenticateGoogle,
  } = useWraithSession();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { user: privyUser, getAccessToken } = usePrivy();
  const embeddedSolanaAccount = privyUser?.linkedAccounts.find(
      (account) =>
        account.type === "wallet" &&
        account.chainType === "solana" &&
        account.walletClientType === "privy",
    );
  const embeddedSolanaAddress =
    embeddedSolanaAccount?.type === "wallet"
      ? embeddedSolanaAccount.address
      : null;
  const [profile, setProfile] = useState<ProfileData>(PROFILE_EMPTY);
  const [draft, setDraft] = useState<ProfileData>(PROFILE_EMPTY);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("7d");
  const [tradeMode, setTradeMode] = useState<"ALL" | Trade["mode"]>("ALL");
  const cashHook = useCashSources();
  const [posTab, setPosTab] = useState<"open" | "closed">("open");
  const fmtHoldUsd = (v: number) => (v < 0.01 ? "<$0.01" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: v < 100 ? 2 : 0 }));
  const [holdings, setHoldings] = useState<{ address: string; symbol: string; name: string; amount: number; priceUsd: number; valueUsd: number; imageUrl?: string; native?: boolean }[]>([]);
  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const token = await getAccessToken();
        const r = await fetch("/api/holdings", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
        const j = await r.json().catch(() => ({}));
        if (on && r.ok && Array.isArray(j?.holdings)) setHoldings(j.holdings);
      } catch { /* holdings optional */ }
    };
    void load();
    window.addEventListener("wraith-evm-synced", load);
    return () => { on = false; window.removeEventListener("wraith-evm-synced", load); };
  }, [getAccessToken]);
  const [baseTrades, setTrades] = useState<Trade[]>([]);
  const [basePositions, setPositions] = useState<Position[]>([]);
  const [evmData, setEvmData] = useState<{
    closed: { id: string; symbol: string; mint: string; costUsd: number; pnlPct: number; entryMcap: number; exitMcap: number; ts: number; imageUrl: string | null }[];
    positions: { id: string; symbol: string; mint: string; costUsd: number; pnlPct: number; entryMcap: number; currentMcap: number; ts: number; imageUrl: string | null }[];
  } | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [hotWalletAddress, setHotWalletAddress] = useState("");
  const [hotWalletBalance, setHotWalletBalance] = useState<number | null>(null);
  const [hasHotWallet, setHasHotWallet] = useState(false);
  const [hotWalletPassword, setHotWalletPassword] = useState("");
  const [hotWalletBusy, setHotWalletBusy] = useState(false);
  const [exportWarningOpen, setExportWarningOpen] = useState(false);
  const [exportRiskAcknowledged, setExportRiskAcknowledged] = useState(false);
  const [accountCreatedAt, setAccountCreatedAt] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [socialCounts, setSocialCounts] = useState({ followers: 0, following: 0 });
  const [xLinkAvailable, setXLinkAvailable] = useState(false);
  const [avatarFallback, setAvatarFallback] = useState("");
  // false until the real profile (cached or fetched) is in: avoids flashing placeholder name/cover/avatar first
  const [profileReady, setProfileReady] = useState(false);
  const [xBusy, setXBusy] = useState(false);
  const [usernameEdit, setUsernameEdit] = useState("");
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameCheckErr, setUsernameCheckErr] = useState("");
  const [usernameSaveBusy, setUsernameSaveBusy] = useState(false);
  const [usernameSaveErr, setUsernameSaveErr] = useState("");
  const usernameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<"followers" | "following">("followers");
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(1);
  const [fxDate, setFxDate] = useState<string | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [transferTab, setTransferTab] = useState<"receive" | "send">("receive");
  const [transferSource, setTransferSource] = useState<"connected" | "hot">(
    "connected",
  );
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverImgRef = useRef<HTMLImageElement | null>(null);
  const [coverCrop, setCoverCrop] = useState<{ zoom: number; x: number; y: number } | null>(null);

  // last known balance and SOL price, shown instantly (and offline) while fresh values load
  useEffect(() => {
    const w = readLast<number>("wallet_sol");
    const p = readLast<number>("sol_usd");
    if (w !== null) setWalletBalance((cur) => cur ?? w);
    if (p !== null) setSolUsd((cur) => cur ?? p);
  }, []);

  const refreshWalletBalance = useCallback(async () => {
    const balanceAddress = embeddedSolanaAddress
      ? new PublicKey(embeddedSolanaAddress)
      : publicKey;
    if (!balanceAddress) {
      return; // wallet not ready yet: keep the last known balance instead of flashing empty
    }
    setWalletLoading(true);
    try {
      const lamports = await connection.getBalance(balanceAddress, "confirmed");
      setWalletBalance(lamports / LAMPORTS_PER_SOL);
      writeLast("wallet_sol", lamports / LAMPORTS_PER_SOL);
    } catch (cause) {
      console.error("[profile wallet balance]", cause);
      // offline or RPC hiccup: keep showing the last balance; only complain when there is nothing to show
      setWalletBalance((cur) => {
        if (cur === null) setError("Could not load the connected wallet balance. Try refreshing.");
        return cur;
      });
    } finally {
      setWalletLoading(false);
    }
  }, [connection, embeddedSolanaAddress, publicKey]);

  // show the numbers from the last visit right away, then refresh them (the request waits for the profile to know your id)
  useEffect(() => {
    const last = readLast<{ followers: number; following: number }>("social_counts");
    if (last && typeof last.followers === "number" && typeof last.following === "number") setSocialCounts(last);
  }, []);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetch(`/api/traders/following?traderId=${encodeURIComponent(userId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (active && result) {
          const next = {
            followers: typeof result.followers === "number" ? result.followers : 0,
            following: typeof result.followingCount === "number" ? result.followingCount : 0,
          };
          setSocialCounts(next);
          writeLast("social_counts", next);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setHasHotWallet(!!localStorage.getItem(HOT_WALLET_KEY));
    let active = true;
    try {
      const raw = localStorage.getItem("wraith_profile_cache_v1");
      if (raw) {
        const c = JSON.parse(raw) as { profile?: ProfileData; userId?: string; avatarFallback?: string };
        if (c?.profile && typeof c.profile.displayName === "string") {
          setProfile(c.profile);
          if (c.userId) setUserId(c.userId);
          if (c.avatarFallback) setAvatarFallback(c.avatarFallback);
          setProfileReady(true);
        }
      }
    } catch { /* ignore bad cache */ }
    const load = async () => {
      setBusy(true);
      setError("");
      try {
        const [profileResponse, tradesResponse, positionsResponse] =
          await Promise.all([
            fetch("/api/user/profile"),
            fetch("/api/trades"),
            fetch("/api/positions"),
          ]);
        const [profileJson, tradesJson, positionsJson] = await Promise.all([
          profileResponse.json(),
          tradesResponse.json(),
          positionsResponse.json(),
        ]);
        if (!profileResponse.ok) {
          throw new Error(profileJson.error ?? "Could not load your profile.");
        }
        if (!tradesResponse.ok || !positionsResponse.ok) {
          throw new Error(
            tradesJson.error ??
              positionsJson.error ??
              "Could not load your trading history.",
          );
        }
        if (!active) return;

        setAvatarFallback(typeof profileJson.profile?.avatarUrl === "string" ? profileJson.profile.avatarUrl : "");
        const loaded: ProfileData = {
          displayName:
            profileJson.profile?.displayName || session?.user?.name || "",
          bio: profileJson.profile?.bio ?? "",
          xHandle: profileJson.profile?.xHandle ?? "",
          avatarDataUrl: profileJson.profile?.avatarDataUrl ?? "",
          coverDataUrl: profileJson.profile?.coverDataUrl ?? "",
          displayCurrency: isDisplayCurrency(
            profileJson.profile?.displayCurrency,
          )
            ? profileJson.profile.displayCurrency
            : "USD",
          publicTrading: profileJson.profile?.publicTrading === true,
          username: profileJson.profile?.username ?? null,
        };
        const liveTrades: Trade[] = Array.isArray(tradesJson.trades)
          ? tradesJson.trades
              .map((trade: Record<string, unknown>) => toTrade(trade, "LIVE"))
              .filter((trade: Trade | null): trade is Trade => trade !== null)
          : [];
        const livePositions: Position[] = Array.isArray(positionsJson.positions)
          ? positionsJson.positions
              .filter(
                (position: Position) => position.status === "watching",
              )
              .map((position: Position) => ({ ...position, mode: "LIVE" as const }))
          : [];
        const loadEvm = async () => {
          try {
            const er = await fetch("/api/evm-trades", { cache: "no-store" });
            if (er.ok) { const ej = await er.json(); if (active && Array.isArray(ej?.closed) && Array.isArray(ej?.positions)) setEvmData(ej); }
          } catch { /* EVM history is optional */ }
        };
        await loadEvm();
        // pick up trades made earlier / elsewhere with this wallet, in the background (throttled)
        void (async () => {
          try {
            const last = Number(localStorage.getItem("wraith_evm_sync_v1") ?? "0");
            if (Date.now() - last < 60_000) return;
            localStorage.setItem("wraith_evm_sync_v1", String(Date.now()));
            const token = await getAccessToken();
            const r = await fetch("/api/evm-trades/sync", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) localStorage.removeItem("wraith_evm_sync_v1");
            if (r.ok && j?.added > 0) { await loadEvm(); window.dispatchEvent(new Event("wraith-evm-synced")); }
          } catch { localStorage.removeItem("wraith_evm_sync_v1"); }
        })();
        setProfile(loaded);
        setDraft(loaded);
        setProfileReady(true);
        try {
          localStorage.setItem("wraith_profile_cache_v1", JSON.stringify({ profile: loaded, userId: profileJson.userId ?? "", avatarFallback: typeof profileJson.profile?.avatarUrl === "string" ? profileJson.profile.avatarUrl : "" }));
        } catch { /* storage full/blocked */ }
        setAccountCreatedAt(profileJson.accountCreatedAt ?? null);
        setUserId(profileJson.userId ?? "");
        setUsernameEdit(profileJson.profile?.username ?? "");
        setTrades(liveTrades);
        setPositions(livePositions);
        localStorage.setItem(
          "wraith_display_currency_v1",
          loaded.displayCurrency,
        );
      } catch (cause) {
        console.error("[profile load]", cause);
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your account data.",
          );
        }
      } finally {
        if (active) { setBusy(false); setProfileReady(true); }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [session?.user?.name, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const openProfileSettings = () => {
      if (window.location.hash === "#profile-settings") setEditing(true);
    };
    openProfileSettings();
    window.addEventListener("hashchange", openProfileSettings);
    return () => window.removeEventListener("hashchange", openProfileSettings);
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    fetch("/api/user/x-account")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Could not check X account status.");
        }
        if (active) setXLinkAvailable(payload.available === true);
      })
      .catch((cause: unknown) => {
        console.error("[profile X account status]", cause);
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not check X account status.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [status]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("x");
    const walletExport = url.searchParams.get("walletExport");
    if (walletExport === "reauthenticated") {
      sessionStorage.setItem("wraith_wallet_export_reauth_at", String(Date.now()));
      setNotice(
        "Google sign-in confirmed. Unlock the hot wallet again to export its key.",
      );
      url.searchParams.delete("walletExport");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (!result) return;
    if (result === "connected") {
      setNotice("X account authenticated and linked.");
      void fetch("/api/user/profile")
        .then((response) => response.json())
        .then((payload) => {
          if (typeof payload.profile?.xHandle === "string") {
            setProfile((current) => ({
              ...current,
              xHandle: payload.profile.xHandle,
            }));
          }
        })
        .catch((cause) => console.error("[profile X refresh]", cause));
    } else if (result === "taken") {
      setError("That X account is already linked to another WRAITH profile.");
    } else if (result === "not-configured") {
      setError("X account linking is not configured on this server.");
    } else {
      const why = url.searchParams.get("why") ?? "";
      const reason =
        why === "denied" ? "You cancelled the X authorization."
        : why === "cookie" || why === "state" ? "The link session expired or came back on a different address. Start the link again from this same site."
        : why === "account-402" || why === "token-402" || why === "account-403" ? "X refused the request. The X developer app has no API credits or access. Add credits in the X Developer Console, then try again."
        : why === "token-400" || why === "token-401" ? "X rejected the app keys or the callback URL. Check the Client ID/Secret and that the callback URL matches exactly."
        : why === "account-429" ? "X rate limit reached. Try again in a few minutes."
        : "";
      setError(`X account linking failed${why ? ` (${why})` : ""}. ${reason || "Please try again."}`);
    }
    url.searchParams.delete("x");
    url.searchParams.delete("why");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    void refreshWalletBalance();
    const walletTimer = visibleInterval(() => void refreshWalletBalance(), 5_000);
    return () => window.clearInterval(walletTimer);
  }, [refreshWalletBalance]);

  useEffect(() => {
    let active = true;
    const loadPrices = async () => {
      try {
        const response = await fetch(`/api/price?ids=${SOL_MINT}`);
        const payload = await response.json();
        const price =
          payload?.[SOL_MINT]?.usdPrice ?? payload?.[SOL_MINT]?.price;
        if (active && typeof price === "number" && Number.isFinite(price)) {
          setSolUsd(price);
          writeLast("sol_usd", price);
        }
      } catch (cause) {
        console.error("[profile SOL price]", cause);
      }
    };
    void loadPrices();
    const interval = visibleInterval(loadPrices, 3_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setFxRate(profile.displayCurrency === "USD" ? 1 : null);
    const loadRate = async () => {
      setFxLoading(true);
      try {
        const response = await fetch(
          `/api/fx?currency=${profile.displayCurrency}`,
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Exchange rate unavailable.");
        }
        if (active) {
          setFxRate(payload.rate);
          setFxDate(payload.date);
        }
      } catch (cause) {
        console.error("[profile exchange rate]", cause);
        if (active) setFxRate(null);
      } finally {
        if (active) setFxLoading(false);
      }
    };
    void loadRate();
    return () => {
      active = false;
    };
  }, [profile.displayCurrency]);

  useEffect(() => {
    const onCurrencyUpdated = (event: Event) => {
      const currency = (event as CustomEvent<DisplayCurrency>).detail;
      if (!isDisplayCurrency(currency)) return;
      setProfile((current) => ({ ...current, displayCurrency: currency }));
      setDraft((current) => ({ ...current, displayCurrency: currency }));
    };
    window.addEventListener("wraith:currency-sync", onCurrencyUpdated);
    return () =>
      window.removeEventListener("wraith:currency-sync", onCurrencyUpdated);
  }, []);

  // Base / BNB / ETH trades live in USD; the stats below work in SOL-equivalents, so convert with the live SOL price
  const trades = useMemo<Trade[]>(() => {
    if (!evmData || !solUsd) return baseTrades;
    const extra: Trade[] = evmData.closed.map((c) => ({
      id: c.id, symbol: c.symbol, mint: c.mint, amountSol: c.costUsd / solUsd, pnlPct: c.pnlPct,
      entryMcap: c.entryMcap, exitMcap: c.exitMcap || undefined, status: "filled", ts: c.ts, imageUrl: c.imageUrl ?? undefined, mode: "LIVE",
    }));
    return [...baseTrades, ...extra];
  }, [baseTrades, evmData, solUsd]);
  const positions = useMemo<Position[]>(() => {
    if (!evmData || !solUsd) return basePositions;
    const extra: Position[] = evmData.positions.map((p) => ({
      id: p.id, symbol: p.symbol, mint: p.mint, amountSol: p.costUsd / solUsd, currentPnlPct: p.pnlPct,
      entryMcap: p.entryMcap, currentMcap: p.currentMcap, ts: p.ts, imageUrl: p.imageUrl ?? undefined, status: "watching", mode: "LIVE",
    }));
    return [...basePositions, ...extra];
  }, [basePositions, evmData, solUsd]);

  const filteredTrades = useMemo(() => {
    const now = Date.now();
    const rangeMs: Record<Timeframe, number> = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      all: Infinity,
    };
    return trades
      .filter((trade) => trade.ts >= now - rangeMs[timeframe])
      .filter((trade) => tradeMode === "ALL" || trade.mode === tradeMode)
      .sort((a, b) => b.ts - a.ts);
  }, [timeframe, tradeMode, trades]);

  const completedTrades = filteredTrades.filter(
    (trade) => typeof trade.pnlPct === "number",
  );
  const pnlChart = useMemo(() => {
    if (!completedTrades.length || solUsd === null || fxRate === null) {
      return { line: "", area: "" };
    }
    const chronological = [...completedTrades].sort((a, b) => a.ts - b.ts);
    let total = 0;
    const values = chronological.map((trade) => {
      total +=
        trade.amountSol *
        ((trade.pnlPct ?? 0) / 100) *
        solUsd *
        fxRate;
      return total;
    });
    if (values.length === 1) values.unshift(0);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
      const x = 8 + (index / Math.max(1, values.length - 1)) * 584;
      const y = 146 - ((value - min) / range) * 128;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = points.join(" ");
    return {
      line,
      area: `8,154 ${line} 592,154`,
    };
  }, [completedTrades, fxRate, solUsd]);
  const realizedPnl = completedTrades.reduce(
    (sum, trade) => sum + trade.amountSol * ((trade.pnlPct ?? 0) / 100),
    0,
  );
  const wins = completedTrades.filter((trade) => (trade.pnlPct ?? 0) > 0).length;
  const winRate = completedTrades.length
    ? (wins / completedTrades.length) * 100
    : null;
  const bestTrade = completedTrades.reduce<Trade | null>(
    (best, trade) =>
      !best || (trade.pnlPct ?? 0) > (best.pnlPct ?? 0) ? trade : best,
    null,
  );
  const openPositionValue = positions.reduce(
    (sum, position) =>
      sum + position.amountSol * (1 + position.currentPnlPct / 100),
    0,
  );
  const openPositionPnl = positions.reduce(
    (sum, position) =>
      sum + position.amountSol * (position.currentPnlPct / 100),
    0,
  );
  const openPositionValueDisplay = solUsd !== null && fxRate !== null
    ? formatCurrency(openPositionValue * solUsd * fxRate, profile.displayCurrency)
    : "Unavailable";
  const openPositionPnlDisplay = solUsd !== null && fxRate !== null
    ? formatCurrency(openPositionPnl * solUsd * fxRate, profile.displayCurrency)
    : "Unavailable";
  const displayName =
    profile.displayName || session?.user?.name || "Wraith trader";
  const avatar = profile.avatarDataUrl || avatarFallback || session?.user?.image || "";
  const livePositionValue = positions
    .filter((position) => position.mode === "LIVE")
    .reduce(
      (sum, position) =>
        sum + position.amountSol * (1 + position.currentPnlPct / 100),
      0,
    );
  const portfolioSol =
    (walletBalance ?? 0) + (hotWalletBalance ?? 0) + livePositionValue + (solUsd ? cashHook.total / solUsd : 0);
  const portfolioValue =
    solUsd !== null &&
    fxRate !== null &&
    (walletBalance !== null ||
      hotWalletBalance !== null ||
      cashHook.total > 0 ||
      positions.some((position) => position.mode === "LIVE"))
      ? portfolioSol * solUsd * fxRate
      : null;
  const realizedValue =
    solUsd !== null && fxRate !== null
      ? realizedPnl * solUsd * fxRate
      : null;
  const unlockHotWallet = async () => {
    setError("");
    setNotice("");
    const encrypted = localStorage.getItem(HOT_WALLET_KEY);
    if (!encrypted) {
      setError("No WRAITH hot wallet is set up in this browser.");
      return;
    }
    if (!hotWalletPassword) {
      setError("Enter your hot-wallet password.");
      return;
    }
    setHotWalletBusy(true);
    let secret: Uint8Array | null = null;
    let keypair: Keypair | null = null;
    try {
      secret = await decryptHotWalletKey(encrypted, hotWalletPassword);
      keypair = Keypair.fromSecretKey(secret);
      const address = keypair.publicKey.toBase58();
      setHotWalletAddress(address);
      const lamports = await connection.getBalance(
        keypair.publicKey,
        "confirmed",
      );
      setHotWalletBalance(lamports / LAMPORTS_PER_SOL);
      setHotWalletPassword("");
      keypair.secretKey.fill(0);
      setNotice("Hot wallet unlocked for address and balance lookup.");
    } catch (cause) {
      console.error("[profile hot wallet unlock]", cause);
      setError(
        keypair
          ? "The wallet was unlocked, but its balance could not be loaded."
          : "Could not unlock the hot wallet. Check the password and try again.",
      );
    } finally {
      keypair?.secretKey.fill(0);
      secret?.fill(0);
      setHotWalletBusy(false);
    }
  };

  const exportHotWallet = async () => {
    setError("");
    setNotice("");
    const reauthenticatedAt = Number(
      sessionStorage.getItem("wraith_wallet_export_reauth_at") ?? 0,
    );
    if (!reauthenticatedAt || Date.now() - reauthenticatedAt > 5 * 60_000) {
      setExportWarningOpen(true);
      return;
    }
    const encrypted = localStorage.getItem(HOT_WALLET_KEY);
    if (!encrypted || !hotWalletPassword) {
      setError("Enter your hot-wallet password to export the key.");
      return;
    }
    setHotWalletBusy(true);
    let secret: Uint8Array | null = null;
    try {
      secret = await decryptHotWalletKey(encrypted, hotWalletPassword);
      const keypair = Keypair.fromSecretKey(secret);
      const address = keypair.publicKey.toBase58();
      const keyFile = new Blob([JSON.stringify(Array.from(keypair.secretKey))], {
        type: "application/json",
      });
      const url = URL.createObjectURL(keyFile);
      const link = document.createElement("a");
      link.href = url;
      link.download = `wraith-solana-key-${address.slice(0, 6)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      keypair.secretKey.fill(0);
      setHotWalletPassword("");
      sessionStorage.removeItem("wraith_wallet_export_reauth_at");
      setNotice("Private key exported. Store it offline and never share it.");
    } catch (cause) {
      console.error("[profile hot wallet export]", cause);
      setError("Could not export the key. Check your hot-wallet password.");
    } finally {
      secret?.fill(0);
      setHotWalletBusy(false);
    }
  };

  const continueHotWalletExport = async () => {
    if (!exportRiskAcknowledged) return;
    setExportWarningOpen(false);
    setExportRiskAcknowledged(false);
    try {
      await reauthenticateGoogle();
    } catch (cause) {
      console.error("[profile export reauthentication]", cause);
      setError("Could not reauthenticate with Google. Please try again.");
    }
  };

  const copyHotWalletAddress = async () => {
    try {
      await navigator.clipboard.writeText(hotWalletAddress);
      setNotice("Hot wallet address copied.");
    } catch (cause) {
      console.error("[profile hot wallet copy]", cause);
      setError("Could not copy the hot-wallet address.");
    }
  };

  // ── X account, linked through Privy ─────────────────────────────────────────────────────────────────────────────
  // Privy's own X app does the sign-in, so Wraith needs no X developer credits. The server reads the handle from Privy
  // (never from this request) and saves it on the profile.
  const xSyncing = useRef(false);
  const xAutoTried = useRef("");
  const syncXFromPrivy = useCallback(async () => {
    if (xSyncing.current) return;
    xSyncing.current = true;
    setXBusy(true);
    try {
      const response = await fetch("/api/user/x-account/privy", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not save the linked X account.");
      setProfile((current) => ({ ...current, xHandle: payload.username }));
      setDraft((current) => ({ ...current, xHandle: payload.username }));
      setNotice(`X account @${payload.username} linked.`);
    } catch (cause) {
      console.error("[profile X sync]", cause);
      setError(cause instanceof Error ? cause.message : "Could not save the linked X account.");
    } finally {
      xSyncing.current = false;
      setXBusy(false);
    }
  }, []);

  // Privy's link/unlink hooks live in <XLinkBridge> (rendered below only when Privy is configured).
  const xLinkApi = useRef<XLinkApi | null>(null);
  const onXLinkError = useCallback((reason: string) => {
    setXBusy(false);
    if (reason === "exited_link_flow" || reason === "oauth_user_denied") return; // closed or cancelled on X: nothing to report
    setError(
      reason === "linked_to_another_user"
        ? "That X account is already linked to another WRAITH login."
        : `Could not link X (${reason}). Please try again.`,
    );
  }, []);

  const startXLink = () => {
    setError("");
    const api = xLinkApi.current;
    if (!api) {
      setError("X account linking is temporarily unavailable.");
      return;
    }
    setNotice("");
    setXBusy(true);
    // In the Android app, X opens in Chrome. Mark the address so Chrome knows to send you back to the app afterwards.
    if (/WraithApp/.test(navigator.userAgent)) {
      const u = new URL(window.location.href);
      u.searchParams.set("app", "1");
      window.history.replaceState(null, "", `${u.pathname}${u.search}`);
    }
    api.link(); // sends you to X to approve, then back here
    window.setTimeout(() => setXBusy(false), 15_000); // never leave the button stuck if the redirect did not start
  };

  // A linked X account that is not saved on the profile yet (for example the page reloaded right after the X redirect).
  // Tried once per handle per page load so a failure can never loop.
  const privyXName = privyUser?.twitter?.username ?? "";
  useEffect(() => {
    if (!profileReady || xBusy || !privyXName) return;
    if (profile.xHandle.toLowerCase() === privyXName.toLowerCase()) return;
    if (xAutoTried.current === privyXName) return;
    xAutoTried.current = privyXName;
    void syncXFromPrivy();
  }, [profileReady, xBusy, privyXName, profile.xHandle, syncXFromPrivy]);

  const unlinkXAccount = async () => {
    setXBusy(true);
    setError("");
    setNotice("");
    try {
      // Unlink on Privy first, otherwise it would simply re-link itself the next time this page opens.
      const subject = privyUser?.twitter?.subject;
      if (subject) {
        if (!xLinkApi.current) throw new Error("X account linking is temporarily unavailable.");
        await xLinkApi.current.unlink(subject);
      }
      const response = await fetch("/api/user/x-account", {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not unlink X account.");
      }
      setProfile((current) => ({ ...current, xHandle: "" }));
      setDraft((current) => ({ ...current, xHandle: "" }));
      setNotice("X account unlinked.");
    } catch (cause) {
      console.error("[profile X unlink]", cause);
      setError(
        cause instanceof Error ? cause.message : "Could not unlink X account.",
      );
    } finally {
      setXBusy(false);
    }
  };

  const saveProfile = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    setUsernameSaveErr("");

    // Save username if changed
    if (usernameEdit !== (profile.username ?? "")) {
      if (usernameEdit.length > 0 && usernameAvailable !== true) {
        setUsernameSaveErr("Choose an available username before saving.");
        setBusy(false);
        return;
      }
      if (usernameEdit.length > 0) {
        try {
          const r = await fetch("/api/user/username", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: usernameEdit }),
          });
          const d = await r.json();
          if (!r.ok) { setUsernameSaveErr(d.error ?? "Could not save username."); setBusy(false); return; }
          setProfile((c) => ({ ...c, username: d.username }));
        } catch {
          setUsernameSaveErr("Could not save username.");
          setBusy(false);
          return;
        }
      }
    }

    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: draft.displayName,
          bio: draft.bio,
          avatarDataUrl: draft.avatarDataUrl,
          coverDataUrl: draft.coverDataUrl ?? "",
          displayCurrency: draft.displayCurrency,
          publicTrading: draft.publicTrading,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save profile.");
      }
      setProfile(payload.profile);
      setDraft(payload.profile);
      // keep the instant-load copy in step with what was just saved, so the old profile never flashes back
      try {
        const prev = JSON.parse(localStorage.getItem("wraith_profile_cache_v1") || "{}") as { userId?: string; avatarFallback?: string };
        localStorage.setItem("wraith_profile_cache_v1", JSON.stringify({ profile: payload.profile, userId: prev.userId ?? userId, avatarFallback: prev.avatarFallback ?? avatarFallback }));
      } catch { /* storage full or blocked: ignore */ }
      setEditing(false);
      setNotice("Profile saved.");
      window.dispatchEvent(
        new CustomEvent("wraith:profile-updated", {
          detail: {
            displayName: payload.profile.displayName,
            avatarDataUrl: payload.profile.avatarDataUrl,
            displayCurrency: payload.profile.displayCurrency,
          },
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save profile.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onChoosePhoto = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new window.Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 320;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Could not process this image."));
            return;
          }
          const scale = Math.max(320 / image.width, 320 / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.drawImage(
            image,
            (320 - width) / 2,
            (320 - height) / 2,
            width,
            height,
          );
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        image.onerror = () => reject(new Error("Could not read this image."));
        image.src = String(reader.result);
      };
      reader.onerror = () => reject(new Error("Could not read this image."));
      reader.readAsDataURL(file);
    }).catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : "Could not read this image.",
      );
      return "";
    });
    if (!dataUrl) return;
    if (dataUrl.length > 400_000) {
      setError("That image is too large. Choose a smaller photo.");
      return;
    }
    setDraft((current) => ({ ...current, avatarDataUrl: dataUrl }));
  };

  const onChooseCover = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new window.Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not read this image."));
        image.src = String(reader.result);
      };
      reader.onerror = () => reject(new Error("Could not read this image."));
      reader.readAsDataURL(file);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not read this image.");
      return null;
    });
    if (!loaded) return;
    coverImgRef.current = loaded;
    const crop = { zoom: 1, x: 50, y: 50 };
    setCoverCrop(crop);
    applyCoverCrop(crop);
  };

  // crop the picked image to the cover shape (16:4.4); zoom 1-3, x/y = which part of the image stays in frame (0-100)
  const paintCover = (img: HTMLImageElement, zoom: number, px: number, py: number) => {
    const W = 1600, H = 440;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const scale = Math.max(W / img.width, H / img.height) * zoom;
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (W - w) * (px / 100), (H - h) * (py / 100), w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  };
  const applyCoverCrop = (crop: { zoom: number; x: number; y: number }) => {
    const img = coverImgRef.current;
    if (!img) return;
    const dataUrl = paintCover(img, crop.zoom, crop.x, crop.y);
    if (!dataUrl) return;
    if (dataUrl.length > 650_000) { setError("That cover is too large. Choose a smaller image or zoom out."); return; }
    setError("");
    setDraft((current) => ({ ...current, coverDataUrl: dataUrl }));
  };

  const copyAddress = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      setNotice("Wallet address copied.");
    } catch (cause) {
      console.error("[profile copy address]", cause);
      setError("Could not copy the wallet address.");
    }
  };

  const withdraw = async () => {
    setError("");
    setNotice("");
    const encryptedHotWallet =
      transferSource === "hot"
        ? localStorage.getItem(HOT_WALLET_KEY)
        : null;
    if (transferSource === "connected" && (!connected || !publicKey)) {
      setError("Connect a Solana wallet before sending SOL.");
      return;
    }
    if (transferSource === "hot" && (!encryptedHotWallet || !hotWalletPassword)) {
      setError("Unlock the hot wallet with its password before sending.");
      return;
    }
    let recipient: PublicKey;
    const amount = Number(withdrawAmount);
    try {
      recipient = new PublicKey(withdrawAddress.trim());
    } catch {
      setError("Enter a valid Solana recipient address.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a SOL amount greater than zero.");
      return;
    }
    const amountLamports = Math.round(amount * LAMPORTS_PER_SOL);
    if (amountLamports < 1) {
      setError("Amount is below the minimum transferable amount.");
      return;
    }
    const sourceBalance =
      transferSource === "hot" ? hotWalletBalance : walletBalance;
    if (
      sourceBalance === null ||
      amount > Math.max(0, sourceBalance - 0.01)
    ) {
      setError("Not enough SOL. Keep at least 0.01 SOL for network fees.");
      return;
    }
    setTransferBusy(true);
    let secret: Uint8Array | null = null;
    let hotKeypair: Keypair | null = null;
    try {
      if (transferSource === "hot" && encryptedHotWallet) {
        secret = await decryptHotWalletKey(
          encryptedHotWallet,
          hotWalletPassword,
        );
        hotKeypair = Keypair.fromSecretKey(secret);
      }
      const sender = hotKeypair?.publicKey ?? publicKey;
      if (!sender) throw new Error("No sending wallet is available.");
      if (recipient.equals(sender)) {
        throw new Error("The recipient is already the sending wallet.");
      }
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: recipient,
          lamports: amountLamports,
        }),
      );
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = sender;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const signature = hotKeypair
        ? await connection.sendTransaction(transaction, [hotKeypair])
        : await sendTransaction(transaction, connection);
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        throw new Error("The transfer was rejected by the Solana network.");
      }
      setWithdrawAddress("");
      setWithdrawAmount("");
      setHotWalletPassword("");
      setNotice(`Transfer confirmed: ${shortAddress(signature)}`);
      if (transferSource === "hot" && hotKeypair) {
        const remaining = await connection.getBalance(
          hotKeypair.publicKey,
          "confirmed",
        );
        setHotWalletBalance(remaining / LAMPORTS_PER_SOL);
      } else {
        await refreshWalletBalance();
      }
    } catch (cause) {
      console.error("[profile withdraw]", cause);
      setError(
        cause instanceof Error
          ? cause.message
          : "Transfer failed. No SOL was sent.",
      );
    } finally {
      hotKeypair?.secretKey.fill(0);
      secret?.fill(0);
      setTransferBusy(false);
    }
  };

  if (status === "loading") {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <div className="profile-shell wsk" aria-busy="true" aria-label="Loading your profile">
          <div className="wsk-cover wsk-b" />
          <div className="wsk-id">
            <div className="wsk-av wsk-b" />
            <div className="wsk-lines"><div className="wsk-b" style={{ width: 170, height: 20 }} /><div className="wsk-b" style={{ width: 110, height: 14 }} /></div>
            <div className="wsk-counts"><div className="wsk-b" style={{ width: 54, height: 34 }} /><div className="wsk-b" style={{ width: 54, height: 34 }} /></div>
          </div>
          <div className="wsk-b" style={{ width: "min(320px,70%)", height: 14, margin: "6px 0 18px" }} />
          <div className="wsk-card wsk-b" />
          <div className="wsk-grid"><div className="wsk-b" /><div className="wsk-b" /><div className="wsk-b" /></div>
        </div>
      </main>
    );
  }

  if (status === "unauthenticated") {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <section className="profile-auth-card">
          <LockKeyhole size={24} />
          <h1>Sign in to view your profile</h1>
          <p>Your stats, trades, and wallet tools live in your private account.</p>
          <Link href="/login">Continue to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      {viewerSrc && <PhotoViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
      {PRIVY_WALLETS_ENABLED && <XLinkBridge apiRef={xLinkApi} onLinked={() => void syncXFromPrivy()} onError={onXLinkError} />}
      <div className="profile-shell">
        <section className="profile-hero" id="profile-overview">
          {/* Cover banner */}
          <div
            className="profile-cover wx-tappable"
            onClick={() => { if (profileReady) setViewerSrc(profile.coverDataUrl || defaultCover(userId || displayName)); }}
            style={
              {
                backgroundImage: profileReady ? `url("${profile.coverDataUrl || defaultCover(userId || displayName)}")` : "none",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            }
          >
            </div>

          {/* Identity row — avatar overlaps cover */}
          <div className="profile-identity">
            <div
              className="profile-avatar-button wx-tappable"
              role="button"
              tabIndex={0}
              aria-label="View profile photo"
              onClick={() => { if (profileReady) setViewerSrc(avatar || defaultAvatar(userId || displayName)); }}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && profileReady) setViewerSrc(avatar || defaultAvatar(userId || displayName)); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {profileReady ? <img src={avatar || defaultAvatar(userId || displayName)} alt="" className="profile-avatar" /> : <span className="profile-avatar-fallback" style={{ background: "#141414" }} />}
              </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void onChoosePhoto(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <div className="profile-title-block">
              <h1 style={profileReady ? undefined : { opacity: 0, minHeight: "1.2em" }}>{displayName}</h1>
              {profile.username ? (
                <p className="profile-username"><span>@</span>{profile.username}</p>
              ) : (
                <p className="profile-username profile-username-dim">{session?.user?.email?.split("@")[0] || "Set a @username"}</p>
              )}
              {profile.bio && <p className="profile-bio">{profile.bio}</p>}
              <div className="profile-meta-row">
                {accountCreatedAt && (
                  <span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    Joined {new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(accountCreatedAt))}
                  </span>
                )}
                {trades.length > 0 && (
                  <span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                    {trades.length} trades
                  </span>
                )}
                {profile.xHandle && (
                  <a
                    className="profile-meta-x"
                    href={`https://x.com/${encodeURIComponent(profile.xHandle)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.632L18.244 2.25z"/></svg>
                    @{profile.xHandle}
                  </a>
                )}
              </div>
            </div>
            <div className="profile-social-counts">
              <button
                type="button"
                className="profile-count-item"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                onClick={() => { setFollowModalTab("following"); setShowFollowModal(true); }}
              >
                <strong>{socialCounts.following}</strong>
                <span>Following</span>
              </button>
              <button
                type="button"
                className="profile-count-item"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                onClick={() => { setFollowModalTab("followers"); setShowFollowModal(true); }}
              >
                <strong>{socialCounts.followers}</strong>
                <span>Followers</span>
              </button>
            </div>
            <button
              className="profile-edit-button"
              id="profile-settings"
              type="button"
              onClick={() => {
                setDraft(profile);
                setEditing(true);
              }}
            >
              <Pencil size={15} /> Edit profile
            </button>
          </div>
        </section>

        {(error || notice) && (
          <div className={`profile-message${error ? " is-error" : ""}`}>
            {error || notice}
            {error && (
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="profile-body-layout">
          <div className="profile-body-main">

        <div className="profile-summary-card">
        <section className="profile-portfolio-overview">
          <div className="profile-portfolio-copy">
            <div className="profile-portfolio-head">
              <span className="profile-eyebrow">Portfolio value</span>
              <span
                className="profile-portfolio-info"
                title={[
                  "Solana wallet + unlocked hot wallet + live positions",
                  portfolioValue !== null ? `Shown in ${profile.displayCurrency}; token marks refresh live` : "Wallet unavailable right now",
                  fxRate !== null ? `Approx. conversion${fxDate ? ` · FX ${fxDate}` : ""}` : "Exchange rate unavailable",
                ].join("\n")}
              >
                <Info size={11} />
              </span>
              <div className="profile-periods" role="tablist" aria-label="Period">
                {(["24h", "7d", "30d", "all"] as const).map((period) => (
                  <button key={period} type="button" role="tab" aria-selected={timeframe === period} className={timeframe === period ? "on" : ""} onClick={() => setTimeframe(period)}>
                    {period === "all" ? "All" : period}
                  </button>
                ))}
              </div>
            </div>
            <strong className="profile-portfolio-value">
              <MoneyText text={portfolioValue === null
                ? fxRate === null && !fxLoading
                  ? "Rate unavailable"
                  : walletLoading || solUsd === null || fxLoading
                    ? "Loading…"
                    : "Connect wallet"
                : formatCurrency(portfolioValue, profile.displayCurrency)} />
            </strong>
            <div className="profile-portfolio-period">
              <span>{timeframe === "all" ? "All-time" : timeframe} P&amp;L</span>
              <strong className={(realizedValue ?? realizedPnl) >= 0 ? "is-positive" : "is-negative"}>
                {realizedValue === null
                  ? "—"
                  : formatCurrency(realizedValue, profile.displayCurrency)}
              </strong>
            </div>
          </div>
          <div className={`profile-portfolio-chart${completedTrades.length ? "" : " is-empty"} tone-${!pnlChart.line ? "flat" : realizedPnl >= 0 ? "up" : "down"}`}>
            <div className="profile-chart-label">
              <span>REALIZED P&L CURVE</span>
              <span>{completedTrades.length} closes</span>
            </div>
            <svg
              viewBox="0 0 600 160"
              preserveAspectRatio="none"
              role="img"
              aria-label="Cumulative realized profit and loss chart"
            >
              <defs>
                <linearGradient id="profile-orange-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="8" x2="592" y1="154" y2="154" className="profile-chart-baseline" />
              {!pnlChart.line && <line x1="0" x2="600" y1="80" y2="80" className="profile-chart-flat" />}
              {pnlChart.area && (
                <polygon points={pnlChart.area} fill="url(#profile-orange-fill)" />
              )}
              {pnlChart.line && (
                <polyline
                  points={pnlChart.line}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            <i className="profile-chart-dot" />
          </div>
        </section>

        <QuestsCard />

        <section className="profile-stat-grid">
          <article className="profile-stat-card is-highlight">
            <span>REALIZED P&L</span>
            <strong className={realizedPnl >= 0 ? "is-positive" : "is-negative"}>
              {busy && !trades.length
                ? "Loading…"
                : realizedValue === null
                  ? "—"
                  : formatCurrency(realizedValue, profile.displayCurrency)}
            </strong>
            <small>
              {timeframe === "all"
                ? "All recorded closes"
                : `Selected ${timeframe} period`}
            </small>
          </article>
          <article className="profile-stat-card">
            <span>WIN RATE</span>
            <strong>
              {winRate === null ? "No closes" : `${winRate.toFixed(1)}%`}
            </strong>
            <small>{completedTrades.length} closed trades</small>
          </article>
          <article className="profile-stat-card">
            <span>POSITIONS</span>
            <strong>{positions.length}</strong>
            <small className={openPositionPnl >= 0 ? "is-positive" : "is-negative"}>
              {positions.length
                ? `${openPositionPnlDisplay} unrealized`
                : "None open"}
            </small>
          </article>
          {bestTrade && <article className="profile-stat-card">
            <span>BEST TRADE</span>
            <strong className={bestTrade ? "is-positive" : ""}>
              {bestTrade
                ? `+${(bestTrade.pnlPct ?? 0).toFixed(1)}%`
                : "No closes"}
            </strong>
            <small>
              {bestTrade ? bestTrade.symbol : "Your best close will show here"}
            </small>
          </article>}
        </section>
        </div>

        <TraderStats
          trades={trades}
          money={(sol, signed) => {
            if (solUsd === null || fxRate === null) return "-";
            const v = sol * solUsd * fxRate;
            return `${signed && v > 0 ? "+" : ""}${formatCurrency(v, profile.displayCurrency)}`;
          }}
        />

        <section className={`profile-main-grid${filteredTrades.length ? "" : " is-social-only"}`}>
          {filteredTrades.length > 0 && <article
            className="profile-panel profile-activity-panel"
            id="profile-activity"
          >
            <div className="profile-panel-heading">
              <div>
                <span className="profile-eyebrow">PERFORMANCE</span>
                <h2>Trading activity</h2>
              </div>
              <div className="profile-filters">
                <div className="profile-segment">
                  {(["24h", "7d", "30d", "all"] as const).map((period) => (
                    <button
                      key={period}
                      className={timeframe === period ? "is-active" : ""}
                      type="button"
                      onClick={() => setTimeframe(period)}
                    >
                      {period === "all" ? "All" : period}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="profile-trade-head">
              <span>TRADE</span>
              <span>MODE</span>
              <span>ENTRY / EXIT MCAP</span>
              <span>RESULT</span>
              <span>TIME</span>
            </div>
            {filteredTrades.length ? (
              <div className="profile-trade-list">
                {filteredTrades.slice(0, 50).map((trade) => {
                  const pnl = trade.pnlPct;
                  return (
                    <div
                      className="profile-trade-row"
                      key={`${trade.mode}-${trade.id}`}
                    >
                      <div className="profile-trade-token">
                        <div className="profile-token-avatar">
                          {trade.imageUrl ? (
                            <Image
                              src={trade.imageUrl}
                              alt=""
                              width={34}
                              height={34}
                              unoptimized
                            />
                          ) : (
                            trade.symbol.slice(0, 1)
                          )}
                        </div>
                        <div>
                          <strong>{trade.symbol}</strong>
                          <small>{shortAddress(trade.mint)}</small>
                        </div>
                      </div>
                      <span
                        className={`profile-mode-badge ${trade.mode.toLowerCase()}`}
                      >
                        {trade.mode}
                      </span>
                      <span className="profile-mcap">
                        ${trade.entryMcap.toLocaleString()}
                        {trade.exitMcap ? (
                          <small> → ${trade.exitMcap.toLocaleString()}</small>
                        ) : null}
                      </span>
                      <span
                        className={`profile-trade-pnl ${
                          pnl === undefined
                            ? ""
                            : pnl >= 0
                              ? "is-positive"
                              : "is-negative"
                        }`}
                      >
                        {pnl === undefined
                          ? trade.status ?? "Open"
                          : `${pnl > 0 ? "+" : ""}${pnl.toFixed(1)}%`}
                      </span>
                      <time>{formatDate(trade.ts)}</time>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="profile-empty">
                <div className="profile-empty-mark">↗</div>
                <strong>No trades in this window</strong>
                <p>
                  When you trade, your entries and performance will show up
                  here.
                </p>
                <Link href="/app">Explore tokens</Link>
              </div>
            )}
          </article>}

          <aside className="profile-side-column">
            {holdings.length > 0 && (
              <article className="profile-panel profile-holdings-panel">
                <div className="profile-panel-heading">
                  <div>
                    <span className="profile-eyebrow">WALLET · BASE</span>
                    <h2>Holdings</h2>
                  </div>
                  <strong>{fmtHoldUsd(holdings.reduce((t, h) => t + h.valueUsd, 0))}</strong>
                </div>
                <div className="hold-list">
                  {holdings.map((h) => (
                    <a key={h.address} className="hold-row" href={h.native ? undefined : `/app/token/${h.address}?chain=base`}>
                      <span className="hold-ico">{h.imageUrl ? <img src={h.imageUrl} alt="" /> : h.symbol.slice(0, 1)}</span>
                      <span className="hold-name"><b>{h.symbol}</b><em>{h.amount >= 1000 ? h.amount.toLocaleString(undefined, { maximumFractionDigits: 0 }) : h.amount.toLocaleString(undefined, { maximumSignificantDigits: 5 })}</em></span>
                      <span className="hold-val">{fmtHoldUsd(h.valueUsd)}</span>
                    </a>
                  ))}
                </div>
              </article>
            )}

            <article className="profile-panel profile-position-panel">
              <div className="profile-panel-heading">
                <div>
                  <span className="profile-eyebrow">LIVE EXPOSURE</span>
                  <h2>Open positions</h2>
                </div>
                <div className="profile-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={posTab === "open"} className={posTab === "open" ? "on" : ""} onClick={() => setPosTab("open")}>Open <em>{positions.length}</em></button>
                  <button type="button" role="tab" aria-selected={posTab === "closed"} className={posTab === "closed" ? "on" : ""} onClick={() => setPosTab("closed")}>Closed <em>{completedTrades.length}</em></button>
                </div>
              </div>
              {posTab === "closed" ? (
                completedTrades.length ? (
                  <div className="profile-open-list">
                    {completedTrades.slice(0, 8).map((t) => {
                      const pct = t.pnlPct ?? 0;
                      const ready = solUsd !== null && fxRate !== null;
                      const invested = ready ? formatCurrency(t.amountSol * solUsd * fxRate, profile.displayCurrency) : "";
                      const pnlAmt = ready ? formatCurrency(Math.abs(t.amountSol * (pct / 100)) * solUsd * fxRate, profile.displayCurrency) : "";
                      return (
                        <Link className="profile-open-row" key={`${t.mode}-${t.id}`} href={`/app/token/${t.mint}`}>
                          <div className="profile-token-avatar">
                            {t.imageUrl ? <Image src={t.imageUrl} alt="" width={34} height={34} unoptimized /> : t.symbol.slice(0, 1)}
                          </div>
                          <div className="profile-open-name">
                            <strong>{t.symbol}</strong>
                            <small>{invested ? `${invested} invested · ` : ""}{formatDate(t.ts)}</small>
                          </div>
                          <span className={pct >= 0 ? "is-positive" : "is-negative"}>
                            {pnlAmt ? `${pct >= 0 ? "+" : "-"}${pnlAmt} · ` : ""}{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : <p className="profile-empty-note">No closed trades in this window yet.</p>
              ) : positions.length ? (
                <div className="profile-open-list">
                  {positions.slice(0, 6).map((position) => (
                    <Link
                      className="profile-open-row"
                      key={position.id}
                      href={`/app/token/${position.mint}`}
                    >
                      <div className="profile-token-avatar">
                        {position.imageUrl ? (
                          <Image
                            src={position.imageUrl}
                            alt=""
                            width={34}
                            height={34}
                            unoptimized
                          />
                        ) : (
                          position.symbol.slice(0, 1)
                        )}
                      </div>
                      <div className="profile-open-name">
                        <strong>{position.symbol}</strong>
                        <small>{position.mode} | Entry {solUsd !== null && fxRate !== null ? formatCurrency(position.amountSol * solUsd * fxRate, profile.displayCurrency) : "Unavailable"}</small>
                      </div>
                      <span
                        className={
                          position.currentPnlPct >= 0
                            ? "is-positive"
                            : "is-negative"
                        }
                      >
                        {position.currentPnlPct >= 0 ? "+" : ""}
                        {position.currentPnlPct.toFixed(1)}%
                      </span>
                    </Link>
                  ))}
                </div>
              ) : <p className="profile-empty-note">No open positions. Buy a token and it shows up here.</p>}
              {posTab === "open" && positions.length > 0 && (
                <div className="profile-exposure-foot">
                  <span>Open value</span>
                  <strong>{openPositionValueDisplay}</strong>
                </div>
              )}
            </article>

            <article className="profile-panel profile-social-panel">
              <span className="profile-eyebrow" id="profile-social">LINKED ACCOUNT</span>
              <h2>{profile.xHandle ? "X account connected" : "Connect your X account"}</h2>
              <p>Show your X identity on your WRAITH profile.</p>
              {profile.xHandle ? (
                <div className="profile-social-actions">
                  <a
                    className="profile-social-link"
                    href={`https://x.com/${encodeURIComponent(profile.xHandle)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{profile.xHandle} <ExternalLink size={14} />
                  </a>
                  <button
                    className="profile-social-unlink"
                    type="button"
                    disabled={xBusy}
                    onClick={() => void unlinkXAccount()}
                  >
                    {xBusy ? "Unlinking…" : "Unlink"}
                  </button>
                </div>
              ) : (
                <button
                  className="profile-social-link"
                  type="button"
                  disabled={!xLinkAvailable || xBusy}
                  onClick={startXLink}
                >
                  {xBusy ? "Connecting…" : "Connect X account"}{" "}
                  <ArrowUpRight size={14} />
                </button>
              )}
              {!xLinkAvailable && !profile.xHandle && (
                <small>
                  X account linking is temporarily unavailable.
                </small>
              )}
            </article>
          </aside>
        </section>

        <section
          className="profile-panel profile-transfer-panel"
          aria-hidden="true"
          style={{ display: "none" }}
        >
          <div className="profile-panel-heading">
            <div>
              <span className="profile-eyebrow">SOLANA · SELF-CUSTODY</span>
              <h2>Receive or send SOL</h2>
            </div>
            <div className="profile-segment">
              <button
                className={transferTab === "receive" ? "is-active" : ""}
                type="button"
                onClick={() => setTransferTab("receive")}
              >
                Receive
              </button>
              <button
                className={transferTab === "send" ? "is-active" : ""}
                type="button"
                onClick={() => setTransferTab("send")}
              >
                Send
              </button>
            </div>
          </div>
          {transferTab === "send" ? (
            <div className="profile-send-form">
              <div className="profile-segment profile-transfer-source">
                <button
                  className={transferSource === "connected" ? "is-active" : ""}
                  type="button"
                  onClick={() => setTransferSource("connected")}
                >
                  Connected wallet
                </button>
                {/* only for people who already have one saved in this browser, so nothing left in it is ever stranded */}
                {hasHotWallet && (
                  <button
                    className={transferSource === "hot" ? "is-active" : ""}
                    type="button"
                    onClick={() => setTransferSource("hot")}
                  >
                    Hot wallet
                  </button>
                )}
              </div>
              {transferSource === "connected" && (!connected || !publicKey) ? (
                <div className="profile-connect-wallet">
                  <Wallet size={19} />
                  <div>
                    <strong>Connect a wallet to send SOL</strong>
                    <p>This sends from your connected self-custody wallet.</p>
                  </div>
                </div>
              ) : transferSource === "hot" && !hasHotWallet ? (
                <div className="profile-connect-wallet">
                  <LockKeyhole size={19} />
                  <div>
                    <strong>No hot wallet in this browser</strong>
                    <p>There is no hot wallet saved in this browser.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="profile-send-warning">
                    <LockKeyhole size={15} />
                    Review the recipient carefully. Confirming this transaction
                    sends real SOL and cannot be undone.
                  </div>
                  <label>
                    Recipient address
                    <input
                      value={withdrawAddress}
                      onChange={(event) =>
                        setWithdrawAddress(event.target.value)
                      }
                      placeholder="Solana address"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  {transferSource === "hot" && (
                    <label>
                      Hot-wallet password
                      <input
                        value={hotWalletPassword}
                        onChange={(event) =>
                          setHotWalletPassword(event.target.value)
                        }
                        type="password"
                        autoComplete="current-password"
                        placeholder="Unlock to approve this transfer"
                      />
                    </label>
                  )}
                  <label>
                    Amount
                    <div className="profile-amount-input">
                      <input
                        value={withdrawAmount}
                        onChange={(event) =>
                          setWithdrawAmount(event.target.value)
                        }
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder="0.00"
                      />
                      <span>SOL</span>
                      <button
                        type="button"
                        onClick={() => {
                          const balance =
                            transferSource === "hot"
                              ? hotWalletBalance
                              : walletBalance;
                          setWithdrawAmount(
                            balance === null
                              ? ""
                              : Math.max(0, balance - 0.01).toFixed(4),
                          );
                        }}
                        disabled={
                          (transferSource === "hot"
                            ? hotWalletBalance
                            : walletBalance) === null
                        }
                      >
                        MAX
                      </button>
                    </div>
                  </label>
                  <div className="profile-fee-note">
                    Available:{" "}
                    {transferSource === "hot"
                      ? hotWalletBalance === null
                        ? "unlock wallet to load balance"
                        : `${hotWalletBalance.toFixed(4)} SOL`
                      : walletBalance === null
                        ? "—"
                        : `${walletBalance.toFixed(4)} SOL`}{" "}
                    · Keep at least 0.01 SOL for fees.
                  </div>
                  <button
                    className="profile-send-button"
                    type="button"
                    disabled={
                      transferBusy ||
                      (transferSource === "connected" && !sendTransaction)
                    }
                    onClick={() => void withdraw()}
                  >
                    {transferBusy ? (
                      <LoaderCircle size={17} className="profile-spin" />
                    ) : (
                      <ArrowUpRight size={17} />
                    )}
                    {transferBusy ? "Sending…" : "Review & send SOL"}
                  </button>
                </>
              )}
            </div>
          ) : !connected || !publicKey ? (
            <div className="profile-connect-wallet">
              <Wallet size={19} />
              <div>
                <strong>Connect a wallet to continue</strong>
                <p>
                  Receive and send are direct wallet-to-wallet Solana transfers.
                </p>
              </div>
            </div>
          ) : (
            <div className="profile-receive-box">
              <div className="profile-receive-icon">
                <ArrowDownLeft size={22} />
              </div>
              <div className="profile-receive-content">
                <strong>Your connected wallet address</strong>
                <p>
                  Send SOL to this address from another wallet. WRAITH does not
                  custody the funds.
                </p>
                <code>{publicKey.toBase58()}</code>
              </div>
              <button
                className="profile-copy-button"
                type="button"
                onClick={() => void copyAddress()}
              >
                <Copy size={15} /> Copy
              </button>
            </div>
          )}
        </section>

          </div>{/* /profile-body-main */}
          <aside className="profile-body-aside profile-feed-aside">
            <ProfileFeed userId={userId} />
          </aside>
        </div>{/* /profile-body-layout */}

        {editing && (
          <div
            className="profile-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setEditing(false);
            }}
          >
            <section
              className="profile-edit-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-edit-title"
            >
              {/* Close button — absolute top-right */}
              <button
                type="button"
                className="profile-modal-close"
                aria-label="Close"
                onClick={() => setEditing(false)}
              >
                <X size={16} />
              </button>

              {/* Avatar section — centered */}
              <div className="profile-modal-avatar-section">
                <button
                  type="button"
                  className="profile-avatar-button profile-modal-avatar-btn"
                  onClick={() => photoInputRef.current?.click()}
                  aria-label="Change profile photo"
                >
                  {draft.avatarDataUrl || session?.user?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.avatarDataUrl || session?.user?.image || ""}
                      alt=""
                      className="profile-avatar"
                    />
                  ) : (
                    <span className="profile-avatar-fallback">
                      {displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="profile-avatar-edit">
                    <Camera size={14} />
                  </span>
                </button>
                {draft.avatarDataUrl && (
                  <button
                    type="button"
                    className="profile-remove-photo"
                    onClick={() => setDraft((c) => ({ ...c, avatarDataUrl: "" }))}
                  >
                    Remove photo
                  </button>
                )}
              </div>

              {/* Cover */}
              <div className="profile-field">
                <span>Cover</span>
                <div
                  className="profile-modal-cover"
                  style={
                    draft.coverDataUrl
                      ? { backgroundImage: `url(${draft.coverDataUrl})` }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="profile-modal-cover-btn"
                    onClick={() => coverInputRef.current?.click()}
                  >
                    <Camera size={14} />
                    {draft.coverDataUrl ? "Replace cover" : "Add cover"}
                  </button>
                  {draft.coverDataUrl && (
                    <button
                      type="button"
                      className="profile-modal-cover-btn"
                      onClick={() => setDraft((c) => ({ ...c, coverDataUrl: "" }))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {coverCrop && coverImgRef.current && draft.coverDataUrl && (
                  <div className="profile-crop">
                    {([["zoom", "Zoom", 1, 3, 0.01], ["x", "Left / right", 0, 100, 1], ["y", "Up / down", 0, 100, 1]] as const).map(([k, label, min, max, step]) => (
                      <label key={k}>
                        <span>{label}</span>
                        <input type="range" min={min} max={max} step={step} value={coverCrop[k]}
                          onChange={(e) => { const next = { ...coverCrop, [k]: Number(e.target.value) }; setCoverCrop(next); applyCoverCrop(next); }} />
                      </label>
                    ))}
                  </div>
                )}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    void onChooseCover(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </div>

              {/* Username */}
              <div className="profile-field">
                <span>Username</span>
                <div className="profile-modal-username-wrap">
                  <span className="profile-modal-at">@</span>
                  <input
                    value={usernameEdit}
                    onChange={(e) => {
                      const v = e.target.value;
                      setUsernameEdit(v);
                      setUsernameSaveErr("");
                      setUsernameAvailable(null);
                      if (usernameDebounceRef.current) clearTimeout(usernameDebounceRef.current);
                      if (v.length < 3) { setUsernameCheckErr(""); return; }
                      usernameDebounceRef.current = setTimeout(async () => {
                        setUsernameChecking(true);
                        setUsernameCheckErr("");
                        try {
                          const r = await fetch(`/api/user/username/check?q=${encodeURIComponent(v)}`);
                          const d = await r.json();
                          setUsernameAvailable(d.available ?? false);
                          if (!d.available && d.error) setUsernameCheckErr(d.error);
                        } catch { setUsernameCheckErr("Could not check."); }
                        finally { setUsernameChecking(false); }
                      }, 400);
                    }}
                    placeholder="username"
                    maxLength={20}
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    id="profile-edit-title"
                  />
                  {usernameChecking && <LoaderCircle size={14} className="profile-spin profile-modal-username-status" />}
                  {!usernameChecking && usernameAvailable === true && <Check size={14} className="profile-modal-username-ok" />}
                  {!usernameChecking && usernameAvailable === false && <X size={14} className="profile-modal-username-err" />}
                </div>
                {(usernameCheckErr || usernameSaveErr) && (
                  <small className="profile-modal-field-error">{usernameCheckErr || usernameSaveErr}</small>
                )}
              </div>

              {/* Display name */}
              <label className="profile-field">
                Display name
                <input
                  maxLength={40}
                  value={draft.displayName}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Your name"
                />
              </label>

              {/* Bio */}
              <label className="profile-field">
                Bio
                <textarea
                  maxLength={160}
                  rows={3}
                  value={draft.bio}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, bio: event.target.value }))
                  }
                  placeholder="A little about your trading style…"
                />
                <span className="profile-modal-charcount">{draft.bio.length}/160</span>
              </label>

              {/* X account row */}
              <div className="profile-field" style={!xLinkAvailable && !profile.xHandle ? { display: "none" } : undefined}>
                <span>X account</span>
                <div className="profile-x-linked-row">
                  {profile.xHandle ? (
                    <>
                      <span className="profile-x-verified">@{profile.xHandle} · linked</span>
                      <button
                        className="profile-remove-photo"
                        type="button"
                        disabled={xBusy}
                        onClick={() => void unlinkXAccount()}
                      >
                        Unlink
                      </button>
                    </>
                  ) : (
                    <button
                      className="profile-x-connect-btn"
                      type="button"
                      disabled={!xLinkAvailable || xBusy}
                      onClick={startXLink}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.632L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                      Link X account
                    </button>
                  )}
                </div>
                {!xLinkAvailable && !profile.xHandle && (
                  <small className="profile-modal-field-hint">
                    X account linking is temporarily unavailable.
                  </small>
                )}
              </div>

              {/* Public toggle */}
              <label className="profile-public-toggle">
                <input
                  type="checkbox"
                  checked={draft.publicTrading}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, publicTrading: event.target.checked }))
                  }
                />
                <span>
                  <strong>Share my trading activity</strong>
                  <small>Show live positions and closed trades on the public Traders page. Balances stay private.</small>
                </span>
              </label>

              {/* Single save button */}
              <button
                type="button"
                className="profile-modal-save-btn"
                onClick={() => void saveProfile()}
                disabled={busy}
              >
                {busy ? <LoaderCircle size={16} className="profile-spin" /> : "Save"}
              </button>
            </section>
          </div>
        )}
        {exportWarningOpen && (
          <div
            className="profile-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setExportWarningOpen(false);
                setExportRiskAcknowledged(false);
              }
            }}
          >
            <section
              className="profile-edit-modal profile-export-warning"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-export-title"
            >
              <div className="profile-export-warning-icon">
                <AlertTriangle size={24} />
              </div>
              <span className="profile-eyebrow">SECURITY CHECK</span>
              <h2 id="profile-export-title">Read before exporting keys</h2>
              <div className="profile-export-warning-copy">
                <p>
                  Your private key controls all funds in the hot wallet.
                  Anyone who gets it can permanently take those funds.
                </p>
                <p>
                  WRAITH will never ask you to send or share your private key.
                  It is decrypted locally in this browser and is never sent to
                  our servers.
                </p>
                <p>
                  The exported JSON file is unencrypted. Store it offline and
                  delete it from downloads after backing it up safely.
                </p>
              </div>
              <label className="profile-export-acknowledge">
                <input
                  type="checkbox"
                  checked={exportRiskAcknowledged}
                  onChange={(event) =>
                    setExportRiskAcknowledged(event.target.checked)
                  }
                />
                <span>
                  I understand that exposing this key can cause permanent loss
                  of funds.
                </span>
              </label>
              <div className="profile-modal-actions">
                <button
                  className="profile-cancel-button"
                  type="button"
                  onClick={() => {
                    setExportWarningOpen(false);
                    setExportRiskAcknowledged(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="profile-save-button"
                  type="button"
                  onClick={() => void continueHotWalletExport()}
                  disabled={!exportRiskAcknowledged}
                >
                  Continue to Google sign-in
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
      {showFollowModal && userId && (
        <FollowListModal
          traderId={userId}
          initialTab={followModalTab}
          followerCount={socialCounts.followers}
          followingCount={socialCounts.following}
          onClose={() => setShowFollowModal(false)}
        />
      )}
      <UsernameSetupModal />
    </main>
  );
}
