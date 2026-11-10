// theme.ts
// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for colors, spacing, radius, and typography across
// EVERY panel (Header, LiveSignalsBar, TokenPanel, WinsPanel, MemeScanner,
// PaperTrader). Nothing should hardcode a hex color, a px padding value, or
// a borderRadius number directly in a component anymore — import from here.
//
// Color values here mirror the tokens in app/globals.css (:root). Keep them
// as literal hex/rgba (not var()) because components append alpha suffixes
// like `${C.orange}22` and chart libraries can't read CSS variables.
// If you change --accent in globals.css, change C.orange here too.
// ─────────────────────────────────────────────────────────────────────────

export const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

// ── Color palette ───────────────────────────────────────────────────────
export const C = {
  primary: "var(--text)",
  muted: "var(--text-muted)",
  dim: "#6e6e74", // was #858e97 (blue-grey); now matches --text-dim
  label: "rgba(237,237,238,0.72)", // was a warm-white tint; now matches --text
  orange: "#ff7b3d", // the single accent; must match --accent
  green: "#22c55e", // price up / win only
  yellow: "#ffd700",
  purple: "#a855f7",
  blue: "#a1a1a6", // was cyan #00b4d8 (a third hue); now neutral so DEX/CHART chips blend in
  red: "#ef4444", // price down / loss only
  amber: "#ffaa00",
  bg: "var(--bg)",
  bgCard: "var(--surface)",
  border: "rgba(255,255,255,0.08)", // matches --border
  borderHover: "rgba(255,255,255,0.16)", // was an orange glow; now matches --border-strong
  hot: "var(--accent-text)",
} as const;

// ── Spacing scale ───────────────────────────────────────────────────────
// Every panel picks its padding/gap from here instead of a raw number,
// which is what creates consistent "breathing room" panel to panel.
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ── Radius scale ────────────────────────────────────────────────────────
export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 999,
} as const;

// ── Typography scale ────────────────────────────────────────────────────
export const FONT = {
  micro: 12,
  xs: 12,
  sm: 12,
  base: 14,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

// ── Shared card shell ───────────────────────────────────────────────────
// Every panel's outer "card" container (a win card, a token row card, a
// scanner result card) should extend this instead of writing its own
// background/border/radius/padding combination.
export const CARD_BASE = {
  background: C.bgCard,
  border: `1px solid ${C.border}`,
  borderRadius: RADIUS.lg,
  padding: SPACE.lg,
} as const;

// Tier accent colors (HOT / MEGA / WIN / CELEB) shared across WinsPanel,
// LiveSignalsBar, MemeScanner — previously each file had its own partial
// copy of this mapping with slightly different values.
export const TIER_COLOR: Record<string, string> = {
  ULTRA: C.yellow,
  HIGH: C.green,
  HOT: C.hot,
  CELEB: C.yellow,
};
