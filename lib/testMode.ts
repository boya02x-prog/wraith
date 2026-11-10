"use client";

// Testnet / test mode has been retired. Everything that reads this now always sees "off",
// so no screen switches to the devnet sandbox even if an old browser still has the flag stored.
export function readTestMode(): boolean { return false; }
export function setTestMode(_on: boolean) { void _on; }
export function useTestMode(): readonly [boolean, (on: boolean) => void] {
  return [false, setTestMode] as const;
}
