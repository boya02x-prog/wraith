"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useTestMode } from "@/lib/testMode";
import { usePrivy } from "@privy-io/react-auth";
import { createPublicClient, http, isAddress, parseAbi } from "viem";
import { CASH_TOKENS, VIEM_CHAINS, rpcFor, type CashToken } from "@/lib/cashTokens";
import { useConnection } from "@solana/wallet-adapter-react";
import { formatCurrency, type DisplayCurrency } from "@/lib/currencies";
import { DEVNET_RPC_PUBLIC } from "@/lib/publicRpc";

const USDC_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

// ── Fast first paint ────────────────────────────────────────────────────────────────────────────────────────────────────
// Cash is the sum of ~10 stablecoin reads across 7 chains. The old chip waited for ALL of them (some on slow public RPCs with
// 10 s timeouts and 3 retries), so "CASH BALANCE ..." could hang for a long time after sign-in. Now:
//   - the last-known amount per token is remembered in this browser and shown on the first frame (and wiped on sign-out),
//   - every read has a hard timeout and updates its own slot as soon as it answers,
//   - a read that fails keeps its last-known amount instead of silently counting as $0.
const CASH_CACHE_KEY = "wraith_cash_cache_v1";
const READ_TIMEOUT_MS = 6000;
const REVEAL_AFTER_MS = 2500; // with nothing remembered, show what we have after this long instead of "..."
const CHAIN_COOLDOWN_MS = 60_000;

type CashCache = { uid: string | null; per: Record<string, number> };

function readCashCache(): CashCache | null {
  try {
    const raw = localStorage.getItem(CASH_CACHE_KEY);
    if (!raw) return null;
    const j: unknown = JSON.parse(raw);
    if (typeof j !== "object" || j === null) return null;
    const o = j as { uid?: unknown; per?: unknown };
    if (typeof o.per !== "object" || o.per === null) return null;
    const per: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.per as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) per[k] = v;
    return { uid: typeof o.uid === "string" ? o.uid : null, per };
  } catch {
    return null;
  }
}

function writeCashCache(c: CashCache): void {
  try { localStorage.setItem(CASH_CACHE_KEY, JSON.stringify(c)); } catch { /* storage full or blocked */ }
}

function readFxCache(currency: string): number | null {
  try {
    const v = Number(localStorage.getItem(`wraith_fx_v1:${currency}`));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Reject after `ms` so one hung request can never hold the whole balance (or the next refresh) hostage. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// chain key -> time until which we skip an unreachable RPC (shared by every chip on the page)
const chainDownUntil = new Map<string, number>();

export default function EmbeddedWalletBalanceChip({
  currency,
  onDeposit,
  onWithdraw,
}: {
  currency: DisplayCurrency;
  onDeposit: () => void;
  onWithdraw?: () => void;
}) {
  const { connection } = useConnection();
  const { ready, user } = usePrivy();
  const [per, setPer] = useState<Record<string, number>>({});
  const perRef = useRef<Record<string, number>>({});
  const [revealed, setRevealed] = useState(false); // false = show "..." (nothing remembered and nothing trustworthy yet)
  const [settled, setSettled] = useState(false); // every read has answered or failed at least once this visit
  const [unknownCount, setUnknownCount] = useState(0); // tokens that never answered and have no remembered amount
  const [currencyRate, setCurrencyRate] = useState<number | null>(currency === "USD" ? 1 : null);
  const [testMode] = useTestMode();
  const [devSol, setDevSol] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const userId = user?.id ?? null;
  const evmAddr = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "ethereum" && x.walletClientType === "privy");
    return a?.type === "wallet" && isAddress(a.address) ? (a.address as `0x${string}`) : null;
  }, [user]);
  const solAddr = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const solanaWallet = useMemo(() => user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy") ?? null, [user]);

  // First frame: show the amount remembered from the last visit (the real read below replaces it within a moment).
  useEffect(() => {
    const c = readCashCache();
    if (c && Object.keys(c.per).length > 0) {
      perRef.current = c.per;
      setPer(c.per);
      setRevealed(true);
    }
  }, []);

  // Once we know who is signed in, drop a remembered amount that belongs to someone else.
  useEffect(() => {
    if (!userId) return;
    const c = readCashCache();
    if (c && c.uid && c.uid !== userId) {
      perRef.current = {};
      setPer({});
      setRevealed(false);
      setSettled(false);
    }
  }, [userId]);

  useEffect(() => {
    let active = true;
    if (currency === "USD") {
      setCurrencyRate(1);
      return () => { active = false; };
    }
    // show the last known rate immediately, then refresh it
    setCurrencyRate(readFxCache(currency));
    fetch(`/api/fx?currency=${currency}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Currency rate unavailable (${response.status}).`);
        const data: unknown = await response.json();
        if (typeof data !== "object" || data === null || !("rate" in data) || typeof data.rate !== "number" || !Number.isFinite(data.rate) || data.rate <= 0) throw new Error("Currency rate response was invalid.");
        if (active) setCurrencyRate(data.rate);
        try { localStorage.setItem(`wraith_fx_v1:${currency}`, String(data.rate)); } catch { /* ignore */ }
      })
      .catch((error) => { console.error("[wallet display currency rate]", error); });
    return () => { active = false; };
  }, [currency]);

  useEffect(() => {
    if (!testMode || !solanaWallet || solanaWallet.type !== "wallet") return;
    let active = true;
    const conn = new Connection(DEVNET_RPC_PUBLIC, "confirmed");
    const pk = new PublicKey(solanaWallet.address);
    const SOL = "So11111111111111111111111111111111111111112";
    const tick = () => {
      void conn.getBalance(pk).then((l) => { if (active) setDevSol(l / 1e9); }).catch(() => {});
      void fetch(`/api/price?ids=${SOL}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const v = Number(d?.data?.[SOL]?.price ?? d?.[SOL]?.usdPrice ?? d?.[SOL]?.price);
          if (active && Number.isFinite(v) && v > 0) setSolUsd(v);
        })
        .catch(() => {});
    };
    tick();
    const t = window.setInterval(() => { if (!document.hidden) tick(); }, 30_000);
    return () => { active = false; window.clearInterval(t); };
  }, [testMode, solanaWallet]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let running = false;
    let lastRun = 0;

    const run = async () => {
      if (running || !active) return;
      running = true;
      lastRun = Date.now();
      const revealTimer = window.setTimeout(() => { if (active) setRevealed(true); }, REVEAL_AFTER_MS);
      let unknown = 0;

      const record = (key: string, amount: number) => {
        if (!active || !Number.isFinite(amount)) return;
        perRef.current = { ...perRef.current, [key]: amount };
        setPer(perRef.current);
        writeCashCache({ uid: userId, per: perRef.current });
      };
      const miss = (key: string, label: string, e: unknown) => {
        console.warn(`[${label} balance]`, e instanceof Error ? e.message.split("\n")[0] : e);
        if (perRef.current[key] === undefined) unknown++;
      };

      const jobs: Promise<void>[] = [];
      // CASH = stablecoins only (see lib/cashTokens.ts). SOL, ETH and other tokens are holdings, not cash.
      if (evmAddr) {
        for (const item of CASH_TOKENS as CashToken[]) {
          if (item.chain === "solana") continue;
          const chain = VIEM_CHAINS[item.chain];
          const rpc = chain ? rpcFor(chain) : null;
          if (!chain || !rpc) continue;
          const key = `${item.chain}:${item.symbol}`;
          const label = `${chain.name} ${item.symbol}`;
          jobs.push((async () => {
            // Skip a chain briefly once its RPC is unreachable (avoids a failing request every cycle).
            if ((chainDownUntil.get(item.chain) ?? 0) > Date.now()) { if (perRef.current[key] === undefined) unknown++; return; }
            try {
              const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 0, timeout: READ_TIMEOUT_MS }) });
              const raw = item.native
                ? await withTimeout(client.getBalance({ address: evmAddr }), READ_TIMEOUT_MS + 1500)
                : await withTimeout(client.readContract({ address: item.address as `0x${string}`, abi: USDC_ABI, functionName: "balanceOf", args: [evmAddr] }), READ_TIMEOUT_MS + 1500);
              record(key, Number(raw) / 10 ** item.decimals);
            } catch (e) {
              chainDownUntil.set(item.chain, Date.now() + CHAIN_COOLDOWN_MS);
              miss(key, label, e);
            }
          })());
        }
      }
      if (solAddr) {
        let owner: PublicKey | null = null;
        try { owner = new PublicKey(solAddr); } catch { owner = null; }
        if (owner) {
          for (const item of CASH_TOKENS as CashToken[]) {
            if (item.chain !== "solana") continue;
            const key = `solana:${item.symbol}`;
            jobs.push((async () => {
              try {
                const r = await withTimeout(connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(item.address) }, "confirmed"), READ_TIMEOUT_MS + 2000);
                record(key, r.value.reduce((sum, acc) => sum + Number(acc.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0));
              } catch (e) {
                miss(key, `Solana ${item.symbol}`, e);
              }
            })());
          }
        }
      }

      try {
        await Promise.all(jobs);
      } finally {
        window.clearTimeout(revealTimer);
        running = false;
      }
      if (!active) return;
      setUnknownCount(unknown);
      setSettled(true);
      setRevealed(true);
      writeCashCache({ uid: userId, per: perRef.current });
    };

    void run();
    const timer = window.setInterval(() => { if (!document.hidden) void run(); }, 90_000);
    // Coming back to the tab/app, or finishing a trade, should not leave the number stale until the next 90 s tick.
    const soon = (minGapMs: number) => { if (!document.hidden && Date.now() - lastRun > minGapMs) void run(); };
    const onVisible = () => soon(20_000);
    let tradeTimer: ReturnType<typeof setTimeout> | null = null;
    const onTrade = () => { if (tradeTimer) clearTimeout(tradeTimer); tradeTimer = setTimeout(() => soon(2_000), 2_500); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("wraith:trade-recorded", onTrade);
    window.addEventListener("wraith:refresh", onTrade);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (tradeTimer) clearTimeout(tradeTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("wraith:trade-recorded", onTrade);
      window.removeEventListener("wraith:refresh", onTrade);
    };
  }, [connection, evmAddr, solAddr, ready, userId]);

  const cash = Object.values(per).reduce((sum, v) => sum + v, 0);
  const stale = !settled; // showing a remembered or partial amount while the live read finishes
  const approx = settled && unknownCount > 0; // some chain could not be read: say so instead of presenting a low number as exact
  const cashText = !revealed
    ? "..."
    : currencyRate === null
      ? "—"
      : `${approx ? "~" : ""}${formatCurrency(cash * currencyRate, currency)}`;

  return <div className="embedded-wallet-header-chip" title={approx ? "Some networks could not be reached, so this may be lower than your real cash. It refreshes automatically." : "Wallet cash estimate converted using your selected account display currency."}>
    <div className="embedded-wallet-header-value"><span>{testMode ? `TEST BALANCE${devSol !== null ? ` · ${devSol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL` : ""}` : "CASH BALANCE"}</span><strong aria-live="polite" style={testMode ? { color: "#f59e0b" } : stale && revealed ? { opacity: 0.72, transition: "opacity .2s" } : undefined}>{testMode ? (devSol === null ? "..." : solUsd !== null && currencyRate !== null ? formatCurrency(devSol * solUsd * currencyRate, currency) : `${devSol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL`) : cashText}</strong></div>
    <div className="embedded-wallet-header-actions">
      <button type="button" className="embedded-wallet-header-deposit" onClick={onDeposit} aria-label="Deposit more into your WRAITH account">Deposit</button>
      {onWithdraw && <button type="button" className="embedded-wallet-header-withdraw" onClick={onWithdraw} aria-label="Withdraw from your WRAITH account">Withdraw</button>}
    </div>
  </div>;
}
