// $OMEN SPL mint. Set NEXT_PUBLIC_OMEN_MINT in .env.local / Vercel once the token launches.
export const WRAITH_MINT = process.env.NEXT_PUBLIC_OMEN_MINT || "WRAITH_TOKEN_MINT_PLACEHOLDER";
// Pre-launch switch: NEXT_PUBLIC_EARLY_ACCESS=1 gives every signed-in user full WRAITH access.
export const EARLY_ACCESS = process.env.NEXT_PUBLIC_EARLY_ACCESS === "1";
export const FEE_WALLET = "FnpcuNmMhGjTLKJLbXTecaCYCKmdCzeA6cg3fkbSz92g";
export const FEE_ACCOUNT = "FnpcuNmMhGjTLKJLbXTecaCYCKmdCzeA6cg3fkbSz92g";

export type TierKey = "GHOST" | "SHADE" | "SPECTER" | "WRAITH";

export interface Tier {
  key: TierKey;
  label: string;
  minTokens: number;
  feeBps: number;
  color: string;
  description: string;
  features: {
    id: string;
    label: string;
    unlocked: boolean;
  }[];
}

export const TIERS: Record<TierKey, Tier> = {
  GHOST: {
    key: "GHOST",
    label: "GHOST",
    minTokens: 0,
    feeBps: 150,
    color: "#444",
    description: "No OMEN held. Scanner, charts and trading at the standard 1.5% fee.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: false },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: false },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: false },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: false },
      { id: "ai_score", label: "AI Score Access", unlocked: false },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: false },
      { id: "paper_trading", label: "Paper Trading", unlocked: true },
    ],
  },
  SHADE: {
    key: "SHADE",
    label: "SHADE",
    minTokens: 250_000,
    feeBps: 100,
    color: "#00b4d8",
    description: "Hold 250K+ OMEN. 1% trading fee.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: false },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: true },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: true },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: false },
      { id: "ai_score", label: "AI Score Access", unlocked: false },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: true },
      { id: "paper_trading", label: "Paper Trading", unlocked: true },
    ],
  },
  SPECTER: {
    key: "SPECTER",
    label: "SPECTER",
    minTokens: 500_000,
    feeBps: 50,
    color: "#a855f7",
    description: "Hold 500K+ OMEN. 0.5% fee, Telegram alerts and AI score.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: false },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: true },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: true },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: true },
      { id: "ai_score", label: "AI Score Access", unlocked: true },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: true },
      { id: "paper_trading", label: "Paper Trading", unlocked: true },
    ],
  },
  WRAITH: {
    key: "WRAITH",
    label: "WRAITH",
    minTokens: 1_000_000,
    feeBps: 0,
    color: "#e8490f",
    description:
      "Hold 1M+ OMEN. Zero fees. Live signals. Priority everything.",
    features: [
      { id: "scanner_view", label: "View Scanner", unlocked: true },
      { id: "live_signals_view", label: "View Live Signals", unlocked: true },
      { id: "sniper", label: "Sniper / Auto-buy", unlocked: true },
      { id: "auto_sell", label: "Auto TP/SL/Trail", unlocked: true },
      { id: "telegram_alerts", label: "Telegram Alerts", unlocked: true },
      { id: "ai_score", label: "AI Score Access", unlocked: true },
      { id: "hot_wallet", label: "Hot Wallet", unlocked: true },
      { id: "paper_trading", label: "Paper Trading", unlocked: true },
    ],
  },
};

export const TIER_ORDER: TierKey[] = ["GHOST", "SHADE", "SPECTER", "WRAITH"];

export function getTierFromBalance(rawBalance: number): Tier {
  if (rawBalance >= TIERS.WRAITH.minTokens) return TIERS.WRAITH;
  if (rawBalance >= TIERS.SPECTER.minTokens) return TIERS.SPECTER;
  if (rawBalance >= TIERS.SHADE.minTokens) return TIERS.SHADE;
  return TIERS.GHOST;
}

export function canUse(tier: Tier, featureId: string): boolean {
  return tier.features.find((f) => f.id === featureId)?.unlocked ?? false;
}
