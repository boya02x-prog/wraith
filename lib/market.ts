// lib/market.ts
// Shared types + formatters for the market board, token header and chart.
// Safe to import from both server routes and client components.

export interface MarketToken {
  address: string;
  /** chain key (lib/chains.ts). Missing or "solana" = Solana. */
  chain?: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  priceUsd: number;
  mcap: number;
  liquidity: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: { buys: number; sells: number };
  createdAt: number | null; // ms epoch
  dex: string | null;
  pairAddress: string | null;
  /** pump.fun mint that already moved to a DEX pool */
  graduated: boolean;
  /** pump.fun mint still on the bonding curve */
  onCurve: boolean;
  /** 0..1 estimate of bonding-curve progress (only when onCurve) */
  curveProgress: number | null;
}

export type MarketCategory = "trending" | "new" | "volume" | "gainers";

export const MARKET_CATEGORIES: { key: MarketCategory; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "gainers", label: "Gainers" },
  { key: "volume", label: "Top Volume" },
];

export const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ── Formatters ──────────────────────────────────────────────────────────
export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function fmtUsd(n?: number | null, opts?: { decimals?: number }): string {
  if (!isNum(n) || n <= 0) return "—";
  const d = opts?.decimals ?? 1;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(d)}K`;
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

const SUB = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUB[Number(d)] ?? d)
    .join("");
}

/** $0.0₅1234 style for tiny meme prices */
export function fmtPrice(n?: number | null): string {
  if (!isNum(n) || n <= 0) return "—";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  // toExponential avoids float noise (0.0000412 -> "4.120e-5", not 0.00004119999...)
  const [mant, exp] = n.toExponential(3).split("e");
  const zeros = -Number(exp) - 1; // zeros between "0." and the first significant digit
  const digits = mant.replace(".", "").replace(/0+$/, "") || "0";
  if (zeros < 3) return `$0.${"0".repeat(Math.max(0, zeros))}${digits}`;
  return `$0.0${subscript(zeros)}${digits}`;
}

export function fmtPct(n?: number | null, digits = 1): string {
  if (!isNum(n)) return "—";
  const abs = Math.abs(n);
  const body = abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : abs.toFixed(abs >= 100 ? 0 : digits);
  return `${n >= 0 ? "+" : "-"}${body}%`;
}

export function fmtAge(ms?: number | null): string {
  if (!isNum(ms) || ms <= 0) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  return mo < 12 ? `${mo}mo` : `${Math.floor(mo / 12)}y`;
}

export function fmtCount(n?: number | null): string {
  if (!isNum(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function shortAddr(a: string, head = 4, tail = 4): string {
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function changeColor(n?: number | null): string {
  if (!isNum(n) || n === 0) return "var(--text-muted)";
  return n > 0 ? "var(--win)" : "var(--loss)";
}
