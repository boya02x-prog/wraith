"use client";

// Resolves symbol / logo / market cap for a list of mints in one batched call.
// Results are cached for the lifetime of the page.

import { useEffect, useState } from "react";

export interface TokenMeta {
  symbol: string;
  name: string;
  imageUrl?: string;
  mcap: number;
}

const cache = new Map<string, TokenMeta>();
const pending = new Set<string>();

export function useTokenMeta(mints: string[]): Record<string, TokenMeta> {
  const key = [...new Set(mints.filter(Boolean))].sort().join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    if (!key) return;
    const need = key.split(",").filter((m) => !cache.has(m) && !pending.has(m)).slice(0, 30);
    if (!need.length) return;
    need.forEach((m) => pending.add(m));
    let alive = true;
    fetch(`/api/signal-prices?mints=${need.join(",")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { prices?: Record<string, { mcap: number; symbol: string; name: string; imageUrl?: string }> } | null) => {
        for (const [m, p] of Object.entries(d?.prices ?? {})) {
          cache.set(m, { symbol: p.symbol, name: p.name, imageUrl: p.imageUrl, mcap: p.mcap });
        }
      })
      .catch(() => undefined)
      .then(async () => {
        // anything the batch lookup could not name (fresh pump tokens, thin pairs) gets a direct per-token lookup,
        // so feeds show a symbol and logo instead of a raw contract address
        const missing = need.filter((m) => !cache.has(m)).slice(0, 6);
        await Promise.all(missing.map((m) =>
          fetch(`/api/token-price?mint=${encodeURIComponent(m)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { symbol?: string; name?: string; imageUrl?: string; marketCap?: number } | null) => {
              if (d?.symbol) cache.set(m, { symbol: d.symbol, name: d.name ?? d.symbol, imageUrl: d.imageUrl, mcap: Number(d.marketCap) || 0 });
            })
            .catch(() => undefined),
        ));
      })
      .finally(() => {
        need.forEach((m) => pending.delete(m));
        if (alive) bump((n) => n + 1);
      });
    return () => { alive = false; };
  }, [key]);

  const out: Record<string, TokenMeta> = {};
  for (const m of key ? key.split(",") : []) {
    const v = cache.get(m);
    if (v) out[m] = v;
  }
  return out;
}
