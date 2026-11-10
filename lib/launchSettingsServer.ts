// Server side of launch control: cached read, admin write, and the tier helpers every gate uses.
import { getDb } from "@/lib/mongoClient";
import { effectiveTier } from "@/lib/effectiveTier";
import { WRAITH_MINT, type TierKey } from "@/lib/tiers";
import { DEFAULT_SETTINGS, MINT_RE, normalizeSettings, resolveSettings, type LaunchSettings } from "@/lib/launchSettings";

const TTL = 15_000;
let cache: { v: LaunchSettings; at: number } | null = null;

// Before the admin saves anything, the old env switches still decide the starting point.
function envDefaults(): LaunchSettings {
  return {
    ...DEFAULT_SETTINGS,
    omenMint: MINT_RE.test(WRAITH_MINT) ? WRAITH_MINT : "",
    claimOpen: process.env.NEXT_PUBLIC_AIRDROP_FINAL === "1",
  };
}

/** Raw stored settings (no schedule applied). Admin page edits these. */
export async function getStoredSettings(fresh = false): Promise<LaunchSettings> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.v;
  try {
    const doc = await (await getDb()).collection<{ _id: string }>("app_settings").findOne({ _id: "launch" });
    const v = normalizeSettings(doc ?? {}, envDefaults());
    cache = { v, at: Date.now() };
    return v;
  } catch (e) {
    console.error("[launch settings] read failed", e);
    return cache?.v ?? envDefaults();
  }
}

/** Settings in force right now (auto-launch schedule applied). */
export async function getLaunchSettings(): Promise<LaunchSettings> {
  return resolveSettings(await getStoredSettings());
}

export async function saveLaunchSettings(input: unknown, by: string): Promise<LaunchSettings> {
  const current = await getStoredSettings(true);
  const next = normalizeSettings(input, current);
  next.updatedAt = new Date().toISOString();
  next.updatedBy = by;
  await (await getDb()).collection<{ _id: string }>("app_settings").updateOne({ _id: "launch" }, { $set: next }, { upsert: true });
  cache = { v: next, at: Date.now() };
  return next;
}

type TierRow = { tier?: unknown; tierSource?: unknown } | null | undefined;

/** Tier for FEES and badges: only server-verified holdings, and on-chain tiers only while tiers are live. */
export async function paidTier(u: TierRow): Promise<TierKey> {
  const t = effectiveTier(u);
  if (u?.tierSource === "chain" && !(await getLaunchSettings()).tiersLive) return "GHOST";
  return t;
}

/** Tier for FEATURES (alerts, signals, sniper…): everyone is WRAITH while the beta switch is on. */
export async function featureTier(u: TierRow): Promise<TierKey> {
  if ((await getLaunchSettings()).featuresFree) return "WRAITH";
  return paidTier(u);
}

/** OMEN mint to read balances from, or null while tiers are off / no mint is set. */
export async function liveOmenMint(): Promise<string | null> {
  const s = await getLaunchSettings();
  if (!s.tiersLive) return null;
  const m = s.omenMint || WRAITH_MINT;
  return MINT_RE.test(m) ? m : null;
}
