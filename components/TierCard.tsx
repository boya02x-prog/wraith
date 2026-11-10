"use client";

import { useWraithTier } from "@/hooks/useWraithTier";
import { TIERS, TIER_ORDER } from "@/lib/tiers";
import { useLaunchSettings } from "@/hooks/useLaunchSettings";
import { GLYPH_PALETTE } from "@/lib/tierGlyph";
import TierGlyph from "@/components/TierGlyph";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" } as const;

const fmt = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${+(n / 1_000).toFixed(1)}K` : `${Math.floor(n)}`;

/** Current tier, how it was earned, and what it takes to reach the next one. */
export default function TierCard() {
  const { tier, rawBalance, loading, isWhitelistMember, earlyAccess } = useWraithTier();
  const { settings: launch } = useLaunchSettings();
  const c = GLYPH_PALETTE[tier.key].mid;
  const launched = launch.tiersLive;
  const idx = TIER_ORDER.indexOf(tier.key);
  const next = idx < TIER_ORDER.length - 1 ? TIERS[TIER_ORDER[idx + 1]] : null;
  const source = earlyAccess
    ? "Beta: every tool unlocked"
    : isWhitelistMember
      ? "Whitelisted"
      : !launched
        ? "OMEN not launched yet"
        : loading
          ? "Checking wallet…"
          : "Verified from your wallet";
  const showProgress = !!next && !(isWhitelistMember && !earlyAccess) && launched;
  const pct = next ? Math.min(100, (rawBalance / next.minTokens) * 100) : 100;

  return (
    <div
      style={{
        margin: "10px 12px 4px",
        padding: "12px 12px 11px",
        borderRadius: 12,
        border: `1px solid ${c}55`,
        background: `linear-gradient(160deg, ${c}1f, ${c}08 70%)`,
        display: "grid",
        gap: 9,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <TierGlyph tier={tier.key} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...MONO, fontSize: 10, letterSpacing: ".14em", color: "#8d8d99" }}>YOUR TIER</div>
          <div style={{ ...MONO, fontSize: 17, fontWeight: 800, letterSpacing: ".1em", color: c }}>{tier.label}</div>
          <div style={{ fontSize: 11.5, color: "#9a9aa6" }}>
            {tier.feeBps === 0 ? "0% trading fee" : `${tier.feeBps / 100}% trading fee`} · {source}
          </div>
        </div>
      </div>
      {showProgress && next && (
        <div style={{ display: "grid", gap: 5 }}>
          <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: c, borderRadius: 4, transition: "width .4s" }} />
          </div>
          <div style={{ ...MONO, fontSize: 10.5, color: "#9a9aa6", letterSpacing: ".04em" }}>
            {fmt(Math.max(0, next.minTokens - rawBalance))} OMEN to {next.label}
          </div>
        </div>
      )}
      {!launched && (!isWhitelistMember || earlyAccess) && (
        <div style={{ fontSize: 11, color: "#7c7c88", lineHeight: 1.4 }}>
          {earlyAccess
            ? "Every tool is free during the beta. Once OMEN launches, holding it keeps them and lowers your fee."
            : "Tiers unlock from the OMEN in your wallet once the token launches."}
          {launch.omenLaunchAt && ` OMEN launch: ${new Date(launch.omenLaunchAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`}
        </div>
      )}
    </div>
  );
}
