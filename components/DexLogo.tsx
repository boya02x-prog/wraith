"use client";
// The trading venue of a token (Uniswap, PumpSwap, Raydium, Orca, Meteora, PancakeSwap, Aerodrome ...) as its logo, name in the tooltip.
// Logos come from DexScreener's image store; if one does not exist for a venue, a small plain text badge is shown instead.
import { useState } from "react";

const clean = (dex: string) => dex.toLowerCase().trim().replace(/[\s_-]*v\d+.*$/, "").replace(/[^a-z0-9]/g, "");
const pretty = (dex: string) => dex.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function DexLogo({ dex, size = 20 }: { dex: string | null | undefined; size?: number }) {
  const [bad, setBad] = useState(false);
  if (!dex) return null;
  const id = clean(dex);
  if (!id) return null;
  if (bad) return <span className="wx-badge muted">{pretty(dex)}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="wx-dex-logo"
      src={`https://dd.dexscreener.com/ds-data/dexes/${id}.png`}
      alt={pretty(dex)}
      title={pretty(dex)}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setBad(true)}
      style={{ width: size, height: size }}
    />
  );
}
