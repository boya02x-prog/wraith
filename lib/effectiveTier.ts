// A stored tier only counts when the server verified it (on-chain balance or whitelist).
// Old rows written by the browser, or by the early-access switch, are treated as GHOST.
import type { TierKey } from "@/lib/tiers";

export function effectiveTier(u: { tier?: unknown; tierSource?: unknown } | null | undefined): TierKey {
  const t = String(u?.tier ?? "GHOST");
  const verified = u?.tierSource === "chain" || u?.tierSource === "whitelist";
  return verified && (t === "SHADE" || t === "SPECTER" || t === "WRAITH") ? t : "GHOST";
}

export const VERIFIED_SOURCES = ["chain", "whitelist"];
