import type { MemeTrend } from "@/app/app/page";

export const TOKEN_FAVORITES_KEY = "wraith_token_favorites_v1";
export const TOKEN_FAVORITES_EVENT = "wraith:favorites-sync";

/** The saved list from its stored text (also used by the saved-token bar, which watches the raw text so it can re-read only when it changes). */
export function parseTokenFavorites(raw: string | null): MemeTrend[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is MemeTrend => Boolean(item && typeof item === "object" && "contractAddress" in item))
      : [];
  } catch {
    return [];
  }
}

export function readTokenFavorites(): MemeTrend[] {
  if (typeof window === "undefined") return [];
  try {
    return parseTokenFavorites(localStorage.getItem(TOKEN_FAVORITES_KEY));
  } catch {
    return [];
  }
}

export function toggleTokenFavorite(token: MemeTrend): MemeTrend[] {
  if (typeof window === "undefined" || !token.contractAddress) return [];
  const favorites = readTokenFavorites();
  const exists = favorites.some((item) => item.contractAddress === token.contractAddress);
  const next = exists
    ? favorites.filter((item) => item.contractAddress !== token.contractAddress)
    : [{ ...token, savedAt: token.savedAt ?? Date.now() }, ...favorites];
  try {
    localStorage.setItem(TOKEN_FAVORITES_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(TOKEN_FAVORITES_EVENT));
  } catch {}
  return next;
}
