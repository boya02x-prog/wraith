// Short number and time formats shared by the token hover card, the saved-token bar and the chart window.

/** $12.3K / $4.56M / $1.20B for money; "-" when there is nothing to show. */
export const usdShort = (n?: number | null): string => {
  if (!n || !Number.isFinite(n)) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

/** A token price: $182.40, $0.1218, or three significant digits for the tiny ones ($0.0000354). */
export const priceShort = (n?: number | null): string => (!n ? "-" : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`);

/** How long ago: 5m, 3h, 2d. */
export const ageShort = (ms?: number | null): string => {
  if (!ms) return "-";
  const m = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

/** +12.4% / -3.1% (whole numbers once it is past a thousand percent). */
export const pctShort = (n: number): string => `${n >= 0 ? "+" : "-"}${Math.abs(n) >= 1000 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(1)}%`;

/** 72Ux…pump */
export const shortAddr = (a: string): string => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** 3.15x, or 12.4x once it is past ten. */
export const timesShort = (x: number): string => `${x >= 10 ? x.toFixed(1) : x.toFixed(2)}x`;
