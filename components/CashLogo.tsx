"use client";
// Stablecoin marks. Drop /public/cash/usdc.svg or usdg.svg to override the built-ins.
import { useState } from "react";

export default function CashLogo({ symbol, size = 18 }: { symbol: string; size?: number }) {
  const key = symbol.toLowerCase();
  const [broken, setBroken] = useState(false);
  const common = { width: size, height: size, style: { flex: "none", display: "inline-block", verticalAlign: "middle" } as const };
  if (!broken && (key === "usdc" || key === "usdg")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/cash/${key}.svg`} alt={symbol} {...common} onError={() => setBroken(true)} />;
  }
  if (key === "usdg") {
    // Global Dollar: dark olive disc, lime ring, curled "G"
    return (
      <svg viewBox="0 0 32 32" role="img" aria-label="USDG" {...common}>
        <circle cx="16" cy="16" r="16" fill="#1f2a08" />
        <circle cx="16" cy="16" r="14.2" fill="none" stroke="#c3f53c" strokeWidth="2.4" />
        <path d="M21.2 11.6a6.2 6.2 0 1 0 .6 6.6H16.4" fill="none" stroke="#c3f53c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="USDC" {...common}>
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <path d="M10.5 6.5a10.5 10.5 0 0 0 0 19M21.5 6.5a10.5 10.5 0 0 1 0 19" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <text x="16" y="21.3" textAnchor="middle" fontSize="15" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">$</text>
    </svg>
  );
}
