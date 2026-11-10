import { type TierKey } from "@/lib/tiers";

// ─── WALLET WHITELIST ────────────────────────────────────────────────────────
// Full WRAITH access regardless of token balance.

export const WHITELISTED_WALLETS: string[] = [
  // "HvNroefT67VL3j6AjRerRE9oYMRG1yR5DitbTonDGpo4",
];

export const WHITELISTED_EMAILS: string[] = [
  "yuriesb01@gmail.com",
  "jonathan.4thwatchlogro@gmail.com",
];

// ─── PER-WALLET TIER OVERRIDES ───────────────────────────────────────────────
// Uncomment ONE line to force your wallet into that tier for testing.
// Comment it back out when done.

export const WALLET_TIER_OVERRIDES: Record<string, TierKey> = {
  // "HvNroefT67VL3j6AjRerRE9oYMRG1yR5DitbTonDGpo4": "GHOST",
  //   HvNroefT67VL3j6AjRerRE9oYMRG1yR5DitbTonDGpo4: "SHADE",
  //   HvNroefT67VL3j6AjRerRE9oYMRG1yR5DitbTonDGpo4: "SPECTER",
  HvNroefT67VL3j6AjRerRE9oYMRG1yR5DitbTonDGpo4: "WRAITH",
};

// ─────────────────────────────────────────────────────────────────────────────

export function isWhitelisted(
  walletAddress: string | null | undefined,
): boolean {
  if (!walletAddress) return false;
  return WHITELISTED_WALLETS.map((w) => w.toLowerCase()).includes(
    walletAddress.toLowerCase(),
  );
}

export function isEmailWhitelisted(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return WHITELISTED_EMAILS.some(
    (whitelistedEmail) => whitelistedEmail.toLowerCase() === normalizedEmail,
  );
}

export function getTierOverride(
  walletAddress: string | null | undefined,
): TierKey | null {
  if (!walletAddress) return null;
  const key = walletAddress.toLowerCase();
  const entry = Object.entries(WALLET_TIER_OVERRIDES).find(
    ([w]) => w.toLowerCase() === key,
  );
  return entry ? entry[1] : null;
}
