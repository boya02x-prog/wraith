// Token price alerts: "tell me when this drops 25%", "when it doubles". The price when you set the alert is the base; the
// phone alert goes out once, the first time the live price crosses the line, then the alert is done.
export type AlertKind = "drop" | "rise";
export interface PriceAlert {
  _id?: string;
  userId: string;
  mint: string;
  symbol: string;
  kind: AlertKind;
  pct: number; // 10..90 for a drop, 10..1000 for a rise
  basePrice: number; // USD price when the alert was set
  createdAt: number;
  firedAt?: number;
}
export const PRESETS: { kind: AlertKind; pct: number; label: string }[] = [
  { kind: "drop", pct: 15, label: "Dips 15%" },
  { kind: "drop", pct: 25, label: "Dips 25%" },
  { kind: "drop", pct: 40, label: "Dips 40%" },
  { kind: "rise", pct: 50, label: "Rises 50%" },
  { kind: "rise", pct: 100, label: "Doubles" },
  { kind: "rise", pct: 300, label: "4x" },
];
export const MAX_ALERTS_PER_USER = 20;
export const alertLabel = (a: Pick<PriceAlert, "kind" | "pct">) => (a.kind === "drop" ? `Dips ${a.pct}%` : a.pct === 100 ? "Doubles" : a.pct === 300 ? "4x" : `Rises ${a.pct}%`);
/** target USD price */
export const alertTarget = (a: Pick<PriceAlert, "kind" | "pct" | "basePrice">) => a.basePrice * (a.kind === "drop" ? 1 - a.pct / 100 : 1 + a.pct / 100);
export const alertHit = (a: Pick<PriceAlert, "kind" | "pct" | "basePrice">, px: number) => (a.kind === "drop" ? px <= alertTarget(a) : px >= alertTarget(a));
