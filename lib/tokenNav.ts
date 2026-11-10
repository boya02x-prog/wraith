import type { MemeTrend } from "@/app/app/page";

// sessionStorage, not localStorage — this is a handoff for the click that
// just happened, not something that should still be "true" days later
// (mcap/volume/score go stale fast). A direct link or refresh on the token
// page just won't have a cache hit, which the page already treats as normal
// (falls back to symbol-less/address-only rendering until PaperTrader/
// TokenPanel resolve their own live data from the contract address).
const PREFIX = "wraith_token_nav_";

export function cacheTokenNav(meme: MemeTrend) {
  if (typeof window === "undefined" || !meme.contractAddress) return;
  try {
    sessionStorage.setItem(PREFIX + meme.contractAddress, JSON.stringify(meme));
  } catch {}
}

export function readTokenNav(address: string): MemeTrend | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + address);
    return raw ? (JSON.parse(raw) as MemeTrend) : null;
  } catch {
    return null;
  }
}
