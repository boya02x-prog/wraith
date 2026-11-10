"use client";

// hooks/useMarket.ts
// Polls /api/market for one category. Keeps the previous list on screen while
// refreshing or when a refresh fails (a flaky provider never blanks the board).

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketCategory, MarketToken } from "@/lib/market";
import { swrPeek, swrRead, swrWrite } from "@/lib/swrCache";

export interface UseMarket {
  tokens: MarketToken[];
  loading: boolean;
  error: string | null;
  stale: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

export function useMarket(category: MarketCategory, intervalMs = 60_000): UseMarket {
  const warm = swrPeek<MarketToken[]>(`market:${category}`);
  const [tokens, setTokens] = useState<MarketToken[]>(warm ?? []);
  const [loading, setLoading] = useState(!warm);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const reqId = useRef(0);
  const hasData = useRef(Boolean(warm));

  const load = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const res = await fetch(`/api/market?category=${category}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (id !== reqId.current) return;
      const data: { tokens?: MarketToken[]; stale?: boolean; updatedAt?: number; error?: string } = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;
      if (res.ok && Array.isArray(data.tokens)) {
        setTokens(data.tokens);
        swrWrite(`market:${category}`, data.tokens.slice(0, 80));
        setStale(Boolean(data.stale));
        setUpdatedAt(data.updatedAt ?? Date.now());
        setError(null);
        hasData.current = true;
      } else if (!hasData.current) {
        setError(data.error ?? "Couldn't load tokens.");
      } else {
        setStale(true);
      }
    } catch {
      if (id === reqId.current && !hasData.current) setError("Couldn't reach the server.");
      else if (id === reqId.current) setStale(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    // show the last list for this category right away (tab switch / coming back), then refresh behind it
    const cached = swrRead<MarketToken[]>(`market:${category}`);
    hasData.current = Boolean(cached);
    setTokens(cached ?? []);
    setLoading(!cached);
    setError(null);
    setStale(false);
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
    const onPull = () => void load(); // pull-to-refresh
    window.addEventListener("wraith:refresh", onPull);
    return () => {
      reqId.current++;
      clearInterval(t);
      window.removeEventListener("wraith:refresh", onPull);
    };
  }, [load, intervalMs]);

  // Light live overlay: every ~4s refresh price / mcap / % / volume for the rows on screen (list itself stays as ranked).
  const mintsKey = tokens.map((t) => t.address).join(",");
  useEffect(() => {
    if (!mintsKey) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/market-live?mints=${mintsKey.split(",").slice(0, 30).join(",")}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d: { prices?: Record<string, Partial<MarketToken>> } = await r.json();
        const px = d.prices ?? {};
        if (!alive || !Object.keys(px).length) return;
        setTokens((cur) => cur.map((t) => (px[t.address] ? { ...t, ...px[t.address] } : t)));
        setUpdatedAt(Date.now());
      } catch { /* keep last */ }
    };
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [mintsKey]);

  return { tokens, loading, error, stale, updatedAt, refresh: () => void load() };
}
