"use client";
import { useEffect, useState } from "react";

export interface SandboxTok { symbol: string; name: string; mint: string; priceSol: number; decimals: number; treasuryAta: string; treasury: string }

let promise: Promise<SandboxTok[]> | null = null;
function load(): Promise<SandboxTok[]> {
  if (!promise) {
    promise = fetch("/api/devnet/tokens?lite=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tokens?: Array<Omit<SandboxTok, "treasury">>; treasury?: string }) => {
        const list = (d.tokens ?? []).map((t) => ({ ...t, treasury: d.treasury ?? "" }));
        if (!list.length) promise = null;
        return list;
      })
      .catch(() => { promise = null; return [] as SandboxTok[]; });
  }
  return promise;
}

export function useSandboxTokens(): SandboxTok[] | null {
  const [list, setList] = useState<SandboxTok[] | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((l) => { if (alive) setList(l); });
    return () => { alive = false; };
  }, []);
  return list;
}

export function useSandboxToken(mint: string | null | undefined): SandboxTok | null {
  const list = useSandboxTokens();
  if (!mint) return null;
  return list?.find((t) => t.mint === mint) ?? null;
}
