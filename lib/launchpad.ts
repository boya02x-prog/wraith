// Where a Solana token was launched, read from its address. Launchpads give their tokens addresses that end in a fixed tag
// ("...pump" for pump.fun), so this needs no network call and cannot be wrong for the tags below. Anything else returns null:
// no guess is shown. (StonkFun and others do not use a fixed tag, so they are not listed rather than guessed.)
const TAGS: { suffix: string; name: string }[] = [
  { suffix: "pump", name: "pump.fun" },
  { suffix: "bonk", name: "LetsBonk" },
  { suffix: "BAGS", name: "Bags" },
  { suffix: "boop", name: "boop.fun" },
];

export function launchpadOf(address: string | null | undefined, chain?: string | null): string | null {
  if (!address || (chain && chain !== "solana") || address.startsWith("0x")) return null;
  const hit = TAGS.find((t) => address.endsWith(t.suffix));
  return hit ? hit.name : null;
}
