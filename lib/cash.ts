"use client";
import { fetchSolPrice } from "@/lib/solPriceClient";

import { useEffect, useState } from "react";
import { DISPLAY_CURRENCIES, isDisplayCurrency, type DisplayCurrency } from "@/lib/currencies";

// Quick-buy sizes are in the user's own cash currency (₱, $, …) and converted to SOL at buy time,
// so "₱100" always means ₱100 no matter where the SOL price is.
const CURRENCY_KEY = "wraith_display_currency_v1";

export function readCurrency(): DisplayCurrency {
  if (typeof window === "undefined") return "USD";
  try {
    const v = localStorage.getItem(CURRENCY_KEY);
    return isDisplayCurrency(v) ? v : "USD";
  } catch {
    return "USD";
  }
}

export function defaultCashAmounts(cur: DisplayCurrency): [number, number] {
  switch (cur) {
    case "PHP": return [100, 500];
    case "JPY": return [1000, 5000];
    case "INR": return [100, 500];
    case "MXN": return [50, 200];
    case "BRL": return [20, 100];
    default: return [5, 20];
  }
}

export const symbolOf = (cur: DisplayCurrency) => DISPLAY_CURRENCIES.find((c) => c.code === cur)?.symbol ?? "$";

let cache = { at: 0, cur: "USD" as DisplayCurrency, perSol: 0 };

async function loadPerSol(cur: DisplayCurrency): Promise<number> {
  if (cache.perSol > 0 && cache.cur === cur && Date.now() - cache.at < 30_000) return cache.perSol;
  const [sol, fx] = await Promise.all([
    fetchSolPrice(),
    cur === "USD" ? Promise.resolve({ rate: 1 }) : fetch(`/api/fx?currency=${cur}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  ]);
  const solUsd = Number(sol?.solUsd), rate = Number((fx as { rate?: unknown } | null)?.rate);
  if (!(solUsd > 0) || !(rate > 0)) return cache.cur === cur ? cache.perSol : 0;
  cache = { at: Date.now(), cur, perSol: solUsd * rate };
  return cache.perSol;
}

export function formatCash(amount: number, cur: DisplayCurrency): string {
  const digits = amount < 10 && cur !== "JPY" ? 2 : 0;
  return `${symbolOf(cur)}${amount.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

/** Display currency + live conversion between that cash and SOL. */
export function useCash() {
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");
  const [perSol, setPerSol] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const run = () => {
      const cur = readCurrency();
      setCurrency(cur);
      void loadPerSol(cur).then((v) => { if (alive && v > 0) setPerSol(v); });
    };
    run();
    const t = window.setInterval(() => { if (!document.hidden) run(); }, 30_000);
    window.addEventListener("focus", run);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener("focus", run); };
  }, []);

  return {
    currency,
    symbol: symbolOf(currency),
    perSol,
    toSol: (cash: number) => (perSol && perSol > 0 ? cash / perSol : null),
    fmt: (cash: number) => formatCash(cash, currency),
    /** SOL amount shown as cash in the user's currency, optionally with a +/- sign. */
    money: (sol: number, signed = false) => {
      if (!perSol || perSol <= 0) return "-";
      const cash = sol * perSol;
      const sign = cash < 0 ? "-" : signed && cash > 0 ? "+" : "";
      return `${sign}${formatCash(Math.abs(cash), currency)}`;
    },
  };
}
