"use client";

import { QRCodeSVG } from "qrcode.react";
import { cleanSym, cleanName } from "@/lib/cleanText";
import { defaultAvatar } from "@/lib/defaultArt";
import { loadHeaderProfile, readHeaderProfile, writeHeaderProfile } from "@/lib/profileCache";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import NotificationBell from "@/components/NotificationBell";
import { appLockEnabled, appLockSupported, biometricReady, biometricVerify, disableAppLock, enableAppLock } from "@/components/AppLock";
import { PIN_HASH_KEY, PIN_ENABLED_KEY, PIN_TIMEOUT_KEY, clearLocalPin, clearServerPin, hashPin, newSalt, pushLockPin, pushLockTimeout, saveLocalPin, storedSalt, syncLockFromAccount } from "@/lib/pinLockSync";
import Link from "next/link";
import OnboardingFlow from "@/components/OnboardingFlow";
import { useRouter } from "next/navigation";
import { cacheTokenNav } from "@/lib/tokenNav";
import { Lock as LockIcon,
  ArrowLeftRight,
  Bookmark,
  CheckCircle2,
  CircleDollarSign,
  EyeOff,
  Fingerprint,
  Gift,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LogOut,
  Shield,
  Settings2,
  Smartphone,
  UserRound,
  X,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useLinkWithPasskey, useMfaEnrollment, usePrivy, useUser as usePrivyUser } from "@privy-io/react-auth";
import StyledSelect from "./StyledSelect";
import EmbeddedWalletBalanceChip from "./EmbeddedWalletBalanceChip";
import MobileTabBar from "./MobileTabBar";
import { chainOf, EVM_ADDR_RE } from "@/lib/chains";
import { SOLANA_MINT_RE } from "@/lib/market";
import ChainLogo from "@/components/ChainLogo";
import EmbeddedWalletOverview from "./EmbeddedWalletOverview";
import EmbeddedWalletTransfers from "./EmbeddedWalletTransfers";
import TransfersHistory from "./TransfersHistory";
import PrivyConfigurationNotice from "./PrivyConfigurationNotice";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import { useWraithTier } from "@/hooks/useWraithTier";
import AutoExit from "@/components/AutoExit";
import LiveAutoExit from "@/components/LiveAutoExit";
import { PRIVY_WALLETS_ENABLED as LIVE_EXIT_WALLETS } from "@/lib/privyConfig";
import TierCard from "@/components/TierCard";
import { useWraithSession } from "@/components/SessionProvider";
import { MemeTrend } from "@/app/app/page";
import {
  QuickBuyPreset,
  loadPresets,
  savePresets,
  loadActivePresetId,
  saveActivePresetId,
  makePresetId,
  DEFAULT_PRESETS,
} from "@/lib/quickBuyPresets";
import { readCurrency, symbolOf } from "@/lib/cash";
import {
  DISPLAY_CURRENCIES,
  DisplayCurrency,
  isDisplayCurrency,
} from "@/lib/currencies";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

type TraderSearchResult = {
  userId: string;
  username?: string | null;
  displayName: string;
  bio: string;
  xHandle: string;
  avatarDataUrl: string;
  isBookmarked: boolean;
  isFollowing?: boolean;
  profitSol: number;
  closedTradeCount: number;
  openPositionCount: number;
  followerCount?: number;
};

type QuickTraderResult = {
  userId: string;
  username: string | null;
  displayName: string;
  avatarDataUrl: string;
  followerCount: number;
};

function ProfileMenuItem({
  icon: Icon,
  label,
  detail,
  href,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: typeof UserRound;
  label: string;
  detail?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const content = (
    <>
      <Icon size={17} strokeWidth={1.8} />
      <span className="wraith-profile-menu-label">{label}</span>
      {detail && <span className="wraith-profile-menu-detail">{detail}</span>}
    </>
  );

  if (href) {
    return (
      <Link
        className={`wraith-profile-menu-item${danger ? " is-danger" : ""}`}
        href={href}
        onClick={onClick}
        role="menuitem"
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      className={`wraith-profile-menu-item${danger ? " is-danger" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      role="menuitem"
    >
      {content}
    </button>
  );
}

function formatMcap(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number): string {
  if (!n) return "—";
  if (n < 0.000001) return `$${n.toExponential(2)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

interface TokenResult {
  address: string;
  name: string;
  symbol: string;
  icon?: string;
  priceUsd: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceChange24h: number;
  chainId: string;
  pairAddress: string;
}

const TELEGRAM_TIERS = ["SPECTER", "WRAITH"];
type ProfileDialog =
  | "account"
  | "security"
  | "settings"
  | "currency"
  | "deposit"
  | "withdraw"
  | "transfers";

function ModeIcon({ color }: { color: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M12 2L4 6V12C4 16.5 7.5 20.5 12 22C16.5 20.5 20 16.5 20 12V6L12 2Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TradingModeBadge({ locked }: { locked: boolean }) {
  const [paper, setPaper] = useState(false);
  useEffect(() => {
    const read = () =>
      setPaper(
        JSON.parse(localStorage.getItem("wraith_paper_mode_v1") || "false"),
      );
    read();
    window.addEventListener("wraith:paper-mode-sync", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("wraith:paper-mode-sync", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  if (locked) {
    return <span style={{ fontSize: 9, color: "#2a2a2a", ...MONO }}>LIVE</span>;
  }
  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 3,
        letterSpacing: ".06em",
        color: paper ? "#00c47a" : "var(--accent-text)",
        background: paper ? "#00c47a14" : "rgba(var(--accent-rgb),0.1)",
        border: `1px solid ${paper ? "#00c47a44" : "rgba(var(--accent-rgb),0.28)"}`,
      }}
    >
      {paper ? "PAPER" : "LIVE"}
    </span>
  );
}

// One calm row, like Fomo: picture, ticker + name, market cap, price and change. No address, copy, DEX or OPEN button.
function TokenRow({
  token,
  onSelect,
}: {
  token: TokenResult;
  isLast?: boolean;
  copiedAddr?: string | null;
  onSelect: (t: TokenResult) => void;
  onCopy?: (e: React.MouseEvent, addr: string) => void;
  onOpenDex?: (e: React.MouseEvent, t: TokenResult) => void;
  showOpenCta?: boolean;
}) {
  const up = token.priceChange24h >= 0;
  return (
    <button type="button" className="wx-sr" data-nav-item onClick={() => onSelect(token)}>
      <span className="wx-sr-av">
        {token.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={token.icon} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <b>{token.symbol[0]}</b>
        )}
      </span>
      <span className="wx-sr-id">
        <span className="wx-sr-sym">
          {token.symbol}
          {token.chainId && <i className="wx-sr-chain" title={chainOf(token.chainId)?.name ?? token.chainId}><ChainLogo chain={token.chainId} size={14} /></i>}
        </span>
        <span className="wx-sr-name">{token.name}</span>
      </span>
      <span className="wx-sr-mc"><em>MC</em>{formatMcap(token.marketCap)}</span>
      <span className="wx-sr-px">
        <b>{formatPrice(token.priceUsd)}</b>
        <small className={up ? "up" : "dn"}>{up ? "+" : ""}{token.priceChange24h.toFixed(2)}%</small>
      </span>
    </button>
  );
}

// ── Coin Search ──────────────────────────────────────────────────────────────
function CoinSearch({
  onSelectMeme,
}: {
  onSelectMeme?: (meme: MemeTrend) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"tokens" | "people" | "saved">(
    "tokens",
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TokenResult[]>([]);
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const f = () => setIsPhone(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const wrapDrop = (el: React.ReactElement) =>
    isPhone && typeof document !== "undefined" ? createPortal(el, document.body) : el;
  const [traderResults, setTraderResults] = useState<TraderSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const { data: session } = useWraithSession();

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [trending, setTrending] = useState<TokenResult[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [recent, setRecent] = useState<TokenResult[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wraith_recent_tokens");
      const list = raw ? (JSON.parse(raw) as TokenResult[]) : [];
      if (Array.isArray(list)) setRecent(list.filter((t) => t && t.address).slice(0, 8));
    } catch { /* ignore */ }
  }, [open]);
  const pushRecent = (token: TokenResult) => {
    try {
      const next = [token, ...recent.filter((t) => t.address !== token.address)].slice(0, 8);
      setRecent(next);
      localStorage.setItem("wraith_recent_tokens", JSON.stringify(next));
    } catch { /* ignore */ }
  };
  const clearRecent = () => {
    setRecent([]);
    try { localStorage.removeItem("wraith_recent_tokens"); } catch { /* ignore */ }
  };
  const [recentQ, setRecentQ] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("wraith_recent_queries");
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      if (Array.isArray(list)) setRecentQ(list.filter((q) => typeof q === "string" && q).slice(0, 8));
    } catch { /* ignore */ }
  }, [open]);
  // Older versions remembered the words you typed. Now the token you opened is what is remembered (icon, name, market cap), and an
  // old entry that was a pasted contract address is turned into the token it points to the next time the search opens.
  const triedQ = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    const addrs = recentQ
      .filter((q) => (SOLANA_MINT_RE.test(q) || EVM_ADDR_RE.test(q)) && !triedQ.current.has(q) && !recent.some((t) => t.address.toLowerCase() === q.toLowerCase()))
      .slice(0, 4);
    if (!addrs.length) return;
    addrs.forEach((q) => triedQ.current.add(q));
    let alive = true;
    void Promise.all(addrs.map(async (q): Promise<{ q: string; t: TokenResult | null }> => {
      try {
        const d = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`).then((r) => r.json());
        const pairs = ((d?.pairs ?? []) as { chainId: string; liquidity?: { usd?: number } }[])
          .filter((x) => x.chainId === "solana" || chainOf(x.chainId))
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const pair = pairs[0] as (typeof pairs)[number] & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (pair) {
          return { q, t: {
            address: pair.baseToken?.address ?? q,
            name: cleanName(pair.baseToken?.name ?? "Unknown"),
            symbol: cleanSym(pair.baseToken?.symbol ?? "???"),
            icon: pair.info?.imageUrl ?? undefined,
            priceUsd: parseFloat(pair.priceUsd ?? "0"),
            marketCap: Number(pair.marketCap) > 0 ? Number(pair.marketCap) : 0,
            liquidity: pair.liquidity?.usd ?? 0,
            volume24h: pair.volume?.h24 ?? 0,
            priceChange24h: pair.priceChange?.h24 ?? 0,
            chainId: pair.chainId ?? "",
            pairAddress: pair.pairAddress ?? "",
          } };
        }
        if (SOLANA_MINT_RE.test(q)) {
          const snap = await fetch(`/api/token-price?mint=${encodeURIComponent(q)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (snap && (Number(snap.priceUsd) > 0 || Number(snap.marketCap) > 0 || snap.symbol)) {
            return { q, t: {
              address: q, name: cleanName(String(snap.name ?? "Unknown")), symbol: cleanSym(String(snap.symbol ?? "???")),
              icon: typeof snap.image === "string" ? snap.image : undefined, priceUsd: Number(snap.priceUsd) || 0, marketCap: Number(snap.marketCap) || 0,
              liquidity: Number(snap.liquidity) || 0, volume24h: Number(snap.volume24h) || 0, priceChange24h: Number(snap.priceChange24h ?? snap.priceChange) || 0,
              chainId: "solana", pairAddress: "",
            } };
          }
        }
      } catch { /* offline: try again next time */ }
      return { q, t: null };
    })).then((rows) => {
      const found = rows.filter((r): r is { q: string; t: TokenResult } => r.t !== null);
      if (!alive || !found.length) return;
      const nextTokens = [...found.map((f) => f.t), ...recent.filter((t) => !found.some((f) => f.t.address.toLowerCase() === t.address.toLowerCase()))].slice(0, 8);
      const nextQ = recentQ.filter((x) => !found.some((f) => f.q === x));
      setRecent(nextTokens);
      setRecentQ(nextQ);
      try {
        localStorage.setItem("wraith_recent_tokens", JSON.stringify(nextTokens));
        localStorage.setItem("wraith_recent_queries", JSON.stringify(nextQ));
      } catch { /* ignore */ }
    });
    return () => { alive = false; };
  }, [open, recentQ, recent]);
  const dropRecentQ = (q: string) => {
    const next = recentQ.filter((x) => x !== q);
    setRecentQ(next);
    try { localStorage.setItem("wraith_recent_queries", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const trendingFetchedRef = useRef(false);
  const [quickTraders, setQuickTraders] = useState<QuickTraderResult[]>([]);
  const quickTradersDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // A pasted contract address: look the token up directly (the text search is unreliable for addresses and misses new tokens).
      const isAddr = SOLANA_MINT_RE.test(trimmed) || EVM_ADDR_RE.test(trimmed);
      const res = await fetch(
        isAddr
          ? `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(trimmed)}`
          : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(trimmed)}`,
      );
      const data = await res.json();
      if (isAddr && (!data.pairs || data.pairs.length === 0) && SOLANA_MINT_RE.test(trimmed)) {
        // Not on DexScreener yet (e.g. still on the pump.fun curve): use Wraith's own snapshot so it still shows up.
        const snap = await fetch(`/api/token-price?mint=${encodeURIComponent(trimmed)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (snap && (Number(snap.priceUsd) > 0 || Number(snap.marketCap) > 0 || snap.symbol)) {
          setResults([{
            address: trimmed,
            name: cleanName(String(snap.name ?? "Unknown")),
            symbol: cleanSym(String(snap.symbol ?? "???")),
            icon: typeof snap.image === "string" ? snap.image : undefined,
            priceUsd: Number(snap.priceUsd) || 0,
            marketCap: Number(snap.marketCap) || 0,
            liquidity: Number(snap.liquidity) || 0,
            volume24h: Number(snap.volume24h) || 0,
            priceChange24h: Number(snap.priceChange24h ?? snap.priceChange) || 0,
            chainId: "solana",
            pairAddress: "",
          }]);
          setLoading(false);
          return;
        }
      }
      if (!data.pairs || data.pairs.length === 0) {
        setResults([]);
        setError("No tokens found");
        setLoading(false);
        return;
      }

      const seen = new Map<string, TokenResult>();
      for (const pair of data.pairs) {
        const addr = pair.baseToken?.address;
        if (!addr) continue;
        // only chains Wraith supports: Solana + the EVM chains in lib/chains.ts
        if (pair.chainId !== "solana" && !chainOf(pair.chainId)) continue;
        const liquidity = pair.liquidity?.usd ?? 0;
        // FDV is not circulating market cap. Leave MCAP blank until the
        // shared live-price source confirms a real marketCap value.
        const mcap = Number(pair.marketCap) > 0 ? Number(pair.marketCap) : 0;
        const priceUsd = parseFloat(pair.priceUsd ?? "0");
        const existing = seen.get(addr);
        if (!existing || liquidity > existing.liquidity) {
          seen.set(addr, {
            address: addr,
            name: cleanName(pair.baseToken?.name ?? "Unknown"),
            symbol: cleanSym(pair.baseToken?.symbol ?? "???"),
            icon: pair.info?.imageUrl ?? undefined,
            priceUsd,
            marketCap: mcap,
            liquidity,
            volume24h: pair.volume?.h24 ?? 0,
            priceChange24h: pair.priceChange?.h24 ?? 0,
            chainId: pair.chainId ?? "",
            pairAddress: pair.pairAddress ?? "",
          });
        }
      }

      setResults(
        Array.from(seen.values())
          .sort((a, b) => b.liquidity - a.liquidity)
          .slice(0, 7),
      );
    } catch {
      setError("Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  const searchTraders = useCallback(
    async (q: string, savedOnly: boolean) => {
      if (savedOnly && !session?.user?.id) {
        setTraderResults([]);
        setError("Sign in to view your saved traders");
        setLoading(false);
        return;
      }
      if (!savedOnly && q.trim().length < 2) {
        setTraderResults([]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim().length >= 2) params.set("search", q.trim());
        if (savedOnly) params.set("saved", "1");
        const response = await fetch(`/api/traders?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Could not search traders");
        }
        setTraderResults(Array.isArray(payload.traders) ? payload.traders : []);
      } catch (searchError) {
        setTraderResults([]);
        setError(
          searchError instanceof Error
            ? searchError.message
            : "Could not search traders",
        );
      } finally {
        setLoading(false);
      }
    },
    [session?.user?.id],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchMode === "tokens") {
        void search(query);
      } else {
        void searchTraders(query, searchMode === "saved");
      }
    }, SOLANA_MINT_RE.test(query.trim()) || EVM_ADDR_RE.test(query.trim()) ? 0 : 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search, searchMode, searchTraders]);

  // Quick unified trader search (runs for any mode when query exists)
  useEffect(() => {
    if (quickTradersDebounceRef.current)
      clearTimeout(quickTradersDebounceRef.current);
    if (!query || query.trim().length < 2) {
      setQuickTraders([]);
      return;
    }
    quickTradersDebounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/traders/search?q=${encodeURIComponent(query.trim())}`,
        );
        const d = await r.json();
        setQuickTraders(Array.isArray(d.traders) ? d.traders : []);
      } catch {
        setQuickTraders([]);
      }
    }, 350);
    return () => {
      if (quickTradersDebounceRef.current)
        clearTimeout(quickTradersDebounceRef.current);
    };
  }, [query]);

  const fetchTrending = useCallback(async () => {
    if (trendingFetchedRef.current) return;
    trendingFetchedRef.current = true;
    setTrendingLoading(true);
    try {
      const boostRes = await fetch(
        "https://api.dexscreener.com/token-boosts/top/v1",
      );
      const boosts = await boostRes.json();
      const solanaAddrs: string[] = (Array.isArray(boosts) ? boosts : [])
        .filter((b: { chainId?: string }) => b.chainId === "solana")
        .map((b: { tokenAddress: string }) => b.tokenAddress)
        .slice(0, 8);

      if (!solanaAddrs.length) {
        setTrendingLoading(false);
        return;
      }

      const results = await Promise.all(
        solanaAddrs.map(async (addr) => {
          try {
            const r = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${addr}`,
            );
            const d = await r.json();
            const pairs = (d?.pairs || [])
              .filter((p: { chainId: string }) => p.chainId === "solana")
              .sort(
                (
                  a: { liquidity?: { usd?: number } },
                  b: { liquidity?: { usd?: number } },
                ) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
              );
            const pair = pairs[0];
            if (!pair) return null;
            const t: TokenResult = {
              address: pair.baseToken?.address ?? addr,
              name: cleanName(pair.baseToken?.name ?? "Unknown"),
              symbol: cleanSym(pair.baseToken?.symbol ?? "???"),
              icon: pair.info?.imageUrl ?? undefined,
              priceUsd: parseFloat(pair.priceUsd ?? "0"),
              // Do not seed the panel with FDV when circulating MCAP is absent.
              marketCap:
                Number(pair.marketCap) > 0 ? Number(pair.marketCap) : 0,
              liquidity: pair.liquidity?.usd ?? 0,
              volume24h: pair.volume?.h24 ?? 0,
              priceChange24h: pair.priceChange?.h24 ?? 0,
              chainId: pair.chainId ?? "",
              pairAddress: pair.pairAddress ?? "",
            };
            return t;
          } catch {
            return null;
          }
        }),
      );

      setTrending(results.filter((t): t is TokenResult => t !== null));
    } catch {
      /* silent — falls back to empty state text */
    } finally {
      setTrendingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !query && searchMode === "tokens") fetchTrending();
  }, [open, query, searchMode, fetchTrending]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !(listRef.current && listRef.current.contains(e.target as Node))
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Opened from the mobile tab bar's search button
  useEffect(() => {
    const h = () => {
      setOpen(true);
      // on phones show the recents first; the keyboard opens when the box is tapped
      if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) setTimeout(() => inputRef.current?.focus(), 60);
    };
    window.addEventListener("wraith:open-search", h);
    return () => window.removeEventListener("wraith:open-search", h);
  }, []);

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSelectToken = (token: TokenResult) => {
    pushRecent(token);
    // typed text that pointed at this token is replaced by the token itself
    const same = (x: string) => [token.address, token.symbol, token.name].some((v) => v && v.toLowerCase() === x.toLowerCase());
    if (recentQ.some(same)) {
      const nextQ = recentQ.filter((x) => !same(x));
      setRecentQ(nextQ);
      try { localStorage.setItem("wraith_recent_queries", JSON.stringify(nextQ)); } catch { /* ignore */ }
    }
    // Build MemeTrend from the search result
    const meme: MemeTrend = {
      keyword: token.symbol,
      score: 0,
      posts: 0,
      source: token.chainId,
      contractAddress: token.address,
      mcap: token.marketCap,
      volume: token.volume24h,
      hasTicker: true,
      isNewCoin: false,
    };
    if (onSelectMeme) onSelectMeme(meme);
    else {
      cacheTokenNav(meme);
      router.push(`/app/token/${encodeURIComponent(token.address)}`);
    }
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const toggleBookmark = async (trader: TraderSearchResult) => {
    if (!session?.user?.id) {
      setError("Sign in to bookmark traders");
      return;
    }
    try {
      const response = await fetch(
        trader.isBookmarked
          ? `/api/traders/bookmarks?traderId=${encodeURIComponent(trader.userId)}`
          : "/api/traders/bookmarks",
        trader.isBookmarked
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ traderId: trader.userId }),
            },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Bookmark update failed");
      setTraderResults((current) =>
        searchMode === "saved" && trader.isBookmarked
          ? current.filter((item) => item.userId !== trader.userId)
          : current.map((item) =>
              item.userId === trader.userId
                ? { ...item, isBookmarked: !trader.isBookmarked }
                : item,
            ),
      );
    } catch (bookmarkError) {
      setError(
        bookmarkError instanceof Error
          ? bookmarkError.message
          : "Could not update bookmark",
      );
    }
  };

  const handleCopyCA = (e: React.MouseEvent, addr: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  };

  const handleOpenDex = (e: React.MouseEvent, token: TokenResult) => {
    e.stopPropagation();
    window.open(
      `https://dexscreener.com/${token.chainId}/${token.pairAddress}`,
      "_blank",
    );
  };

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", maxWidth: 480 }}
    >
      {/* ── Trigger ── */}
      <button
        className="wx-cs-trigger"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        style={{
          width: "100%",
          background: "var(--surface)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: open ? "rgba(var(--accent-rgb),.42)" : "var(--border)",
          borderRadius: 9,
          height: 36,
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: open ? "0 0 0 1px rgba(var(--accent-rgb),.14)" : "none",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border-strong)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          style={{ opacity: 0.25, flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" stroke="#fff" strokeWidth="2" />
          <path
            d="M21 21L16.65 16.65"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span
          className="wx-cs-label"
          style={{
            color: "#b8a59b",
            fontSize: 13,
            fontWeight: 550,
            flex: 1,
            textAlign: "left",
          }}
        >
          SEARCH TOKENS & TRADERS...
        </span>
        <kbd
          className="wx-cs-kbd"
          style={{
            color: "#1e1e1e",
            fontSize: 9,
            ...MONO,
            border: "1px solid rgba(255,165,125,.15)",
            borderRadius: 5,
            padding: "2px 6px",
            letterSpacing: 0,
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          ⌘K
        </kbd>
      </button>

      {/* ── Dropdown ── */}
      {open && wrapDrop(
        <div
          className="wx-cs-drop"
          ref={listRef}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 20px 60px #000000f0",
            zIndex: 99999,
          }}
        >
          <div
            className="wx-cs-tabs"
            style={{
              display: "flex",
              gap: 6,
              padding: "10px 12px 0",
            }}
          >
            {(["tokens", "people", "saved"] as const).map((mode) => {
              const active = searchMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setSearchMode(mode);
                    setResults([]);
                    setTraderResults([]);
                    setError(null);
                  }}
                  style={{
                    border: `1px solid ${active ? "rgba(var(--accent-rgb),.35)" : "var(--border)"}`,
                    background: active
                      ? "rgba(var(--accent-rgb),.12)"
                      : "transparent",
                    color: active ? "#ff9a70" : "#b8a59b",
                    padding: "7px 11px",
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "capitalize",
                    cursor: "pointer",
                  }}
                >
                  {mode === "people"
                    ? "Traders"
                    : mode === "saved"
                      ? "Saved"
                      : "Tokens"}
                </button>
              );
            })}
          </div>
          {/* Input row */}
          <div
            className="wx-cs-inputrow"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              gap: 10,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              style={{ opacity: 0.25, flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" stroke="#fff" strokeWidth="2" />
              <path
                d="M21 21L16.65 16.65"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(-1);
              }}
              onKeyDown={(e) => {
                const totalItems =
                  searchMode === "tokens"
                    ? results.length + quickTraders.length
                    : traderResults.length;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(i + 1, totalItems - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && activeIdx >= 0) {
                  e.preventDefault();
                  const link =
                    listRef.current?.querySelectorAll<HTMLAnchorElement>(
                      "[data-nav-item]",
                    )[activeIdx];
                  link?.click();
                }
              }}
              placeholder={
                searchMode === "tokens"
                  ? "Tokens & traders — name, ticker, @username..."
                  : searchMode === "saved"
                    ? "Search saved traders..."
                    : "Search traders by name or @username..."
              }
              autoFocus={typeof window !== "undefined" && !window.matchMedia("(hover: none) and (pointer: coarse)").matches}
              type="search"
              name="q"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              style={{
                flex: 1,
                minWidth: 0,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#fff4ee",
                fontSize: 14,
              }}
            />
            {loading && (
              <div
                style={{
                  width: 12,
                  height: 12,
                  border: "1.5px solid #222",
                  borderTop: "1.5px solid var(--accent)",
                  borderRadius: "50%",
                  animation: "wraith-spin 0.6s linear infinite",
                  flexShrink: 0,
                }}
              />
            )}
            {!loading && query && (
              <button
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setError(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2a2a2a",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            )}
            <button
              type="button"
              className="wx-cs-mob wx-cs-paste"
              onClick={async () => {
                try {
                  const t = (await navigator.clipboard.readText()).trim();
                  if (t) { setQuery(t); setActiveIdx(-1); }
                } catch { inputRef.current?.focus(); }
              }}
            >
              Paste
            </button>
            <button type="button" className="wx-cs-mob wx-cs-close" aria-label="Close search" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* Empty state — only if trending failed/returned nothing */}
          {searchMode === "tokens" &&
            !query &&
            !trendingLoading &&
            trending.length === 0 && (
              <div
                style={{
                  padding: "20px 14px",
                  color: "#b8a59b",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                SEARCH BY TICKER · NAME · CONTRACT ADDRESS
              </div>
            )}

          {/* Error */}
          {error && !loading && (query || searchMode !== "tokens") && (
            <div
              style={{
                padding: "18px 14px",
                color: "#d2bcb1",
                fontSize: 10,
                ...MONO,
                textAlign: "center",
                letterSpacing: ".08em",
              }}
            >
              {error}
            </div>
          )}

          {/* Trending (shown when no query yet) */}
          {searchMode === "tokens" && !query && !error && (
            <>
              {trendingLoading && !trending.length && (
                <div
                  style={{
                    padding: "20px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: "1.5px solid #222",
                      borderTop: "1.5px solid var(--accent)",
                      borderRadius: "50%",
                      animation: "wraith-spin 0.6s linear infinite",
                    }}
                  />
                  <span
                    style={{
                      color: "#333",
                      fontSize: 9,
                      ...MONO,
                      letterSpacing: ".1em",
                    }}
                  >
                    LOADING TRENDING
                  </span>
                </div>
              )}
              {recent.length > 0 && (
                <>
                  <div
                    style={{
                      padding: "9px 14px 5px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "var(--accent-text)",
                      fontSize: 8,
                      ...MONO,
                      letterSpacing: ".14em",
                    }}
                  >
                    <span>Recent searches</span>
                    <button
                      type="button"
                      onClick={clearRecent}
                      style={{ background: "transparent", border: 0, color: "#7d6e66", cursor: "pointer", fontSize: 9, ...MONO, letterSpacing: ".1em" }}
                    >
                      Clear all
                    </button>
                  </div>
                  {recent.map((token, i) => (
                    <TokenRow
                      key={`r-${token.address}`}
                      token={token}
                      isLast={i === recent.length - 1}
                      copiedAddr={copiedAddr}
                      onSelect={handleSelectToken}
                      onCopy={handleCopyCA}
                      onOpenDex={handleOpenDex}
                      showOpenCta
                    />
                  ))}
                </>
              )}
              {recentQ.length > 0 && (
                <div className="wx-cs-rq">
                  <div className="wx-cs-rq-head"><span>Other searches</span></div>
                  {recentQ.map((q) => (
                    <div key={q} className="wx-cs-rq-row">
                      <button type="button" className="wx-cs-rq-main" onClick={() => { setQuery(q); setActiveIdx(-1); }}>
                        <span className="wx-cs-rq-ico">↺</span>
                        <span className="wx-cs-rq-txt">{q}</span>
                      </button>
                      <button type="button" className="wx-cs-rq-x" aria-label="Remove" onClick={() => dropRecentQ(q)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {trending.length > 0 && (
                <div
                  style={{
                    padding: "9px 14px 5px",
                    color: "var(--accent-text)",
                    fontSize: 8,
                    ...MONO,
                    letterSpacing: ".14em",
                  }}
                >
                  TRENDING NOW
                </div>
              )}
              {trending.map((token, i) => (
                <TokenRow
                  key={`t-${token.address}`}
                  token={token}
                  isLast={i === trending.length - 1}
                  copiedAddr={copiedAddr}
                  onSelect={handleSelectToken}
                  onCopy={handleCopyCA}
                  onOpenDex={handleOpenDex}
                  showOpenCta
                />
              ))}
            </>
          )}

          {/* Results */}
          {searchMode === "tokens" && results.length > 0 && (
            <div className="wx-search-group-label">Tokens</div>
          )}
          {searchMode === "tokens" &&
            results.map((token, i) => (
              <TokenRow
                key={token.address}
                token={token}
                isLast={i === results.length - 1}
                copiedAddr={copiedAddr}
                onSelect={handleSelectToken}
                onCopy={handleCopyCA}
                onOpenDex={handleOpenDex}
                showOpenCta
              />
            ))}

          {/* Unified trader results shown when in tokens mode + query exists */}
          {searchMode === "tokens" && quickTraders.length > 0 && (
            <>
              <div className="wx-search-group-label">Traders</div>
              {quickTraders.map((trader) => {
                const href = trader.username
                  ? `/app/u/${encodeURIComponent(trader.username)}`
                  : `/app/u/${encodeURIComponent(trader.userId)}`;
                return (
                  <Link
                    key={trader.userId}
                    href={href}
                    data-nav-item
                    className="wx-search-trader-row"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <div className="wx-search-trader-avatar">
                      {trader.avatarDataUrl ? (
                        <img src={trader.avatarDataUrl} alt="" />
                      ) : (
                        trader.displayName.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="wx-search-trader-info">
                      <div className="wx-search-trader-name">
                        {trader.displayName}
                      </div>
                      <div className="wx-search-trader-meta">
                        {trader.username
                          ? `@${trader.username}`
                          : "Wraith trader"}
                        {" · "}
                        {trader.followerCount} follower
                        {trader.followerCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </>
          )}

          {searchMode !== "tokens" &&
            !loading &&
            !error &&
            traderResults.length === 0 && (
              <div
                style={{
                  padding: "22px 16px",
                  color: "#b8a59b",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                {searchMode === "saved"
                  ? "No saved traders yet. Search people and bookmark profiles to find them here."
                  : query.trim().length < 2
                    ? "Type at least 2 characters to search public traders."
                    : "No public traders found. Try a name or X username."}
              </div>
            )}

          {searchMode !== "tokens" &&
            traderResults.map((trader) => (
              <div
                key={trader.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderTop: "1px solid var(--border)",
                  color: "#fff4ee",
                }}
              >
                <Link
                  href={
                    trader.username
                      ? `/app/u/${encodeURIComponent(trader.username)}`
                      : `/app/u/${encodeURIComponent(trader.userId)}`
                  }
                  onClick={() => setOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    flex: 1,
                    minWidth: 0,
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      flexShrink: 0,
                      borderRadius: "50%",
                      background: trader.avatarDataUrl
                        ? `url("${trader.avatarDataUrl}") center/cover`
                        : "linear-gradient(135deg,#f05a24,#7b2f1a)",
                      border: "1px solid var(--border)",
                    }}
                  />
                  <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 14,
                        fontWeight: 650,
                      }}
                    >
                      {trader.displayName}
                    </span>
                    <span
                      style={{
                        color: "#b8a59b",
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {trader.username
                        ? `@${trader.username}`
                        : trader.xHandle
                          ? `@${trader.xHandle}`
                          : "WRAITH trader"}
                      {" · "}
                      {trader.closedTradeCount} trades
                    </span>
                  </span>
                </Link>
                <span
                  style={{
                    fontFamily: MONO.fontFamily,
                    fontVariantNumeric: "tabular-nums",
                    color: trader.profitSol >= 0 ? "#43cf83" : "#ff6f68",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  {trader.profitSol >= 0 ? "+" : ""}
                  {trader.profitSol.toFixed(2)} SOL
                </span>
                <button
                  type="button"
                  aria-label={
                    trader.isBookmarked ? "Remove bookmark" : "Bookmark trader"
                  }
                  title={
                    session?.user?.id
                      ? trader.isBookmarked
                        ? "Remove bookmark"
                        : "Bookmark trader"
                      : "Sign in to bookmark"
                  }
                  onClick={() => void toggleBookmark(trader)}
                  style={{
                    border: "1px solid var(--border)",
                    background: trader.isBookmarked
                      ? "rgba(240,90,36,.14)"
                      : "transparent",
                    color: trader.isBookmarked ? "#ff9a70" : "#b8a59b",
                    padding: 8,
                    cursor: "pointer",
                  }}
                >
                  <Bookmark
                    size={15}
                    fill={trader.isBookmarked ? "currentColor" : "none"}
                  />
                </button>
              </div>
            ))}

          <style>{`@keyframes wraith-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}

// ── Presets ─────────────────────────────────────────────────────────────────
// Header-level quick-buy preset manager — mirrors Telemetry's "P1 ⚠" button
// + slide-in panel. This is the same store (lib/quickBuyPresets.ts) the
// hover-card quick-buy row reads from, so switching or editing a preset
// here applies everywhere immediately.
function SlidersIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <line x1="4" y1="21" x2="4" y2="14" stroke={color} strokeWidth="2" />
      <line x1="4" y1="10" x2="4" y2="3" stroke={color} strokeWidth="2" />
      <line x1="12" y1="21" x2="12" y2="12" stroke={color} strokeWidth="2" />
      <line x1="12" y1="8" x2="12" y2="3" stroke={color} strokeWidth="2" />
      <line x1="20" y1="21" x2="20" y2="16" stroke={color} strokeWidth="2" />
      <line x1="20" y1="12" x2="20" y2="3" stroke={color} strokeWidth="2" />
      <circle cx="4" cy="12" r="2" stroke={color} strokeWidth="2" />
      <circle cx="12" cy="10" r="2" stroke={color} strokeWidth="2" />
      <circle cx="20" cy="14" r="2" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function PresetCard({
  preset,
  isActive,
  editing,
  onActivate,
  onToggleEdit,
  onSave,
  onDelete,
  canDelete,
}: {
  preset: QuickBuyPreset;
  isActive: boolean;
  editing: boolean;
  onActivate: () => void;
  onToggleEdit: () => void;
  onSave: (name: string, amounts: [number, number]) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [name, setName] = useState(preset.name);
  const [a, setA] = useState(preset.amounts[0].toString());
  const [b, setB] = useState(preset.amounts[1].toString());

  useEffect(() => {
    if (editing) {
      setName(preset.name);
      setA(preset.amounts[0].toString());
      setB(preset.amounts[1].toString());
    }
  }, [editing, preset]);

  function commit() {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    onSave(name.trim() || preset.name, [
      Number.isFinite(na) && na > 0 ? na : preset.amounts[0],
      Number.isFinite(nb) && nb > 0 ? nb : preset.amounts[1],
    ]);
  }

  return (
    <div
      onClick={!editing ? onActivate : undefined}
      style={{
        border: `1px solid ${isActive ? "rgba(var(--accent-rgb),0.3)" : "var(--border)"}`,
        borderRadius: 6,
        padding: "12px 14px",
        cursor: editing ? "default" : "pointer",
        background: isActive ? "rgba(var(--accent-rgb),0.06)" : "transparent",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: editing ? 10 : 8,
        }}
      >
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#0a0a0a",
              border: "1px solid #1e1e1e",
              borderRadius: 3,
              color: "#ddd",
              fontSize: 11,
              padding: "4px 7px",
              ...MONO,
              width: 110,
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#ccc",
              fontSize: 11,
              fontWeight: 700,
              ...MONO,
            }}
          >
            {preset.name}
            {isActive && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  color: "#00c47a",
                  fontSize: 9,
                  fontWeight: 400,
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="#00c47a"
                    strokeWidth="2"
                  />
                  <path
                    d="M8 12L11 15L16 9"
                    stroke="#00c47a"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                ACTIVE
              </span>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          {editing ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  commit();
                }}
                title="Save"
                style={{
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#0d1f18",
                  border: "1px solid #1c3a2c",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 12L10 18L20 6"
                    stroke="#00c47a"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEdit();
                }}
                title="Cancel"
                style={{
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#111",
                  border: "1px solid #1e1e1e",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M6 6L18 18M18 6L6 18"
                    stroke="#666"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEdit();
                }}
                title="Edit preset"
                style={{
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "1px solid #1a1a1a",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 20h9"
                    stroke="#555"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                    stroke="#555"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  title="Delete preset"
                  style={{
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "1px solid #1a1a1a",
                    borderRadius: 3,
                    cursor: "pointer",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M6 6L18 18M18 6L6 18"
                      stroke="#ff4444"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div style={{ display: "flex", gap: 8 }}>
          {[[a, setA] as const, [b, setB] as const].map(([val, setVal], i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 4 }}
            >
              <input
                value={val}
                onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ""))}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                inputMode="decimal"
                style={{
                  width: 54,
                  background: "#0a0a0a",
                  border: "1px solid #1e1e1e",
                  borderRadius: 3,
                  color: "#ddd",
                  fontSize: 10,
                  padding: "5px 6px",
                  ...MONO,
                }}
              />
              <span style={{ fontSize: 8, color: "#444", ...MONO }}>{readCurrency()}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14 }}>
          <div>
            <div
              style={{ color: "#333", fontSize: 8, ...MONO, marginBottom: 2 }}
            >
              BUY 1
            </div>
            <div
              style={{ color: "#888", fontSize: 11, fontWeight: 700, ...MONO }}
            >
              {symbolOf(readCurrency())}{preset.amounts[0]}
            </div>
          </div>
          <div>
            <div
              style={{ color: "#333", fontSize: 8, ...MONO, marginBottom: 2 }}
            >
              BUY 2
            </div>
            <div
              style={{ color: "#888", fontSize: 11, fontWeight: 700, ...MONO }}
            >
              {symbolOf(readCurrency())}{preset.amounts[1]}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PresetsPanel() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [presets, setPresets] = useState<QuickBuyPreset[]>(DEFAULT_PRESETS);
  const [activeId, setActiveId] = useState(DEFAULT_PRESETS[0].id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    setPresets(loadPresets());
    setActiveId(loadActivePresetId());
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const panel = document.getElementById("wraith-presets-panel");
      if (panel && panel.contains(e.target as Node)) return;
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setOpen(false);
      setEditingId(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const activePreset =
    presets.find((p) => p.id === activeId) ?? presets[0] ?? DEFAULT_PRESETS[0];

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  }

  function handleActivate(id: string) {
    setActiveId(id);
    saveActivePresetId(id);
  }

  function handleSave(id: string, name: string, amounts: [number, number]) {
    const next = presets.map((p) =>
      p.id === id ? { ...p, name, amounts } : p,
    );
    setPresets(next);
    savePresets(next);
    setEditingId(null);
  }

  function handleDelete(id: string) {
    if (presets.length <= 1) return;
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    savePresets(next);
    if (activeId === id) {
      handleActivate(next[0].id);
    }
  }

  function handleAdd() {
    const id = makePresetId();
    const next = [
      ...presets,
      {
        id,
        name: `Preset ${presets.length + 1}`,
        amounts: [0.1, 0.25] as [number, number],
      },
    ];
    setPresets(next);
    savePresets(next);
    setEditingId(id);
  }

  const panel =
    mounted && open
      ? createPortal(
          <div
            id="wraith-presets-panel"
            style={{
              position: "fixed",
              top: menuPos.top,
              right: menuPos.right,
              background: "#060606",
              border: "1px solid #111",
              borderRadius: 6,
              width: 300,
              maxHeight: "70vh",
              overflowY: "auto",
              zIndex: 99999,
              boxShadow: "0 8px 32px #000000cc",
              padding: 12,
              ...MONO,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                padding: "0 2px",
              }}
            >
              <span
                style={{
                  color: "#555",
                  fontSize: 9,
                  ...MONO,
                  letterSpacing: ".1em",
                }}
              >
                QUICK-BUY PRESETS
              </span>
              <button
                onClick={handleAdd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "transparent",
                  border: "1px solid #1e1e1e",
                  borderRadius: 4,
                  color: "#888",
                  fontSize: 9,
                  ...MONO,
                  padding: "4px 8px",
                  cursor: "pointer",
                  letterSpacing: ".05em",
                }}
              >
                + NEW
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  isActive={p.id === activeId}
                  editing={editingId === p.id}
                  onActivate={() => handleActivate(p.id)}
                  onToggleEdit={() =>
                    setEditingId((cur) => (cur === p.id ? null : p.id))
                  }
                  onSave={(name, amounts) => handleSave(p.id, name, amounts)}
                  onDelete={() => handleDelete(p.id)}
                  canDelete={presets.length > 1}
                />
              ))}
            </div>

            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid #0d0d0d",
                color: "#333",
                fontSize: 8,
                ...MONO,
                lineHeight: 1.5,
              }}
            >
              Applies to quick-buy on every token&apos;s hover chart. 50% / 100%
              buttons stay relative to your live paper balance.
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        type="button"
        className={`wx-preset-btn${open ? " is-open" : ""}`}
        title="Quick-buy presets"
        aria-label="Quick-buy presets"
      >
        <SlidersIcon color="currentColor" />
        <span style={{ fontSize: 10, ...MONO }}>
          {activePreset.name.replace(/^Preset /, "P")}
        </span>
      </button>
      {panel}
    </>
  );
}

// ── PIN lock helpers ─────────────────────────────────────────────────────────
const LAST_ACTIVE_KEY = "wraith_last_active";

function readPinEnabled(): boolean {
  try {
    return localStorage.getItem(PIN_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function readPinTimeout(): number {
  try {
    return parseInt(localStorage.getItem(PIN_TIMEOUT_KEY) ?? "300000", 10);
  } catch {
    return 300_000;
  }
}

function touchLastActive() {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {}
}

function isPinLockDue(): boolean {
  try {
    const pinOn = readPinEnabled() && !!localStorage.getItem(PIN_HASH_KEY);
    if (!pinOn && !biometricReady()) return false;
    const timeout = readPinTimeout();
    if (timeout === 0) return false; // "Never" lock
    const last = parseInt(localStorage.getItem(LAST_ACTIVE_KEY) ?? "0", 10);
    return Date.now() - last > timeout;
  } catch {
    return false;
  }
}

// ── PIN lock overlay ──────────────────────────────────────────────────────────
function PinLockOverlay({ onUnlock, onLogout }: { onUnlock: () => void; onLogout?: () => void }) {
  // Fingerprint-only lock (no passcode set): no keypad, just the fingerprint button.
  const [pinSet] = useState(() => { try { return readPinEnabled() && !!localStorage.getItem(PIN_HASH_KEY); } catch { return false; } });
  useEffect(() => { const r = requestAnimationFrame(() => document.documentElement.classList.remove("wx-prelock")); return () => cancelAnimationFrame(r); }, []);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Phones get the on-screen keypad (and no system keyboard); desktops just type.
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia("(hover: none) and (pointer: coarse)").matches);
  }, []);

  // Desktop only: keep the hidden input focused so typing (or paste) works anywhere.
  // On phones the on-screen keypad is used, and focusing an input there makes the keypad laggy.
  useEffect(() => {
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    inputRef.current?.focus();
    const refocus = () => inputRef.current?.focus();
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, []);

  // Fingerprint / face: opens the lock without typing the passcode.
  const [bio] = useState(() => (typeof window !== "undefined" ? biometricReady() : false));
  const tryBio = useCallback(async () => {
    if (unlocked) return;
    if (await biometricVerify()) {
      setUnlocked(true);
      touchLastActive();
      window.setTimeout(onUnlock, 220);
    }
  }, [unlocked, onUnlock]);
  useEffect(() => {
    if (bio) void tryBio();
    // run once when the lock screen appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pinSet || pin.length !== 6 || checking || unlocked) return;
    setChecking(true);
    void hashPin(pin, storedSalt()).then((h) => {
      const stored = localStorage.getItem(PIN_HASH_KEY);
      if (h === stored) {
        setUnlocked(true);
        touchLastActive();
        window.setTimeout(onUnlock, 220);
      } else {
        setError(true);
        window.setTimeout(() => {
          setPin("");
          setError(false);
          setChecking(false);
          if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) inputRef.current?.focus();
        }, 650);
      }
    }).catch(() => { setPin(""); setError(false); setChecking(false); });
  }, [pin, checking, unlocked, onUnlock]);

  // Safety net: if a check ever hangs (suspended tab, slow crypto), never leave the keypad dead.
  useEffect(() => {
    if (!checking || unlocked) return;
    const t = window.setTimeout(() => { setPin(""); setError(false); setChecking(false); }, 4000);
    return () => window.clearTimeout(t);
  }, [checking, unlocked]);

  // Typing digits is never blocked by a running check (only a full 6-digit entry is checked).
  const press = (d: string) => {
    if (unlocked) return;
    setPin((p) => (p.length < 6 ? p + d : p));
  };
  const back = () => {
    if (unlocked) return;
    setPin((p) => p.slice(0, -1));
  };
  const tone = error ? "#ff5a5a" : unlocked ? "#55cf91" : "#ff7b3d";

  return createPortal(
    <div className={`wpl${unlocked ? " wpl-open" : ""}`}>
      <style>{`
        .wpl{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;background:#060403;overflow:hidden;user-select:none;transition:opacity .5s ease,transform .6s ease,filter .5s ease}
        .wpl.wpl-open{opacity:0;transform:translateY(-3%) scale(1.04);filter:blur(10px);pointer-events:none}
        .wpl-mist{position:absolute;inset:-20%;pointer-events:none;background:radial-gradient(40% 35% at 25% 30%,rgba(255,123,61,.13),transparent 70%),radial-gradient(45% 40% at 78% 70%,rgba(255,80,20,.10),transparent 70%),radial-gradient(30% 30% at 60% 20%,rgba(255,170,110,.06),transparent 70%);animation:wpl-drift 18s ease-in-out infinite alternate}
        .wpl-mist.b{animation-duration:26s;animation-direction:alternate-reverse;opacity:.7;transform:scaleX(-1)}
        @keyframes wpl-drift{from{transform:translate3d(-4%,2%,0) scale(1)}to{transform:translate3d(5%,-3%,0) scale(1.12)}}
        .wpl-logo{position:relative;width:96px;height:96px;display:grid;place-items:center;margin-bottom:22px;animation:wpl-float 5s ease-in-out infinite}
        .wpl-logo::before,.wpl-logo::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:1px solid rgba(255,123,61,.35);animation:wpl-ring 3.2s ease-out infinite}
        .wpl-logo::after{animation-delay:1.6s}
        .wpl-logo>span{position:relative;width:46px;height:72px;display:block}
        @keyframes wpl-float{50%{transform:translateY(-8px)}}
        @keyframes wpl-ring{from{transform:scale(.7);opacity:.9}to{transform:scale(1.9);opacity:0}}
        .wpl h1{margin:0;color:#fff;font-size:15px;font-weight:800;letter-spacing:.42em;text-indent:.42em;text-transform:uppercase}
        .wpl-sub{margin-top:10px;min-height:18px;font-size:13px;color:#8c8077;letter-spacing:.04em}
        .wpl-orbs{display:flex;gap:16px;margin:30px 0 32px}
        .wpl-orbs.shake{animation:wpl-shake .45s}
        @keyframes wpl-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(9px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
        .wpl-orb{width:14px;height:14px;border-radius:50%;border:1.5px solid #3a2a20;background:transparent;transition:all .16s ease}
        .wpl-orb.on{border-color:var(--c);background:var(--c);box-shadow:0 0 14px var(--c),0 0 32px var(--c);transform:scale(1.18)}
        .wpl-pad[hidden]{display:none}
        .wpl-pad{display:grid;grid-template-columns:repeat(3,68px);gap:14px}
        .wpl-key{height:68px;border-radius:50%;border:1px solid #2a1f18;background:rgba(255,255,255,.025);color:#f3ece6;font:600 22px/1 var(--font-sans,system-ui);cursor:pointer;transition:background .12s,border-color .12s,transform .08s,box-shadow .12s}
        .wpl-key:hover{background:rgba(255,123,61,.10);border-color:rgba(255,123,61,.5)}
        .wpl-key:active{transform:scale(.92);box-shadow:0 0 22px rgba(255,123,61,.4)}
        .wpl-key.ghost{border-color:transparent;background:transparent;color:#8c8077;font-size:16px}
        .wpl-key.ghost:hover{color:#fff;background:transparent;border-color:transparent}
        .wpl-foot{margin-top:30px;font-size:12px;color:#6f655d}
        .wpl-foot button,.wpl-out{background:none;border:0;padding:0;color:#ff9a5c;font-weight:700;cursor:pointer;font-size:12px}
        .wpl-out{position:absolute;top:calc(max(var(--sai-top, 0px), env(safe-area-inset-top, 0px)) + 18px);right:16px;display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 14px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.04);color:#c9bfb7;font-weight:600;font-size:13px}
        @media (max-width:767px){.wpl-out{top:calc(max(var(--sai-top, 0px), env(safe-area-inset-top, 0px), 28px) + 18px)}}
        .wpl-out:hover{color:#fff}
        @media (max-width:480px){.wpl-pad{grid-template-columns:repeat(3,64px);gap:12px}.wpl-key{height:64px}.wpl-orbs{gap:13px}}
        @media (hover:none){.wpl-mist,.wpl-logo,.wpl-logo::before,.wpl-logo::after{animation:none}.wpl-key{transition:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent;outline:none}.wpl-key:hover,.wpl-key:focus,.wpl-key:active{background:rgba(255,255,255,.025);border-color:#2a1f18;transform:none;box-shadow:none}.wpl-key.ghost:hover,.wpl-key.ghost:focus,.wpl-key.ghost:active{background:transparent;border-color:transparent}.wpl-key.hit{background:rgba(255,123,61,.22)!important;border-color:rgba(255,123,61,.6)!important}.wpl-orb{transition:none}}
        @media (prefers-reduced-motion:reduce){.wpl-mist,.wpl-logo,.wpl-logo::before,.wpl-logo::after{animation:none}}
      `}</style>
      <div className="wpl-mist" />
      <div className="wpl-mist b" />

      {onLogout && (
        <button type="button" className="wpl-out" onClick={onLogout}>
          <LogOut size={14} /> Log out
        </button>
      )}

      <div className="wpl-logo">
        <span>
          <Image src="/logo.png" alt="" fill sizes="46px" style={{ objectFit: "contain", filter: "drop-shadow(0 0 16px rgba(255,123,61,0.6))" }} priority />
        </span>
      </div>
      <h1>The veil is down</h1>
      <div className="wpl-sub" style={{ color: error ? "#ff6b6b" : unlocked ? "#55cf91" : undefined }}>
        {error ? "Wrong sigil. Try again." : unlocked ? "Welcome back." : !pinSet ? "Touch the sensor to cross." : touch ? "Speak your sigil to cross." : "Type your sigil to cross."}
      </div>

      {pinSet ? (
        <>
      <div className={`wpl-orbs${error ? " shake" : ""}`} style={{ ["--c" as string]: tone }}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`wpl-orb${pin.length > i ? " on" : ""}`} />
        ))}
      </div>

      <div className="wpl-pad" hidden={!touch}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="wpl-key" onPointerDown={(e) => { e.preventDefault(); const el = e.currentTarget; el.classList.add("hit"); window.setTimeout(() => el.classList.remove("hit"), 110); press(d); }}>{d}</button>
        ))}
        {bio ? (
          <button type="button" className="wpl-key ghost" onPointerDown={(e) => { e.preventDefault(); void tryBio(); }} aria-label="Use fingerprint"><Fingerprint size={26} /></button>
        ) : <span />}
        <button type="button" className="wpl-key" onPointerDown={(e) => { e.preventDefault(); const el = e.currentTarget; el.classList.add("hit"); window.setTimeout(() => el.classList.remove("hit"), 110); press("0"); }}>0</button>
        <button type="button" className="wpl-key ghost" onPointerDown={(e) => { e.preventDefault(); back(); }} aria-label="Delete">⌫</button>
      </div>

      <input
        ref={inputRef}
        value={pin}
        onChange={(e) => {
          if (checking) return;
          setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
        }}
        onKeyDown={(e) => { if (e.key === "Backspace") { e.preventDefault(); back(); } }}
        inputMode={touch ? "none" : "numeric"}
        autoComplete="off"
        maxLength={6}
        aria-label="PIN"
        readOnly={touch}
        tabIndex={-1}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
      />

        </>
      ) : (
        <button type="button" className="wpl-bio" onPointerDown={(e) => { e.preventDefault(); void tryBio(); }} aria-label="Use fingerprint"><Fingerprint size={36} /></button>
      )}

      {pinSet && <div className="wpl-foot">
        Lost your sigil?{" "}
        {onLogout ? <button type="button" onClick={onLogout}>Log out and sign in again</button> : "Log out and sign in again."}
      </div>}
    </div>,
    document.body,
  );
}

// ── Security panel ────────────────────────────────────────────────────────────
type TotpStep = "idle" | "setup" | "verify";
type PinStep =
  | "idle"
  | "enter-new"
  | "confirm-new"
  | "enter-current"
  | "removing";

function SecurityPanel() {
  // The user's own enrolled methods. (useMfa().mfaMethods only lists what the app allows, which wrongly showed everything as ON.)
  const { user: privyUser, refreshUser } = usePrivyUser();
  const mfaMethods = privyUser?.mfaMethods ?? [];
  const {
    initEnrollmentWithTotp,
    submitEnrollmentWithTotp,
    unenrollWithTotp,
    initEnrollmentWithPasskey,
    unenrollWithPasskey,
    showMfaEnrollmentModal,
  } = useMfaEnrollment();
  const { linkWithPasskey } = useLinkWithPasskey();

  // TOTP state
  const [totpStep, setTotpStep] = useState<TotpStep>("idle");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpAuthUrl, setTotpAuthUrl] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);

  // Passkey state
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

  // PIN state
  const [pinEnabled, setPinEnabled] = useState(() => readPinEnabled());
  const [pinTimeout, setPinTimeout] = useState(() => readPinTimeout());
  const [pinStep, setPinStep] = useState<PinStep>("idle");
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  // Fingerprint / face unlock for the app lock (per device: it lives in this phone's secure hardware)
  const [bioOn, setBioOn] = useState(false);
  const [bioOk, setBioOk] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState("");
  useEffect(() => {
    setBioOk(appLockSupported());
    const sync = () => setBioOn(appLockEnabled());
    sync();
    window.addEventListener("wraith:applock-changed", sync);
    return () => window.removeEventListener("wraith:applock-changed", sync);
  }, []);
  const enableBio = async () => {
    if (bioBusy) return;
    setBioError("");
    setBioBusy(true);
    try {
      if (!(await enableAppLock())) setBioError("Not enabled");
      else touchLastActive();
    } catch (e) {
      setBioError((e as { name?: string })?.name === "NotAllowedError" ? "Cancelled" : (e instanceof Error && e.message ? e.message : "Set a screen lock on your phone first"));
    } finally {
      setBioBusy(false);
    }
  };

  const totpEnrolled = mfaMethods.includes("totp");
  const passkeyEnrolled = mfaMethods.includes("passkey");

  // ── TOTP ──────────────────────────────────────────────────────────────────
  const startTotp = async () => {
    setTotpError("");
    setTotpBusy(true);
    try {
      const result = await initEnrollmentWithTotp();
      setTotpSecret(result.secret);
      setTotpAuthUrl(result.authUrl);
      setTotpStep("setup");
    } catch (e: unknown) {
      setTotpError(e instanceof Error ? e.message : "Failed to start setup");
    } finally {
      setTotpBusy(false);
    }
  };

  const verifyTotp = async () => {
    if (totpCode.length !== 6) return;
    setTotpError("");
    setTotpBusy(true);
    try {
      await submitEnrollmentWithTotp({ mfaCode: totpCode.replace(/\D/g, "") });
      setTotpStep("idle");
      setTotpCode("");
      setTotpSecret("");
      setTotpAuthUrl("");
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "";
      setTotpError(
        !m || /verif|invalid|incorrect|code/i.test(m)
          ? "That code didn’t match. Use the newest “Wraith” entry in your authenticator, enter it before it refreshes, and make sure your phone’s date and time are set to automatic. If you scanned an older QR, remove that entry and scan the current one."
          : m,
      );
      setTotpCode("");
    } finally {
      setTotpBusy(false);
    }
  };

  const removeTotp = async () => {
    setTotpError("");
    setTotpBusy(true);
    try {
      await unenrollWithTotp();
    } catch (e: unknown) {
      setTotpError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setTotpBusy(false);
    }
  };

  // ── Passkey ──────────────────────────────────────────────────────────────
  const addPasskey = async () => {
    console.log("[passkey] add clicked");
    setPasskeyError("");
    setPasskeyBusy(true);
    try {
      // A passkey has to exist on the account before it can be used as a second factor.
      const hasPasskey = (privyUser?.linkedAccounts ?? []).some((a) => a.type === "passkey");
      if (!hasPasskey) {
        console.log("[passkey] creating passkey…");
        await linkWithPasskey({ name: "Wraith" });
      }
      console.log("[passkey] enrolling as second factor…");
      await initEnrollmentWithPasskey();
      console.log("[passkey] enrollment finished");
      // refresh once, slowly: Privy rate-limits /users/me (429) if we ask twice in a row
      await new Promise((r) => setTimeout(r, 1500));
      let fresh = await refreshUser().catch(async () => {
        await new Promise((r) => setTimeout(r, 3500));
        return refreshUser().catch(() => null);
      });
      if (!fresh?.mfaMethods?.includes("passkey")) {
        // The silent enroll didn't register it — hand over to Privy's own enrollment screen.
        console.log("[passkey] not enrolled yet, opening Privy enrollment screen");
        showMfaEnrollmentModal();
      }
    } catch (e: unknown) {
      console.error("[passkey]", e);
      const o = e as { message?: string; privyErrorCode?: string; name?: string } | null;
      const detail = [o?.privyErrorCode, o?.name, o?.message].filter(Boolean).join(" · ");
      setPasskeyError(detail || "Passkey setup didn’t finish. Check for a Windows Hello / browser passkey prompt, then try again.");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const removePasskey = async () => {
    setPasskeyError("");
    setPasskeyBusy(true);
    try {
      await unenrollWithPasskey();
    } catch (e: unknown) {
      setPasskeyError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setPasskeyBusy(false);
    }
  };

  // ── PIN ───────────────────────────────────────────────────────────────────
  const PIN_TIMEOUTS = [
    { label: "Never", value: 0 },
    { label: "1 minute", value: 60_000 },
    { label: "5 minutes", value: 300_000 },
    { label: "15 minutes", value: 900_000 },
  ];

  const savePinTimeout = (ms: number) => {
    setPinTimeout(ms);
    try {
      localStorage.setItem(PIN_TIMEOUT_KEY, String(ms));
    } catch {}
    if (pinEnabled) void pushLockTimeout(ms);
  };

  const beginSetPin = () => {
    setPinInput("");
    setPinConfirm("");
    setPinError("");
    setPinStep("enter-new");
  };

  const beginRemovePin = () => {
    setPinInput("");
    setPinError("");
    setPinStep("enter-current");
  };

  const submitNewPin = async () => {
    if (pinInput.length !== 6) {
      setPinError("PIN must be exactly 6 digits");
      return;
    }
    if (pinStep === "enter-new") {
      setPinConfirm(pinInput);
      setPinInput("");
      setPinError("");
      setPinStep("confirm-new");
      return;
    }
    if (pinStep === "confirm-new") {
      if (pinInput !== pinConfirm) {
        setPinError("PINs don't match — try again");
        setPinInput("");
        setPinStep("enter-new");
        setPinConfirm("");
        return;
      }
      setPinBusy(true);
      try {
        const salt = newSalt();
        const h = await hashPin(pinInput, salt);
        const timeoutMs = pinTimeout || 300_000;
        saveLocalPin(h, salt, timeoutMs);
        setPinTimeout(timeoutMs);
        void pushLockPin(h, salt, timeoutMs); // the same PIN now works on every device signed in to this account
        touchLastActive();
        setPinEnabled(true);
        setPinStep("idle");
        setPinInput("");
        setPinConfirm("");
        setPinError("");
      } finally {
        setPinBusy(false);
      }
    }
  };

  const submitRemovePin = async () => {
    if (pinInput.length !== 6) {
      setPinError("PIN must be exactly 6 digits");
      return;
    }
    setPinBusy(true);
    try {
      const h = await hashPin(pinInput, storedSalt());
      const stored = localStorage.getItem(PIN_HASH_KEY);
      if (h !== stored) {
        setPinError("Incorrect PIN");
        setPinInput("");
        setPinBusy(false);
        return;
      }
      clearLocalPin();
      void clearServerPin();
      setPinEnabled(false);
      setPinStep("idle");
      setPinInput("");
      setPinError("");
    } finally {
      setPinBusy(false);
    }
  };

  const Row = ({
    icon: Icon,
    label,
    enrolled,
    busy,
    error,
    onEnable,
    onDisable,
    enableLabel = "Enable",
    disableLabel = "Remove",
  }: {
    icon: typeof Shield;
    label: string;
    enrolled: boolean;
    busy: boolean;
    error: string;
    onEnable: () => void;
    onDisable: () => void;
    enableLabel?: string;
    disableLabel?: string;
  }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon
          size={15}
          strokeWidth={1.7}
          color={enrolled ? "#ff7b3d" : "#444"}
        />
        <span
          style={{ flex: 1, fontSize: 13, color: enrolled ? "#ccc" : "#666" }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1,
            color: enrolled ? "#ff7b3d" : "#333",
            background: enrolled ? "rgba(255,123,61,0.1)" : "#141414",
            border: `1px solid ${enrolled ? "rgba(255,123,61,0.3)" : "#222"}`,
            borderRadius: 4,
            padding: "2px 6px",
          }}
        >
          {enrolled ? "ON" : "OFF"}
        </span>
        {busy ? (
          <Loader2
            size={14}
            color="#555"
            style={{ animation: "wraith-spin 0.8s linear infinite" }}
          />
        ) : enrolled ? (
          <button
            type="button"
            onClick={onDisable}
            style={{
              fontSize: 11,
              color: "#888",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: 3,
            }}
          >
            {disableLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onEnable}
            style={{
              fontSize: 11,
              color: "#ff7b3d",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: 3,
            }}
          >
            {enableLabel}
          </button>
        )}
      </div>
      {error && (
        <span style={{ fontSize: 11, color: "#ff4444", paddingLeft: 25 }}>
          {error}
        </span>
      )}
    </div>
  );

  return (
    <div className="wraith-account-modal-body" style={{ gap: 20 }}>
      {/* ── AUTHENTICATOR APP ────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.5,
            color: "#444",
          }}
        >
          TWO-FACTOR AUTHENTICATION
        </span>

        <Row
          icon={Smartphone}
          label="Authenticator app (TOTP)"
          enrolled={totpEnrolled}
          busy={totpBusy && totpStep === "idle"}
          error={totpStep === "idle" ? totpError : ""}
          onEnable={startTotp}
          onDisable={removeTotp}
          enableLabel="Set up"
        />

        {totpStep === "setup" && (
          <div
            style={{
              marginLeft: 25,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "12px 14px",
              background: "#0d0d0d",
              borderRadius: 8,
              border: "1px solid #1e1e1e",
            }}
          >
            <p
              style={{
                fontSize: 12,
                color: "#888",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Open your authenticator app (Google Authenticator, Authy, etc.)
              and scan this QR code (or add a new account using the secret key
              below).
            </p>
            {totpAuthUrl && (
              <div className="wx-totp-qr" style={{ alignSelf: "center", padding: 10, background: "#fff", borderRadius: 10, lineHeight: 0 }}>
                <QRCodeSVG value={totpAuthUrl} size={156} level="M" />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>
                SECRET KEY
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 13,
                  color: "#ccc",
                  background: "#111",
                  borderRadius: 6,
                  padding: "8px 10px",
                  border: "1px solid #222",
                }}
              >
                <span style={{ flex: 1, wordBreak: "break-all" }}>
                  {totpSecret}
                </span>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(totpSecret).catch(() => {}); }}
                  className="wx-totp-copy"
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    color: "#666",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="wx-totp-phone-hint">
              On this phone you can’t scan the QR code. Tap the button to open your authenticator app, or copy the secret key and choose “Enter a setup key” in the app.
            </p>
            <a
              href={totpAuthUrl}
              className="wx-totp-open"
              style={{ fontSize: 12, color: "#ff7b3d", textDecoration: "none" }}
            >
              Open in authenticator app ↗
            </a>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 10, color: "#555", letterSpacing: 1 }}>
                ENTER 6-DIGIT CODE TO VERIFY
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  autoComplete="one-time-code"
                  style={{
                    flex: 1,
                    background: "#111",
                    border: `1px solid ${totpError ? "#ff4444" : "#222"}`,
                    borderRadius: 6,
                    color: "#fff",
                    padding: "8px 10px",
                    fontSize: 16,
                    fontFamily: "var(--font-mono, monospace)",
                    letterSpacing: 4,
                    outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={verifyTotp}
                  disabled={totpCode.length !== 6 || totpBusy}
                  style={{
                    padding: "8px 14px",
                    background: totpCode.length === 6 ? "#ff7b3d" : "#1a1a1a",
                    border: "none",
                    borderRadius: 6,
                    color: totpCode.length === 6 ? "#000" : "#333",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: totpCode.length === 6 ? "pointer" : "not-allowed",
                    transition: "all 0.15s",
                  }}
                >
                  Verify
                </button>
              </div>
              {totpError && (
                <span style={{ fontSize: 11, color: "#ff4444" }}>
                  {totpError}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setTotpStep("idle");
                setTotpCode("");
                setTotpError("");
              }}
              style={{
                fontSize: 11,
                color: "#555",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {typeof navigator !== "undefined" && !/WraithApp/.test(navigator.userAgent) && (
          <Row
          icon={Fingerprint}
          label="Passkey"
          enrolled={passkeyEnrolled}
          busy={passkeyBusy}
          error={passkeyError}
          onEnable={addPasskey}
          onDisable={removePasskey}
          enableLabel="Add"
        />
        )}
      </div>

      <div style={{ borderTop: "1px solid #1a1a1a" }} />

      {/* ── APP PIN LOCK ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.5,
            color: "#444",
          }}
        >
          APP PIN LOCK
        </span>

        <Row
          icon={KeyRound}
          label="6-digit PIN lock (all your devices)"
          enrolled={pinEnabled}
          busy={pinBusy && pinStep === "idle"}
          error={pinStep === "idle" ? pinError : ""}
          onEnable={beginSetPin}
          onDisable={beginRemovePin}
          enableLabel="Set up"
          disableLabel="Remove"
        />

        {bioOk && (
          <Row
            icon={Fingerprint}
            label="Fingerprint / face unlock (this device)"
            enrolled={bioOn}
            busy={bioBusy}
            error={bioError}
            onEnable={() => void enableBio()}
            onDisable={disableAppLock}
            enableLabel="Turn on"
            disableLabel="Turn off"
          />
        )}

        {pinEnabled && pinStep === "idle" && (
          <div
            style={{
              marginLeft: 25,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "#666", flex: 1 }}>
                Auto-lock after
              </span>
              <select
                value={String(pinTimeout)}
                onChange={(e) => savePinTimeout(parseInt(e.target.value, 10))}
                style={{
                  background: "#111",
                  border: "1px solid #222",
                  borderRadius: 6,
                  color: "#ccc",
                  fontSize: 12,
                  padding: "4px 8px",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {PIN_TIMEOUTS.map(({ label, value }) => (
                  <option key={value} value={String(value)}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={beginSetPin}
              style={{
                fontSize: 11,
                color: "#666",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                padding: 0,
              }}
            >
              Change PIN
            </button>
          </div>
        )}

        {(pinStep === "enter-new" || pinStep === "confirm-new") && (
          <div
            style={{
              marginLeft: 25,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "12px 14px",
              background: "#0d0d0d",
              borderRadius: 8,
              border: "1px solid #1e1e1e",
            }}
          >
            <span style={{ fontSize: 12, color: "#888" }}>
              {pinStep === "enter-new"
                ? "Choose a 6-digit PIN:"
                : "Confirm your PIN:"}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pinInput}
                onChange={(e) => {
                  setPinError("");
                  setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                placeholder="······"
                autoComplete="new-password"
                style={{
                  flex: 1,
                  background: "#111",
                  border: `1px solid ${pinError ? "#ff4444" : "#222"}`,
                  borderRadius: 6,
                  color: "#fff",
                  padding: "8px 10px",
                  fontSize: 20,
                  letterSpacing: 6,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={submitNewPin}
                disabled={pinInput.length !== 6 || pinBusy}
                style={{
                  padding: "8px 14px",
                  background: pinInput.length === 6 ? "#ff7b3d" : "#1a1a1a",
                  border: "none",
                  borderRadius: 6,
                  color: pinInput.length === 6 ? "#000" : "#333",
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: pinInput.length === 6 ? "pointer" : "not-allowed",
                }}
              >
                {pinStep === "enter-new" ? "Next" : "Confirm"}
              </button>
            </div>
            {pinError && (
              <span style={{ fontSize: 11, color: "#ff4444" }}>{pinError}</span>
            )}
            <button
              type="button"
              onClick={() => {
                setPinStep("idle");
                setPinInput("");
                setPinError("");
              }}
              style={{
                fontSize: 11,
                color: "#555",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {pinStep === "enter-current" && (
          <div
            style={{
              marginLeft: 25,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "12px 14px",
              background: "#0d0d0d",
              borderRadius: 8,
              border: "1px solid #1e1e1e",
            }}
          >
            <span style={{ fontSize: 12, color: "#888" }}>
              Enter your current PIN to remove it:
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pinInput}
                onChange={(e) => {
                  setPinError("");
                  setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                placeholder="······"
                autoComplete="current-password"
                style={{
                  flex: 1,
                  background: "#111",
                  border: `1px solid ${pinError ? "#ff4444" : "#222"}`,
                  borderRadius: 6,
                  color: "#fff",
                  padding: "8px 10px",
                  fontSize: 20,
                  letterSpacing: 6,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={submitRemovePin}
                disabled={pinInput.length !== 6 || pinBusy}
                style={{
                  padding: "8px 14px",
                  background: pinInput.length === 6 ? "#ff4444" : "#1a1a1a",
                  border: "none",
                  borderRadius: 6,
                  color: pinInput.length === 6 ? "#fff" : "#333",
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: pinInput.length === 6 ? "pointer" : "not-allowed",
                }}
              >
                Remove
              </button>
            </div>
            {pinError && (
              <span style={{ fontSize: 11, color: "#ff4444" }}>{pinError}</span>
            )}
            <button
              type="button"
              onClick={() => {
                setPinStep("idle");
                setPinInput("");
                setPinError("");
              }}
              style={{
                fontSize: 11,
                color: "#555",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        <div style={{ marginLeft: 25 }}>
          <p
            style={{
              fontSize: 11,
              color: "#3a3a3a",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Same PIN on all your devices. It is stored only as a salted hash and locks Wraith when you leave it for a while.
          </p>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #1a1a1a" }} />

      {/* ── Connected accounts ───────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.5,
            color: "#444",
          }}
        >
          SIGN-IN METHOD
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={15} strokeWidth={1.7} color="#22c55e" />
          <span style={{ fontSize: 13, color: "#888" }}>
            Google sign-in active
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────
interface HeaderProps {
  onSelectMeme?: (meme: MemeTrend) => void;
}

export default function Header({ onSelectMeme }: HeaderProps) {
  const { data: session, status: sessionStatus, logout } = useWraithSession();
  const { tier, canUse } = useWraithTier();
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  // avatarReady = we know what the account's saved photo is (from this browser's last visit or from the server).
  // Until then the header shows a neutral placeholder instead of flashing the default ghost.
  const [avatarReady, setAvatarReady] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(
    null,
  );
  const [displayCurrency, setDisplayCurrency] =
    useState<DisplayCurrency>("USD");
  // Paint the remembered photo and name on the first frame, and start the profile request right now. It is authenticated by the
  // app session cookie, so it no longer waits for the wallet SDK to initialise (that wait was the long ghost-avatar delay).
  useEffect(() => {
    const cached = readHeaderProfile();
    if (cached) {
      setProfileAvatar(cached.avatar);
      setProfileDisplayName(cached.name);
      setAvatarReady(true);
    }
    let active = true;
    void loadHeaderProfile().then((p) => {
      if (!active) return;
      setAvatarReady(true);
      if (!p) return; // signed out or offline: keep whatever we painted from the cache
      setProfileAvatar(p.avatar);
      setProfileDisplayName(p.name);
      if (isDisplayCurrency(p.currency)) {
        setDisplayCurrency(p.currency);
        try { localStorage.setItem("wraith_display_currency_v1", p.currency); } catch { /* ignore */ }
      }
      writeHeaderProfile(p);
    });
    return () => { active = false; };
  }, []);
  // Signed out for real (not just "still loading"): forget the photo and name.
  useEffect(() => {
    if (sessionStatus !== "unauthenticated") return;
    setProfileAvatar(null);
    setProfileDisplayName(null);
  }, [sessionStatus]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const isAdmin = useIsAdmin();
  const [termsRequired, setTermsRequired] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [profileDialog, setProfileDialog] = useState<ProfileDialog | null>(
    null,
  );
  const [transfersTab, setTransfersTab] = useState<"receive" | "send">(
    "receive",
  );
  const [tgLinking, setTgLinking] = useState(false);
  const [tgLinked, setTgLinked] = useState(false);
  const [tgDisconnecting, setTgDisconnecting] = useState(false);
  const [tgTooltip, setTgTooltip] = useState(false);
  const [blurBalances, setBlurBalances] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [mounted, setMounted] = useState(false);
  const [pinLocked, setPinLocked] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const hoverOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // same rule as every other tool: open to everyone while the free beta is on, otherwise by OMEN tier. It used to look at the tier
  // only, so during the beta the row stayed locked ("SPECTER TIER REQUIRED") and an already linked account could not even disconnect.
  const canUseTelegram = canUse("telegram_alerts") || TELEGRAM_TIERS.includes(tier?.key ?? "");
  const canUsePaper = canUse("paper_trading");

  useEffect(() => {
    const savedCurrency = localStorage.getItem("wraith_display_currency_v1");
    if (isDisplayCurrency(savedCurrency)) setDisplayCurrency(savedCurrency);

    const onCurrencyUpdated = (event: Event) => {
      const currency = (event as CustomEvent<DisplayCurrency>).detail;
      if (isDisplayCurrency(currency)) setDisplayCurrency(currency);
    };
    window.addEventListener("wraith:currency-sync", onCurrencyUpdated);

    // The profile page announces saves here so the header updates without a reload (and the remembered copy stays current).
    const onProfileUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          avatarDataUrl?: string;
          displayName?: string;
          displayCurrency?: DisplayCurrency;
        }>
      ).detail;
      const avatar = detail?.avatarDataUrl || null;
      const name = detail?.displayName || null;
      setProfileAvatar(avatar);
      setProfileDisplayName(name);
      setAvatarReady(true);
      if (isDisplayCurrency(detail?.displayCurrency)) {
        setDisplayCurrency(detail.displayCurrency);
      }
      const prev = readHeaderProfile();
      writeHeaderProfile({
        uid: prev?.uid ?? null,
        username: prev?.username ?? null,
        currency: isDisplayCurrency(detail?.displayCurrency) ? detail.displayCurrency : (prev?.currency ?? null),
        avatar,
        name,
      });
    };
    window.addEventListener("wraith:profile-updated", onProfileUpdated);
    return () => {
      window.removeEventListener("wraith:profile-updated", onProfileUpdated);
      window.removeEventListener("wraith:currency-sync", onCurrencyUpdated);
    };
  }, []);

  const changeDisplayCurrency = async (value: string) => {
    if (!isDisplayCurrency(value)) return;
    const previousCurrency = displayCurrency;
    setDisplayCurrency(value);
    localStorage.setItem("wraith_display_currency_v1", value);
    window.dispatchEvent(
      new CustomEvent("wraith:currency-sync", { detail: value }),
    );
    if (!session?.user) {
      setProfileDialog(null);
      return;
    }
    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayCurrency: value }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "Could not save currency preference.");
      }
      setProfileDialog(null);
    } catch (error) {
      console.error("[header currency]", error);
      setDisplayCurrency(previousCurrency);
      localStorage.setItem("wraith_display_currency_v1", previousCurrency);
      window.dispatchEvent(
        new CustomEvent("wraith:currency-sync", {
          detail: previousCurrency,
        }),
      );
      window.alert(
        "Could not save your currency preference. Please try again.",
      );
    }
  };

  const acceptTerms = async (inviteCode = "") => {
    if (termsSaving) return;
    setTermsSaving(true);
    setTermsError("");
    try {
      // an invite code typed here is checked FIRST, so a typo is caught before you are let in (leave it empty to skip)
      if (inviteCode.trim().length >= 5) {
        const r = await fetch("/api/quests/referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: inviteCode }) });
        const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
        // a code that was already credited from an invite link answers "already added": that is fine, carry on
        if (j && j.ok === false && !/already added/i.test(j.message ?? "")) throw new Error(j.message ?? "That invite code did not work.");
      }
      try { localStorage.setItem("wraith_ref_prompt_v1", "1"); } catch { /* storage blocked */ } // the separate invite card never re-asks
      const response = await fetch("/api/user/terms", { method: "POST" });
      if (response.status === 401 || response.status === 403) {
        throw new Error("Session expired — log out and sign in again.");
      }
      if (!response.status.toString().startsWith("2")) {
        throw new Error(`Server error (${response.status}). Try again.`);
      }
      setTermsRequired(false);
      setTermsChecked(false);
    } catch (error) {
      setTermsError(
        error instanceof Error
          ? error.message
          : "Could not save your acceptance.",
      );
    } finally {
      setTermsSaving(false);
    }
  };

  // Same PIN on phone and desktop: pull the account's PIN once signed in.
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void syncLockFromAccount().then((changed) => { if (changed) touchLastActive(); });
  }, [sessionStatus]);

  useEffect(() => {
    setMounted(true);
    const hidden = localStorage.getItem("wraith_blur_balances_v1") === "true";
    setBlurBalances(hidden);
    document.documentElement.classList.toggle("wraith-blur-balances", hidden);

    // Check if PIN lock is due on mount
    if (isPinLockDue()) {
      setPinLocked(true);
    } else {
      touchLastActive();
      document.documentElement.classList.remove("wx-prelock");
    }

    // Poll for auto-lock timeout while the tab is open
    lastActivityTimerRef.current = setInterval(() => {
      if (isPinLockDue()) {
        setPinLocked(true);
        if (lastActivityTimerRef.current) {
          clearInterval(lastActivityTimerRef.current);
          lastActivityTimerRef.current = null;
        }
      }
    }, 30_000);

    // Update last-active on any user interaction
    const bump = () => {
      if (readPinEnabled()) touchLastActive();
    };
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("keydown", bump, { passive: true });

    return () => {
      if (lastActivityTimerRef.current)
        clearInterval(lastActivityTimerRef.current);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const menu = document.getElementById("wraith-user-menu");
      if (menu && menu.contains(e.target as Node)) return;
      if (
        profileBtnRef.current &&
        profileBtnRef.current.contains(e.target as Node)
      )
        return;
      setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!profileDialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileDialog(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [profileDialog]);

  useEffect(() => {
    const openDeposit = () => { setUserMenuOpen(false); setTransfersTab("receive"); setProfileDialog("deposit"); };
    window.addEventListener("wraith:open-deposit", openDeposit);
    return () => window.removeEventListener("wraith:open-deposit", openDeposit);
  }, []);

  useEffect(() => {
    if (!session) return;
    fetch("/api/user/telegram-status")
      .then((r) => r.json())
      .then((d) => {
        if (d.linked) setTgLinked(true);
      })
      .catch(() => {});
  }, [session]);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch("/api/user/telegram-status");
        const d = await r.json();
        if (d.linked) {
          setTgLinked(true);
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {
        /* silent */
      }
      if (attempts >= 40) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (hoverOpenRef.current) clearTimeout(hoverOpenRef.current);
      if (hoverCloseRef.current) clearTimeout(hoverCloseRef.current);
      if (lastActivityTimerRef.current)
        clearInterval(lastActivityTimerRef.current);
    };
  }, []);

  const handleConnectTelegram = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canUseTelegram || tgLinked) return;
    setTgLinking(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
        startPolling();
      }
    } catch {
      /* silent */
    } finally {
      setTgLinking(false);
    }
  };

  const handleDisconnectTelegram = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tgLinked || tgDisconnecting) return;
    setTgDisconnecting(true);
    try {
      // Mirrors /api/telegram/link — add this route alongside it if it
      // doesn't exist yet; it should clear the stored chat id for the user.
      await fetch("/api/telegram/unlink", { method: "POST" });
      setTgLinked(false);
    } catch {
      /* silent */
    } finally {
      setTgDisconnecting(false);
    }
  };

  const positionMenu = () => {
    if (profileBtnRef.current) {
      const rect = profileBtnRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
  };

  // phones/tablets have no hover: a tap on the avatar opens the menu instead of jumping to the profile
  const isTouchUi = () => typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches;

  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hoverOpenRef.current) clearTimeout(hoverOpenRef.current);
    if (hoverCloseRef.current) clearTimeout(hoverCloseRef.current);
    if (isTouchUi()) {
      positionMenu();
      setUserMenuOpen((v) => !v);
      return;
    }
    setUserMenuOpen(false);
    window.location.href = "/app/profile";
  };

  const handleProfileMouseEnter = () => {
    if (isTouchUi()) return;
    if (hoverCloseRef.current) clearTimeout(hoverCloseRef.current);
    if (hoverOpenRef.current) clearTimeout(hoverOpenRef.current);
    positionMenu();
    setUserMenuOpen(true);
  };

  const handleProfileMouseLeave = () => {
    if (isTouchUi()) return;
    if (hoverOpenRef.current) clearTimeout(hoverOpenRef.current);
    hoverCloseRef.current = setTimeout(() => setUserMenuOpen(false), 200);
  };

  const handleMenuMouseEnter = () => {
    if (hoverCloseRef.current) clearTimeout(hoverCloseRef.current);
  };

  const handleMenuMouseLeave = () => {
    if (isTouchUi()) return;
    hoverCloseRef.current = setTimeout(() => setUserMenuOpen(false), 200);
  };

  const toggleBalancePrivacy = () => {
    const next = !blurBalances;
    setBlurBalances(next);
    localStorage.setItem("wraith_blur_balances_v1", String(next));
    document.documentElement.classList.toggle("wraith-blur-balances", next);
  };

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setTermsRequired(false);
      setTermsChecked(false);
      return;
    }
    let active = true;
    fetch("/api/user/terms", { cache: "no-store" })
      .then(async (response) => {
        // 401/403 means our session cookie is stale — don't block the user
        // with a terms dialog they can't accept.
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new Error(`Server error ${response.status}`);
        return (await response.json()) as { accepted: boolean };
      })
      .then((result) => {
        if (!active || result === null) return;
        setTermsRequired(!result.accepted);
      })
      .catch((err: unknown) => {
        // Server/network failure — skip the dialog silently rather than
        // forcing the user into a modal they can't dismiss.
        console.warn("[terms check]", err instanceof Error ? err.message : err);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [userMenuOpen]);

  const avatarLoading = !profileAvatar && !avatarReady;
  const avatarSrc =
    profileAvatar ||
    (avatarReady ? session?.user?.image : null) ||
    defaultAvatar(session?.user?.email ?? session?.user?.name ?? "wraith");

  const userMenu =
    mounted && userMenuOpen && session
      ? createPortal(
          <>
          <div className="wraith-profile-backdrop" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
          <div
            id="wraith-user-menu"
            className="wraith-profile-menu"
            style={{ top: menuPos.top, right: menuPos.right }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={handleMenuMouseEnter}
            onMouseLeave={handleMenuMouseLeave}
            role="menu"
            aria-label="Profile menu"
          >
            <div className="wraith-profile-menu-account">
              {avatarLoading ? (
                <span className="wraith-profile-menu-avatar wraith-avatar-skel" aria-hidden="true" style={{ display: "block", width: 40, height: 40 }} />
              ) : (
                <Image
                  src={avatarSrc}
                  alt=""
                  width={40}
                  height={40}
                  className="wraith-profile-menu-avatar"
                  unoptimized
                />
              )}
              <div className="wraith-profile-menu-identity">
                <strong>
                  {profileDisplayName || session.user?.name || "Your account"}
                </strong>
                <span>{session.user?.email ?? "Signed in"}</span>
              </div>
            </div>
            <TierCard />

            <div className="wraith-profile-menu-group">
              <ProfileMenuItem
                icon={UserRound}
                label="Profile"
                href="/app/profile"
                onClick={() => setUserMenuOpen(false)}
              />
              <ProfileMenuItem
                icon={Gift}
                label="Quests & airdrop"
                href="/app/quests"
                onClick={() => setUserMenuOpen(false)}
              />
              {isAdmin && (
                <ProfileMenuItem
                  icon={Shield}
                  label="Admin"
                  href="/app/admin"
                  onClick={() => setUserMenuOpen(false)}
                />
              )}
              <ProfileMenuItem
                icon={LayoutDashboard}
                label="Manage account"
                onClick={() => {
                  setUserMenuOpen(false);
                  setProfileDialog("account");
                }}
              />
              <ProfileMenuItem
                icon={Shield}
                label="Security"
                onClick={() => {
                  setUserMenuOpen(false);
                  setProfileDialog("security");
                }}
              />
              <ProfileMenuItem
                icon={Settings2}
                label="Settings"
                onClick={() => {
                  setUserMenuOpen(false);
                  setProfileDialog("settings");
                }}
              />
              <ProfileMenuItem
                icon={CircleDollarSign}
                label="Currency"
                detail={displayCurrency}
                onClick={() => {
                  setUserMenuOpen(false);
                  setProfileDialog("currency");
                }}
              />
              {typeof window !== "undefined" && readPinEnabled() && !!localStorage.getItem(PIN_HASH_KEY) && (
                <ProfileMenuItem
                  icon={LockIcon}
                  label="Lock now"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setPinLocked(true);
                  }}
                />
              )}
              <ProfileMenuItem
                icon={ArrowLeftRight}
                label="Transfers"
                onClick={() => {
                  setUserMenuOpen(false);
                  setTransfersTab("receive");
                  setProfileDialog("transfers");
                }}
              />
            </div>

            <div className="wraith-profile-menu-group">
              <button
                className="wraith-profile-menu-item"
                type="button"
                onClick={toggleBalancePrivacy}
                role="menuitemcheckbox"
                aria-checked={blurBalances}
              >
                <EyeOff size={17} strokeWidth={1.8} />
                <span className="wraith-profile-menu-label">Blur balances</span>
                <span
                  className={`wraith-profile-switch${blurBalances ? " is-on" : ""}`}
                  aria-hidden="true"
                >
                  <span />
                </span>
              </button>
              <ProfileMenuItem
                icon={Gift}
                label="Rewards"
                detail="Soon"
                disabled
              />
              <ProfileMenuItem
                icon={LifeBuoy}
                label="Contact support"
                detail="Soon"
                disabled
              />
            </div>

            <div
              style={{ position: "relative" }}
              onMouseEnter={() => !canUseTelegram && setTgTooltip(true)}
              onMouseLeave={() => setTgTooltip(false)}
            >
              <button
                onClick={
                  !canUseTelegram
                    ? undefined
                    : tgLinked
                      ? handleDisconnectTelegram
                      : handleConnectTelegram
                }
                disabled={tgLinking || tgDisconnecting}
                style={{
                  width: "100%",
                  background: tgLinked ? "#001a0d" : "transparent",
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
                  borderBottom: "1px solid #0d0d0d",
                  color: tgLinked
                    ? "#00c47a"
                    : canUseTelegram
                      ? "#2b9fd4"
                      : "#2a2a2a",
                  fontSize: 10,
                  ...MONO,
                  padding: "10px 14px",
                  cursor: canUseTelegram ? "pointer" : "default",
                  textAlign: "left",
                  letterSpacing: ".06em",
                  transition: "background .15s, color .15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (!canUseTelegram) return;
                  if (tgLinked) {
                    e.currentTarget.style.background = "#200a0a";
                    e.currentTarget.style.color = "#ff6b6b";
                  } else {
                    e.currentTarget.style.background = "#0a1520";
                    e.currentTarget.style.color = "#3ab8f0";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!canUseTelegram) return;
                  if (tgLinked) {
                    e.currentTarget.style.background = "#001a0d";
                    e.currentTarget.style.color = "#00c47a";
                  } else {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#2b9fd4";
                  }
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ flexShrink: 0, opacity: canUseTelegram ? 1 : 0.3 }}
                >
                  <path
                    d="M22 2L11 13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M22 2L15 22L11 13L2 9L22 2Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  {tgLinking
                    ? "OPENING..."
                    : tgDisconnecting
                      ? "DISCONNECTING..."
                      : tgLinked
                        ? "DISCONNECT TELEGRAM"
                        : "CONNECT TELEGRAM"}
                </span>
                {tgLinked && !tgDisconnecting && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#00c47a",
                      boxShadow: "0 0 6px #00c47a88",
                      marginLeft: "auto",
                      flexShrink: 0,
                    }}
                  />
                )}
                {!canUseTelegram && (
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    style={{ marginLeft: "auto", opacity: 0.4 }}
                  >
                    <rect
                      x="3"
                      y="11"
                      width="18"
                      height="11"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M7 11V7C7 4.24 9.24 2 12 2C14.76 2 17 4.24 17 7V11"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </button>
              {tgTooltip && !canUseTelegram && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 14,
                    background: "#0a0a0a",
                    border: "1px solid #1a1a1a",
                    borderRadius: 4,
                    padding: "6px 10px",
                    fontSize: 9,
                    color: "var(--accent-text)",
                    ...MONO,
                    whiteSpace: "nowrap",
                    zIndex: 300,
                    letterSpacing: ".05em",
                    pointerEvents: "none",
                  }}
                >
                  SPECTER TIER REQUIRED
                  <div
                    style={{
                      position: "absolute",
                      bottom: -4,
                      left: 12,
                      width: 7,
                      height: 7,
                      background: "#0a0a0a",
                      border: "1px solid #1a1a1a",
                      borderTop: "none",
                      borderLeft: "none",
                      transform: "rotate(45deg)",
                    }}
                  />
                </div>
              )}
            </div>

            {/* Paper trading is a tier perk: users without it only saw a dead, greyed-out "LIVE" row, so it is hidden for them */}
            {canUsePaper && (
            <button
              onClick={() => {
                const key = "wraith_paper_mode_v1";
                const current = JSON.parse(
                  localStorage.getItem(key) || "false",
                );
                if (!current && !canUsePaper) return; // blocked: turning ON requires tier
                localStorage.setItem(key, JSON.stringify(!current));
                window.dispatchEvent(new Event("wraith:paper-mode-sync"));
                setUserMenuOpen(false);
              }}
              disabled={!canUsePaper}
              title={
                !canUsePaper ? "Paper mode is unavailable" : undefined
              }
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid #0d0d0d",
                color: canUsePaper ? "#ccc" : "#2a2a2a",
                fontSize: 11,
                ...MONO,
                padding: "11px 14px",
                cursor: canUsePaper ? "pointer" : "default",
                textAlign: "left",
                letterSpacing: ".03em",
                transition: "background .15s",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
              onMouseEnter={(e) => {
                if (canUsePaper) e.currentTarget.style.background = "#0d0d0d";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <ModeIcon color={canUsePaper ? "#888" : "#2a2a2a"} />
              <span style={{ flex: 1 }}>Trading mode</span>
              <TradingModeBadge locked={!canUsePaper} />
              {!canUsePaper && (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ opacity: 0.5, flexShrink: 0 }}
                >
                  <rect
                    x="3"
                    y="11"
                    width="18"
                    height="11"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M7 11V7C7 4.24 9.24 2 12 2C14.76 2 17 4.24 17 7V11"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </button>
            )}
            <button
              onClick={() => {
                void logout().then(() => window.location.assign("/login"));
              }}
              className="wraith-profile-menu-item is-danger"
              type="button"
              role="menuitem"
            >
              <LogOut size={17} strokeWidth={1.8} />
              <span className="wraith-profile-menu-label">Log out</span>
            </button>
          </div>
          </>,
          document.body,
        )
      : null;

  const termsDialog =
    mounted && session && termsRequired
      ? createPortal(
          <OnboardingFlow
            nameHint={session?.user?.name ?? session?.user?.email ?? ""}
            saving={termsSaving}
            error={termsError}
            onAccept={(c) => acceptTerms(c)}
            onLogout={() => { void logout().then(() => window.location.assign("/login")); }}
          />,
          document.body,
        )
      : null;

  return (
    <>
      <AutoExit enabled={canUse("auto_sell")} />
      {LIVE_EXIT_WALLETS && <LiveAutoExit enabled={canUse("auto_sell")} />}
      {mounted && pinLocked && (
        <PinLockOverlay
          onUnlock={() => {
            setPinLocked(false);
            touchLastActive();
          }}
          onLogout={() => {
            setPinLocked(false);
            void logout();
          }}
        />
      )}
      {termsDialog}
      <MobileTabBar />
      <header className="wraith-app-header">
        {/* ── LEFT: branding ── */}
        {isMobile ? (
        <Link href="/app" aria-label="WRAITH dashboard" className="wraith-header-brand">
          <span
            style={{
              width: 28,
              height: 28,
              position: "relative",
              flexShrink: 0,
            }}
          >
            <Image
              src="/logo.svg"
              alt=""
              fill
              sizes="28px"
              style={{
                objectFit: "contain",
                mixBlendMode: "screen",
                filter: "drop-shadow(0 0 5px rgba(var(--accent-rgb),0.35))",
              }}
              priority
            />
          </span>
          {!isMobile && (
            <span
              style={{
                color: "#f5ede8",
                fontSize: 16,
                fontWeight: 900,
                letterSpacing: ".22em",
                lineHeight: 1,
              }}
            >
              WRAITH
            </span>
          )}
        </Link>
        ) : (
        <>
        <span className="wraith-header-brand" aria-label="WRAITH" style={{ cursor: "default" }}>
          <span
            style={{
              width: 28,
              height: 28,
              position: "relative",
              flexShrink: 0,
            }}
          >
            <Image
              src="/logo.svg"
              alt=""
              fill
              sizes="28px"
              style={{
                objectFit: "contain",
                mixBlendMode: "screen",
                filter: "drop-shadow(0 0 5px rgba(var(--accent-rgb),0.35))",
              }}
              priority
            />
          </span>
          {!isMobile && (
            <span
              style={{
                color: "#f5ede8",
                fontSize: 16,
                fontWeight: 900,
                letterSpacing: ".22em",
                lineHeight: 1,
              }}
            >
              WRAITH
            </span>
          )}
        </span>
        <Link href="/app" className="wraith-discover" aria-label="Discover: back to the market">Discover</Link>
        </>
        )}

        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          <CoinSearch onSelectMeme={onSelectMeme} />
        </div>

        {/* ── RIGHT: wallet + user ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 5 : 8,
            flexShrink: 0,
          }}
        >
          {!isMobile && <PresetsPanel />}
          {PRIVY_WALLETS_ENABLED ? (
            <EmbeddedWalletBalanceChip
              currency={displayCurrency}
              onDeposit={() => {
                setUserMenuOpen(false);
                setTransfersTab("receive");
                setProfileDialog("deposit");
              }}
              onWithdraw={() => {
                setUserMenuOpen(false);
                setTransfersTab("send");
                setProfileDialog("withdraw");
              }}
            />
          ) : (
            <span className="embedded-wallet-header-chip">
              <span>WALLET VALUE</span>
              <strong>—</strong>
            </span>
          )}

          {session && <NotificationBell />}

          {session && (
            <div style={{ flexShrink: 0 }}>
              <button
                ref={profileBtnRef}
                className="wraith-profile-trigger"
                onClick={handleProfileClick}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-controls="wraith-user-menu"
                aria-label="Open profile menu"
                style={{
                  background: "transparent",
                  border: "none",
                  borderRadius: "50%",
                  padding: 0,
                  width: 38,
                  height: 38,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "filter .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.filter = "brightness(1.12)";
                  handleProfileMouseEnter();
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = "none";
                  handleProfileMouseLeave();
                }}
              >
                {avatarLoading ? (
                  <span className="wraith-header-avatar wraith-avatar-skel" aria-hidden="true" style={{ borderRadius: "50%", display: "block", width: 32, height: 32 }} />
                ) : (
                  <Image
                    src={avatarSrc}
                    alt="avatar"
                    width={32}
                    height={32}
                    className="wraith-header-avatar"
                    style={{ borderRadius: "50%", display: "block" }}
                    unoptimized
                  />
                )}
              </button>
            </div>
          )}
        </div>
      </header>

      {userMenu}
      {profileDialog &&
        mounted &&
        createPortal(
          <div
            className="wraith-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setProfileDialog(null);
            }}
          >
            <section
              className="wraith-account-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="wraith-account-modal-title"
            >
              <header className="wraith-account-modal-heading">
                <div>
                  <span className="profile-eyebrow">WRAITH ACCOUNT</span>
                  <h2 id="wraith-account-modal-title">
                    {
                      {
                        account: "Manage account",
                        security: "Security",
                        settings: "Settings",
                        currency: "Currency",
                        deposit: "Deposit",
                        withdraw: "Withdraw",
                        transfers: "Transfers",
                      }[profileDialog]
                    }
                  </h2>
                </div>
                <button
                  type="button"
                  className="wraith-modal-close"
                  aria-label="Close"
                  onClick={() => setProfileDialog(null)}
                >
                  <X size={18} />
                </button>
              </header>
              {profileDialog === "account" && (
                <div className="wraith-account-modal-body">
                  <div className="wraith-account-email">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.5-4.1 6.9-10.2 6.9-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
                      GOOGLE ACCOUNT
                    </span>
                    <strong>
                      {session?.user?.email ?? "Signed-in account"}
                    </strong>
                  </div>
                  {PRIVY_WALLETS_ENABLED ? (
                    <EmbeddedWalletOverview />
                  ) : (
                    <PrivyConfigurationNotice />
                  )}
                  <Link
                    className="wraith-modal-secondary-link"
                    href="/app/profile#profile-settings"
                    onClick={() => setProfileDialog(null)}
                  >
                    Edit profile
                  </Link>
                </div>
              )}
              {profileDialog === "currency" && (
                <div className="wraith-account-modal-body">
                  <p>Choose the currency used for displayed value estimates.</p>
                  <StyledSelect
                    id="wraith-profile-currency-modal"
                    value={displayCurrency}
                    onChange={(value) => void changeDisplayCurrency(value)}
                    ariaLabel="Display currency"
                    options={DISPLAY_CURRENCIES.map((currency) => ({
                      value: currency.code,
                      label: `${currency.code} · ${currency.label}`,
                    }))}
                  />
                </div>
              )}
              {profileDialog === "security" && <SecurityPanel />}
              {profileDialog === "settings" && (
                <div className="wraith-account-modal-body">
                  <label className="wraith-account-email">
                    <span>LANGUAGE</span>
                    <strong>English</strong>
                  </label>
                  <Link
                    className="wraith-modal-secondary-link"
                    href="/app/profile#profile-settings"
                    onClick={() => setProfileDialog(null)}
                  >
                    Edit profile
                  </Link>
                  <button
                    className="wraith-modal-secondary-link"
                    type="button"
                    onClick={() => setProfileDialog("account")}
                  >
                    Account and addresses
                  </button>
                  <button
                    className="wraith-modal-secondary-link"
                    type="button"
                    onClick={() => setProfileDialog("security")}
                  >
                    Security
                  </button>
                </div>
              )}
              {profileDialog === "transfers" && (
                <div className="wraith-account-modal-body">
                  {PRIVY_WALLETS_ENABLED ? (
                    <TransfersHistory />
                  ) : (
                    <PrivyConfigurationNotice />
                  )}
                </div>
              )}
              {(profileDialog === "deposit" || profileDialog === "withdraw") && (
                <div className="wraith-account-modal-body">
                  {PRIVY_WALLETS_ENABLED ? (
                    <EmbeddedWalletTransfers
                      key={profileDialog}
                      initialTab={profileDialog === "withdraw" ? "send" : "receive"}
                      onClose={() => setProfileDialog(null)}
                    />
                  ) : (
                    <PrivyConfigurationNotice />
                  )}
                </div>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
