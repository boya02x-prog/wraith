"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { usePrivy, useWallets as useEthereumWallets } from "@privy-io/react-auth";
import { useSignTransaction, useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { AlertTriangle, ChevronDown, Copy, ExternalLink, Globe, LoaderCircle, Send, Wallet } from "lucide-react";
import { C } from "@/lib/theme";
import type { MemeTrend } from "@/app/app/page";
import { useToast } from "@/components/Toast";
import { executeQuickBuy, executeQuickSell, explorerUrl, SwapError, SOL_MINT } from "@/lib/jupiterSwap";
import { PRIVY_WALLETS_ENABLED } from "@/lib/privyConfig";
import { formatCurrency, isDisplayCurrency, type DisplayCurrency } from "@/lib/currencies";
import { useSandboxToken } from "@/lib/useSandboxTokens";
import TestTradeDock from "@/components/TestTradeDock";
import { AboutBlock, DockFrame, FINE_PRINT, NO_CASH_NOTE, PositionBlock } from "@/components/DockParts";
import ChainLogo from "@/components/ChainLogo";
import { VIEM_CHAINS } from "@/lib/cashTokens";
import { execEvmRoute, friendlyError, lifiQuote, SOLANA_LIFI_ID, waitForRoute } from "@/lib/lifi";
import { useCashSources } from "@/lib/useCashSources";
import { useWraithTier } from "@/hooks/useWraithTier";
import ExitBox, { type ExitPrefs } from "@/components/ExitBox";
import WalletWatch from "@/components/WalletWatch";
import SizeHint from "@/components/SizeHint";
import { getLiveUsdPrice } from "@/lib/livePrice";
import { getMcap } from "@/lib/getTokenPrice";
import { armLiveExit, disarmLiveExit, EXIT_PREFS_KEY, LIVE_EXIT_FIRED, LIVE_EXITS_EVENT, readRules, type LiveExitRule } from "@/lib/liveExits";
import { parseUnits } from "viem";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
const CASH_PRESETS_USD = [5, 10, 25, 50];
const SELL_PRESETS = [25, 50, 100];

type Props = { meme: MemeTrend | null; initialMode?: "buy" | "sell" };
type Mode = "buy" | "sell";
type MarketSnapshot = {
  name: string | null;
  symbol: string | null;
  description: string | null;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  dexId: string | null;
  pairCreatedAt: number | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
};

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function readMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatChange(value: number | null): string {
  if (value === null) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAge(timestamp: number | null): string {
  if (timestamp === null || timestamp <= 0) return "-";
  const ageMs = Date.now() - timestamp;
  if (ageMs < 0) return "-";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TokenTradeDock({ meme, initialMode }: Props) {
  if (!PRIVY_WALLETS_ENABLED) return <UnconfiguredDock meme={meme} />;
  return <EmbeddedTradeDock meme={meme} initialMode={initialMode} />;
}

function UnconfiguredDock({ meme }: Props) {
  return (
    <DockFrame>
      <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
        Embedded wallet trading is not configured for this deployment.
      </div>
    </DockFrame>
  );
}

function EmbeddedTradeDock({ meme, initialMode }: Props) {
  const mint = meme?.contractAddress || "";
  const symbol = (meme?.keyword || "TOKEN").toUpperCase();
  const sandboxToken = useSandboxToken(mint);
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { connection } = useConnection();
  const { push } = useToast();
  const cash = useCashSources("solana");
  const { wallets: evmWallets } = useEthereumWallets();
  const [srcId, setSrcId] = useState("");
  useEffect(() => { setSrcId((c) => (c && cash.sources.some((h) => h.id === c) ? c : cash.sources[0]?.id ?? "")); }, [cash.sources]);
  const src = cash.sources.find((x) => x.id === srcId) ?? null;
  const [mode, setMode] = useState<Mode>(initialMode ?? "buy");
  const [amountCash, setAmountCash] = useState("10");
  const [sellPercent, setSellPercent] = useState(100);
  const [warnOpen, setWarnOpen] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<{ amount: string; quantity: number; decimals: number } | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const [currencyRate, setCurrencyRate] = useState<number | null>(1);
  const [tokenUsd, setTokenUsd] = useState<number | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { canUse } = useWraithTier();
  const [exitOn, setExitOn] = useState(false);
  const [exitPrefs, setExitPrefs] = useState<ExitPrefs>({ tp: "100", sl: "30", trail: "0", tp1: "0", tp1Sell: "40", hold: "0", risk: "1" });
  const [armedRule, setArmedRule] = useState<LiveExitRule | null>(null);
  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(EXIT_PREFS_KEY) || "null"); if (p && typeof p === "object") { setExitPrefs((c) => ({ ...c, ...p.prefs })); setExitOn(!!p.on); } } catch { /* none */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(EXIT_PREFS_KEY, JSON.stringify({ on: exitOn, prefs: exitPrefs })); } catch { /* full */ } }, [exitOn, exitPrefs]);
  useEffect(() => {
    const sync = () => setArmedRule(readRules().find((r) => r.mint === mint) ?? null);
    sync();
    const fired = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; symbol: string; mint: string; pnl: number };
      if (d.mint !== mint) return;
      const label = d.kind === "tp1" ? "First target hit, part sold" : d.kind === "time" ? "Time stop hit" : d.kind === "tp" ? "Take-profit hit" : d.kind === "sl" ? "Stop-loss hit" : d.kind === "trail" ? "Trailing stop hit" : d.kind === "gone" ? "Auto-exit cancelled — no tokens left" : "Auto-exit failed — sell manually";
      push(`${label} · ${d.symbol} ${d.pnl >= 0 ? "+" : ""}${d.pnl.toFixed(0)}%`, d.kind === "failed" ? "error" : d.kind === "sl" ? "warning" : "success", { timeoutMs: 9000 });
    };
    window.addEventListener(LIVE_EXITS_EVENT, sync);
    window.addEventListener(LIVE_EXIT_FIRED, fired);
    return () => { window.removeEventListener(LIVE_EXITS_EVENT, sync); window.removeEventListener(LIVE_EXIT_FIRED, fired); };
  }, [mint, push]);
  const previousCurrencyRate = useRef<number | null>(1);

  const embeddedAccount = user?.linkedAccounts.find((account) =>
    account.type === "wallet" && account.chainType === "solana" && account.walletClientType === "privy",
  );
  const embeddedWallet = embeddedAccount?.type === "wallet"
    ? wallets.find((wallet) => wallet.address === embeddedAccount.address)
    : undefined;
  const embeddedAddress = embeddedAccount?.type === "wallet" ? embeddedAccount.address : null;
  const publicKey = useMemo(
    () => embeddedAddress ? new PublicKey(embeddedAddress) : null,
    [embeddedAddress],
  );
  const shortAddress = embeddedAddress
    ? `${embeddedAddress.slice(0, 5)}...${embeddedAddress.slice(-4)}`
    : "Wallet not ready";
  const amountUsd = currencyRate && currencyRate > 0
    ? Number(amountCash) / currencyRate
    : 0;
  const sellPercentFinal = sellPercent;

  const tradeDisabledReason = busy
    ? "Waiting for wallet confirmation..."
    : !mint
      ? "Token address is unavailable."
      : !embeddedWallet || !publicKey
        ? "Embedded wallet is still loading."
        : mode === "buy"
          ? currencyRate === null
            ? "Loading exchange rate..."
            : !Number.isFinite(amountUsd) || amountUsd <= 0
              ? `Enter a ${displayCurrency} amount greater than zero.`
              : !cash.loaded
                ? "Loading your cash balance..."
                : !src
                  ? NO_CASH_NOTE
                  : amountUsd > src.balance + 1e-9
                    ? `Only ${formatCurrency(src.balance * (currencyRate ?? 1), displayCurrency)} ${src.symbol} on ${src.chainName}. Pick another source or lower the amount.`
                    : src.kind === "solana" && cashBalance !== null && cashBalance < 0.005
                      ? "Keep about 0.005 SOL in your Solana wallet for network fees."
                      : null
          : !tokenBalance
            ? "Loading your token balance..."
            : tokenBalance.quantity <= 0
              ? `No ${symbol} available to sell.`
              : null;
  const tradeDisabled = tradeDisabledReason !== null;
  const buyCount = marketSnapshot?.buys24h;
  const sellCount = marketSnapshot?.sells24h;
  const activityComplete = buyCount !== null && buyCount !== undefined && sellCount !== null && sellCount !== undefined;
  const activityTotal = (buyCount ?? 0) + (sellCount ?? 0);
  const buyShare = activityComplete && activityTotal > 0 ? (buyCount / activityTotal) * 100 : 0;

  const warnings: Array<{ title: string; body: string }> = [];
  if (marketSnapshot) {
    const m = marketSnapshot;
    if (m.liquidity !== null && m.liquidity !== undefined && m.liquidity > 0 && m.liquidity < 10_000) warnings.push({ title: "Low liquidity", body: `Only ${formatCurrency(m.liquidity, "USD")} in the pool. Big buys move the price and exiting can be hard.` });
    if (m.pairCreatedAt) {
      const ageMin = (Date.now() - m.pairCreatedAt) / 60_000;
      if (ageMin >= 0 && ageMin < 60) warnings.push({ title: "Brand new token", body: `Launched ${Math.max(1, Math.round(ageMin))} min ago. Early tokens are extremely volatile.` });
    }
    if (activityComplete && activityTotal >= 20 && buyShare < 40) warnings.push({ title: "Sell pressure", body: `Only ${buyShare.toFixed(0)}% of the last 24h trades were buys.` });
    if (m.priceChange.h1 !== null && m.priceChange.h1 !== undefined && m.priceChange.h1 > 150) warnings.push({ title: "Pumped hard", body: `Up ${m.priceChange.h1.toFixed(0)}% in the last hour. You may be buying the top.` });
    if (m.priceChange.h1 !== null && m.priceChange.h1 !== undefined && m.priceChange.h1 < -40) warnings.push({ title: "Dumping", body: `Down ${Math.abs(m.priceChange.h1).toFixed(0)}% in the last hour.` });
    if (m.volume24h !== null && m.volume24h !== undefined && m.volume24h < 5_000) warnings.push({ title: "Very low volume", body: "Almost nobody is trading this right now." });
    if (!m.website && !m.twitter && !m.telegram) warnings.push({ title: "Unverified token", body: "No website or socials linked. Do your own research." });
  }


  useEffect(() => {
    const savedCurrency = localStorage.getItem("wraith_display_currency_v1");
    if (isDisplayCurrency(savedCurrency)) setDisplayCurrency(savedCurrency);
    const onCurrency = (event: Event) => {
      const nextCurrency = (event as CustomEvent<DisplayCurrency>).detail;
      if (isDisplayCurrency(nextCurrency)) setDisplayCurrency(nextCurrency);
    };
    window.addEventListener("wraith:currency-sync", onCurrency);
    return () => window.removeEventListener("wraith:currency-sync", onCurrency);
  }, []);

  useEffect(() => {
    let active = true;
    if (displayCurrency === "USD") {
      setCurrencyRate(1);
      return () => { active = false; };
    }
    setCurrencyRate(null);
    fetch(`/api/fx?currency=${displayCurrency}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { rate?: unknown }) => {
        if (active && typeof payload.rate === "number" && Number.isFinite(payload.rate) && payload.rate > 0) setCurrencyRate(payload.rate);
      })
      .catch((error) => {
        console.error("[trade currency rate]", error);
        if (active) setCurrencyRate(null);
      });
    return () => { active = false; };
  }, [displayCurrency]);

  useEffect(() => {
    if (currencyRate === null) return;
    const previousRate = previousCurrencyRate.current;
    if (previousRate !== null && previousRate !== currencyRate) {
      setAmountCash((current) => (Number(current) / previousRate * currencyRate).toFixed(2));
    }
    previousCurrencyRate.current = currencyRate;
  }, [currencyRate]);

  useEffect(() => {
    let active = true;
    setTokenUsd(null);
    setMarketSnapshot(null);
    setSolUsd(null);
    const refreshPrices = async () => {
      try {
        const solResponse = await fetch(`/api/price?ids=${SOL_MINT}`, { cache: "no-store" });
        const solPayload = await solResponse.json();
        const currentSolUsd = Number(solPayload?.data?.[SOL_MINT]?.price ?? solPayload?.[SOL_MINT]?.usdPrice ?? solPayload?.[SOL_MINT]?.price);
        if (active && Number.isFinite(currentSolUsd) && currentSolUsd > 0) setSolUsd(currentSolUsd);
        const tokenResponse = mint ? await fetch(`/api/token-price?mint=${encodeURIComponent(mint)}`, { cache: "no-store" }) : null;
        const tokenPayload = tokenResponse?.ok ? await tokenResponse.json() : null;
        if (!active) return;
        let priceUsd = Number(tokenPayload?.priceUsd);
        if (tokenPayload) {
          const priceChange = tokenPayload.priceChange;
          setMarketSnapshot({
            name: readText(tokenPayload.name),
            symbol: readText(tokenPayload.symbol),
            description: readText(tokenPayload.description),
            marketCap: readMetric(tokenPayload.marketCap),
            liquidity: readMetric(tokenPayload.liquidity),
            volume24h: readMetric(tokenPayload.volume24h),
            buys24h: readMetric(tokenPayload.buys24h),
            sells24h: readMetric(tokenPayload.sells24h),
            priceChange: {
              m5: readMetric(priceChange?.m5),
              h1: readMetric(priceChange?.h1),
              h6: readMetric(priceChange?.h6),
              h24: readMetric(priceChange?.h24),
            },
            dexId: readText(tokenPayload.dexId),
            pairCreatedAt: readMetric(tokenPayload.pairCreatedAt),
            website: readText(tokenPayload.website),
            twitter: readText(tokenPayload.twitter),
            telegram: readText(tokenPayload.telegram),
          });
        }
        if ((!Number.isFinite(priceUsd) || priceUsd <= 0) && mint) {
          const fallbackResponse = await fetch(`/api/price?ids=${encodeURIComponent(mint)}`, { cache: "no-store" });
          const fallbackPayload = await fallbackResponse.json();
          priceUsd = Number(fallbackPayload?.[mint]?.usdPrice ?? fallbackPayload?.[mint]?.price);
        }
        if (active && Number.isFinite(priceUsd) && priceUsd > 0) setTokenUsd(priceUsd);
      } catch (error) {
        console.error("[trade market prices]", error);
      }
    };
    void refreshPrices();
    const timer = visibleInterval(() => void refreshPrices(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [mint]);

  const refreshTokenBalance = useCallback(async () => {
    if (!mint || !publicKey) { setTokenBalance(null); return; }
    try {
      const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(mint) });
      const value = accounts.value.reduce((sum, account) => {
        const info = account.account.data.parsed.info.tokenAmount;
        return { raw: sum.raw + BigInt(info.amount), decimals: info.decimals };
      }, { raw: BigInt(0), decimals: 0 });
      const quantity = Number(value.raw) / 10 ** value.decimals;
      setTokenBalance({ amount: quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }), quantity, decimals: value.decimals });
    } catch { setTokenBalance(null); }
  }, [connection, mint, publicKey]);

  const refreshCashBalance = useCallback(async () => {
    if (!publicKey) { setCashBalance(null); return; }
    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      setCashBalance(lamports / 1e9);
    } catch {
      setCashBalance(null);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refreshTokenBalance();
    void refreshCashBalance();
    const timer = window.setInterval(() => { if (!document.hidden) void refreshTokenBalance(); }, 20_000);
    const cashTimer = window.setInterval(() => { if (!document.hidden) void refreshCashBalance(); }, 45_000);
    return () => { window.clearInterval(timer); window.clearInterval(cashTimer); };
  }, [refreshCashBalance, refreshTokenBalance]);

  const trade = async () => {
    if (!mint || !embeddedWallet || !publicKey || busy) return;
    if (mode === "buy" && (!Number.isFinite(amountUsd) || amountUsd <= 0)) {
      push(`Enter a ${displayCurrency} amount greater than zero.`, "warning");
      return;
    }
    setBusy(true);
    const wallet = {
      publicKey,
      signTransaction: async (transaction: VersionedTransaction) => {
        const result = await signTransaction({ transaction: transaction.serialize(), wallet: embeddedWallet, chain: "solana:mainnet" });
        return VersionedTransaction.deserialize(result.signedTransaction);
      },
    };
    try {
      let result: { signature: string; outAmount: string };
      if (mode === "buy" && src && src.kind === "evm") {
        // EVM cash -> this Solana token, routed by LI.FI (signed by your EVM wallet, tokens land in your Solana wallet)
        const evmAddr = cash.evmAddress;
        const w = evmWallets.find((x) => evmAddr && x.address.toLowerCase() === evmAddr.toLowerCase()) ?? evmWallets.find((x) => x.walletClientType === "privy");
        if (!evmAddr || !w) throw new SwapError("NO_WALLET", "EVM wallet not ready yet");
        const fromRaw = parseUnits(amountUsd.toFixed(Math.min(src.decimals, 8)), src.decimals);
        const chain = VIEM_CHAINS[src.chain];
        const quote = await lifiQuote({ fromChain: chain.id, toChain: SOLANA_LIFI_ID, fromToken: src.address, toToken: mint, fromAmount: fromRaw.toString(), fromAddress: evmAddr, toAddress: publicKey.toBase58() });
        const hash = await execEvmRoute({ wallet: w, account: evmAddr, chain, quote, fromToken: src.address, native: src.native, fromRaw });
        push(`Sent from ${src.chainName}. Bridging to Solana…`, "success", { timeoutMs: 5000 });
        await waitForRoute(hash, chain.id, SOLANA_LIFI_ID);
        result = { signature: hash, outAmount: "0" };
      } else if (mode === "buy") {
        if (!src) throw new SwapError("NO_TOKENS", "No cash available");
        result = await executeQuickBuy(mint, amountUsd, wallet, connection, { input: { mint: src.address, decimals: src.decimals } });
      } else {
        result = await executeQuickSell(mint, sellPercentFinal, wallet, connection, { outputMint: USDC_MINT });
      }
      // Fill price from the actual quote that was signed (what you really paid / received), not the screen price.
      let fill = "";
      try {
        const out = Number(result.outAmount);
        if (out > 0) {
          const fmtPx = (n: number) => (n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(4) : n.toPrecision(3));
          const fmtQty = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2));
          if (mode === "buy") {
            const tokens = out / 10 ** (tokenBalance?.decimals || 6);
            if (tokens > 0) fill = ` — ${fmtQty(tokens)} @ $${fmtPx(amountUsd / tokens)}`;
          } else if (tokenBalance?.quantity) {
            const sold = (tokenBalance.quantity * sellPercentFinal) / 100;
            if (sold > 0) fill = ` — ${fmtQty(sold)} @ $${fmtPx((out / 1e6) / sold)}`;
          }
        }
      } catch { /* cosmetic only */ }
      push(`${mode === "buy" ? "Bought" : "Sold"} ${symbol}${fill}`, "success", {
        actionLabel: "VIEW TX",
        onAction: () => window.open(explorerUrl(result.signature), "_blank", "noopener,noreferrer"),
        timeoutMs: 7000,
      });
      if (mode === "buy" && exitOn && canUse("auto_sell")) {
        const tp = Math.max(0, Number(exitPrefs.tp) || 0), sl = Math.min(95, Math.max(0, Number(exitPrefs.sl) || 0)), trail = Math.min(95, Math.max(0, Number(exitPrefs.trail) || 0));
        const tp1 = Math.max(0, Number(exitPrefs.tp1) || 0), tp1Sell = Math.min(99, Math.max(1, Number(exitPrefs.tp1Sell) || 40)), hold = Math.max(0, Number(exitPrefs.hold) || 0);
        if (tp || sl || trail || tp1 || hold) {
          // Measure exits from the price actually paid (from the signed quote), not from a cached screen price taken after the fact.
          const tokens = Number(result.outAmount) / 10 ** (tokenBalance?.decimals || 6);
          const fillPrice = tokens > 0 ? amountUsd / tokens : 0;
          void Promise.all([getLiveUsdPrice(mint), getMcap(mint, { skipJupiter: true }).catch(() => 0)]).then(([live, mc]) => {
            // trust the fill price only when it agrees with the live price (guards against a wrong token-decimals guess)
            const entryPrice = fillPrice > 0 && (live <= 0 || (fillPrice / live > 0.5 && fillPrice / live < 2)) ? fillPrice : live;
            const common = { mint, symbol, tpPct: tp, slPct: sl, trailPct: trail, ...(tp1 ? { tp1Pct: tp1, tp1SellPct: tp1Sell } : {}), ...(hold ? { maxHoldMin: hold } : {}) };
            if (entryPrice > 0) { armLiveExit({ ...common, entryMcap: mc > 0 ? mc : 0, entryPrice }); push("Auto-exit armed. Keep Wraith open.", "info", { timeoutMs: 4000 }); }
            else if (mc > 0) { armLiveExit({ ...common, entryMcap: mc }); push("Auto-exit armed. Keep Wraith open.", "info", { timeoutMs: 4000 }); }
            else push("Couldn't read the price, auto-exit NOT armed", "warning");
          });
        }
      }
      if (mode === "sell" && sellPercentFinal >= 100) disarmLiveExit(mint);
      void fetch("/api/token-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint, side: mode, signature: result.signature }),
      }).then(() => window.dispatchEvent(new Event("wraith:trade-recorded"))).catch(() => {});
      await refreshTokenBalance();
      await refreshCashBalance();
      void cash.reload();
    } catch (error) {
      const message = error instanceof SwapError ? error.message : friendlyError(error, src?.kind === "evm" ? VIEM_CHAINS[src.chain]?.nativeCurrency.symbol : "SOL", src?.chainName) || "Trade failed. Try again.";
      push(message, error instanceof SwapError && error.code === "INSUFFICIENT_SOL" ? "error" : "warning");
    } finally { setBusy(false); }
  };

  const copyMint = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      push("Contract address copied", "success");
    } catch (error) {
      console.error("[copy token address]", error);
      push("Could not copy contract address", "warning");
    }
  };

  if (sandboxToken) {
    return (
      <DockFrame>
        <TestTradeDock token={sandboxToken} />
        <div id="wx-about-slot" className="wx-about-slot" />
      </DockFrame>
    );
  }

  return (
    <DockFrame>
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {(["buy", "sell"] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setMode(tab)} style={{ flex: 1, border: `1px solid ${mode === tab ? (tab === "buy" ? "#267454" : "#89463e") : "var(--border)"}`, background: mode === tab ? (tab === "buy" ? "#14241d" : "#261917") : "var(--surface)", color: mode === tab ? (tab === "buy" ? "#55cf91" : "#e58d80") : "var(--text-muted)", borderRadius: 9, padding: "11px 8px", textTransform: "capitalize", fontWeight: 750, cursor: "pointer" }}>{tab}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", marginBottom: 12, border: "1px solid var(--border)", borderRadius: 10, color: "var(--text-muted)", fontSize: 11 }}>
          <Wallet size={14} color="var(--orange)" />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{shortAddress}</span>
          <span style={{ color: embeddedWallet ? "#37d58a" : "#ffba55" }}>{embeddedWallet ? "READY" : "SETUP"}</span>
        </div>

        {mode === "buy" ? (
          <>
            <WalletWatch mint={mint} />
            <div style={{ display: "flex", justifyContent: "space-between", margin: "0 1px 10px", color: "var(--text-muted)", fontSize: 11 }}>
              <span>Cash value available</span>
              <strong style={{ color: "var(--text)" }}>{!cash.loaded || currencyRate === null ? "Loading..." : formatCurrency(cash.total * currencyRate, displayCurrency)}</strong>
            </div>
            {src && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 10, padding: "0 10px", height: 38, marginBottom: 10, background: "var(--surface)" }}>
                <ChainLogo chain={src.chain} size={16} />
                <select value={srcId} onChange={(e) => setSrcId(e.target.value)} disabled={busy} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, color: "var(--text)", fontSize: 12, outline: 0, height: "100%", ...MONO }}>
                  {cash.sources.map((x) => <option key={x.id} value={x.id} style={{ background: "#14141a" }}>Pay from {x.chainName} · {x.symbol} · {currencyRate !== null ? formatCurrency(x.balance * currencyRate, displayCurrency) : "—"}</option>)}
                </select>
              </div>
            )}
            <label style={{ display: "block", color: "var(--text-muted)", fontSize: 10, marginBottom: 6 }}>AMOUNT IN {displayCurrency}</label>
            <input aria-label={`Buy amount in ${displayCurrency}`} inputMode="decimal" value={amountCash} onChange={(event) => setAmountCash(event.target.value)} style={{ width: "100%", height: 54, padding: "0 14px", color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, outlineColor: "var(--orange)", fontSize: 20, fontWeight: 700, ...MONO }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8 }}>
              {CASH_PRESETS_USD.map((presetUsd) => {
                const cashValue = currencyRate !== null ? presetUsd * currencyRate : 0;
                return <button type="button" key={presetUsd} disabled={currencyRate === null} onClick={() => setAmountCash(cashValue.toFixed(2))} style={{ padding: "8px 2px", border: `1px solid ${Math.abs(Number(amountCash) - cashValue) < 0.005 ? "var(--orange)" : "var(--border)"}`, borderRadius: 8, color: Math.abs(Number(amountCash) - cashValue) < 0.005 ? "var(--orange-hot)" : "var(--text-muted)", background: "var(--surface)", cursor: "pointer", fontSize: 11 }}>{currencyRate !== null ? formatCurrency(cashValue, displayCurrency) : "—"}</button>;
              })}
            </div>
            <SizeHint balance={src ? src.balance * (currencyRate ?? 1) : null} stopPct={exitOn ? Number(exitPrefs.sl) || 0 : 0} risk={Number(exitPrefs.risk) || 1} setRisk={(r) => setExitPrefs((p) => ({ ...p, risk: String(r) }))} liquidity={marketSnapshot?.liquidity != null && currencyRate ? marketSnapshot.liquidity * currencyRate : null} symbol={symbol} fmt={(v) => formatCurrency(v, displayCurrency)} onUse={(v) => setAmountCash(v.toFixed(2))} />
            <ExitBox mint={mint} symbol={symbol} on={exitOn} setOn={setExitOn} prefs={exitPrefs} setPrefs={setExitPrefs} allowed={canUse("auto_sell")} armed={armedRule} />
          </>
        ) : (
          <>
            <div style={{ color: "var(--text-muted)", fontSize: 10, marginBottom: 6 }}>TOKEN BALANCE</div>
            <div style={{ padding: "15px 14px", marginBottom: 8, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", fontSize: 18, fontWeight: 700 }}>{tokenBalance?.amount ?? "Loading..."}<span style={{ marginLeft: 7, color: "var(--text-muted)", fontSize: 11 }}>{symbol}</span>{tokenBalance && tokenUsd !== null && currencyRate !== null && <small style={{ display: "block", marginTop: 8, color: "var(--text-muted)", fontSize: 12, fontWeight: 500 }}>{formatCurrency(tokenBalance.quantity * tokenUsd * currencyRate, displayCurrency)}</small>}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {SELL_PRESETS.map((preset) => <button type="button" key={preset} onClick={() => setSellPercent(preset)} style={{ padding: "9px 4px", border: `1px solid ${sellPercent === preset ? "#a9564c" : "var(--border)"}`, borderRadius: 8, color: sellPercent === preset ? "#e58d80" : "var(--text-muted)", background: "var(--surface)", cursor: "pointer", fontSize: 11 }}>{preset === 100 ? "Max" : `${preset}%`}</button>)}
            </div>
          </>
        )}

        <button type="button" onClick={() => { if (mode === "buy" && cash.loaded && !src) window.dispatchEvent(new Event("wraith:open-deposit")); else void trade(); }} disabled={tradeDisabled && !(mode === "buy" && cash.loaded && !src)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 48, marginTop: 14, border: 0, borderRadius: 10, color: "#fff", background: mode === "buy" ? "#d96d3c" : "#a95047", fontSize: 14, fontWeight: 800, cursor: busy ? "wait" : "pointer", opacity: tradeDisabled && !(mode === "buy" && cash.loaded && !src) ? .68 : 1 }}>
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
          {busy ? "Confirm in wallet…" : mode === "buy" && cash.loaded && !src ? "Deposit cash to buy" : `${mode === "buy" ? "Buy" : "Sell"} ${symbol}`}
        </button>
        {mode === "buy" && warnings.length > 0 && (
          <div className="wx-warn">
            <button type="button" onClick={() => setWarnOpen((o) => !o)} aria-expanded={warnOpen}>
              <AlertTriangle size={14} />
              <span>Warning: {warnings[0].title}{warnings.length > 1 ? ` +${warnings.length - 1} more` : ""}</span>
              <ChevronDown size={14} style={{ marginLeft: "auto", transform: warnOpen ? "rotate(180deg)" : undefined }} />
            </button>
            {warnOpen && <ul>{warnings.map((w) => <li key={w.title}><b>{w.title}.</b> {w.body}</li>)}</ul>}
          </div>
        )}
        {tradeDisabledReason && <p role="status" style={{ margin: "8px 2px 0", color: "var(--text-muted)", fontSize: 10, lineHeight: 1.5 }}>{tradeDisabledReason}</p>}
        <p style={{ margin: "10px 2px 0", color: "var(--text-dim)", fontSize: 10, lineHeight: 1.55 }}>{FINE_PRINT}</p>
      </div>

      <PositionBlock
        symbol={symbol}
        amountText={tokenBalance?.amount && tokenBalance.amount !== "0" ? tokenBalance.amount : null}
        valueText={tokenBalance && tokenUsd !== null && currencyRate !== null ? formatCurrency(tokenBalance.quantity * tokenUsd * currencyRate, displayCurrency) : null}
        onRefresh={() => void refreshTokenBalance()}
      />

      {marketSnapshot && (
        <AboutBlock
          symbol={marketSnapshot.symbol ?? "TOKEN"}
          description={marketSnapshot.description}
          change={marketSnapshot.priceChange}
          buys={marketSnapshot.buys24h}
          sells={marketSnapshot.sells24h}
          website={marketSnapshot.website}
          twitter={marketSnapshot.twitter}
          telegram={marketSnapshot.telegram}
        />
      )}

      <div id="wx-about-slot" className="wx-about-slot" />
    </DockFrame>
  );
}

