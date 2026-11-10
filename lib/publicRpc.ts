// RPC endpoints that are safe to ship to the browser.
//
// Everything read from a NEXT_PUBLIC_* variable is inlined into the public JavaScript bundle that every visitor downloads, so a
// provider API key must never be stored in one. Keyed endpoints (SOLANA_RPC_URL, DEVNET_RPC_URL, SOLANA_RPC_URLS, ...) live in
// server-only variables and are reached through /api/rpc.

/** Public devnet endpoint, no key. Devnet is only used for the free paper-trading sandbox. */
export const DEVNET_RPC_PUBLIC = "https://api.devnet.solana.com";

/**
 * Optional mainnet push websocket (wss://...) used for sub-second price streaming on the token page. Unset by default: without it the
 * page polls /api/live-price instead, which is only a little slower. Only set NEXT_PUBLIC_SOLANA_WS_URL to a keyless endpoint or to a
 * key that is restricted to this site's domain in the provider dashboard, because the value is visible to anyone who opens the site.
 */
export const SOLANA_WS_PUSH: string = /^wss:\/\//.test(process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "")
  ? (process.env.NEXT_PUBLIC_SOLANA_WS_URL as string)
  : "";
