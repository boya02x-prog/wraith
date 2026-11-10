import type { MemeTrend } from "@/app/app/page";

export const TOKEN_FAVORITES_KEY = "wraith_token_favorites_v1";
export const TOKEN_FAVORITES_EVENT = "wraith:favorites-sync";

export function readTokenFavorites(): MemeTrend[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TOKEN_FAVORITES_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is MemeTrend => Boolean(item && typeof item === "object" && "contractAddress" in item))
      : [];
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
    : [token, ...favorites];
  try {
    localStorage.setItem(TOKEN_FAVORITES_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(TOKEN_FAVORITES_EVENT));
  } catch {}
  return next;
}
