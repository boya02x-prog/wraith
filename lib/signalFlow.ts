// lib/signalFlow.ts  (pure: no database, no network)
// Turns a token's recent swaps into "order flow" numbers: how many different buyers, how concentrated, whether buying is speeding up.
// Shared by the live scanner (lib/signalIntel.ts) and by scripts that rebuild the same numbers from on-chain history.
import type { Swap } from "@/lib/heliusSwaps";

export interface FlowIntel { buyers: number; buys: number; sells: number; top3Share: number; accel: number; netSol: number; bundled: number; windowMin: number }

/** Pure: turn raw swaps into flow numbers + the list of buyer wallets (oldest first). Exported for tests. */
export function computeFlow(swaps: Swap[], now = Date.now()): { flow: FlowIntel; buyers: string[] } | null {
  if (swaps.length < 8) return null;
  const sorted = [...swaps].sort((a, b) => a.ts - b.ts);
  const buys = sorted.filter((s) => s.side === "buy");
  const sells = sorted.filter((s) => s.side === "sell");
  const spend = new Map<string, number>();
  for (const b of buys) spend.set(b.wallet, (spend.get(b.wallet) ?? 0) + b.sol);
  const totalBuy = [...spend.values()].reduce((a, b) => a + b, 0);
  const top3 = [...spend.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const t5 = now - 5 * 60_000, t10 = now - 10 * 60_000, t15 = now - 15 * 60_000;
  const b5 = buys.filter((s) => s.ts >= t5).length;
  const b10 = buys.filter((s) => s.ts < t5 && s.ts >= t10).length;
  const net = buys.filter((s) => s.ts >= t15).reduce((a, s) => a + s.sol, 0) - sells.filter((s) => s.ts >= t15).reduce((a, s) => a + s.sol, 0);
  const first = sorted[0].ts;
  const complete = swaps.length <= 90; // history reaches back to the first trade
  const bundled = complete ? new Set(buys.filter((s) => s.ts - first <= 4_000).map((s) => s.wallet)).size : 0;
  const buyers: string[] = [];
  const seen = new Set<string>();
  for (const b of buys) if (b.wallet && !seen.has(b.wallet)) { seen.add(b.wallet); buyers.push(b.wallet); }
  return {
    flow: {
      buyers: seen.size, buys: buys.length, sells: sells.length,
      top3Share: totalBuy > 0 ? top3 / totalBuy : 0,
      // only a real comparison when the trades reach back 10+ minutes: a busy token fills 200 swaps in a few minutes, and then "nothing in the
      // earlier 5 minutes" is an artefact of the window, not acceleration (it used to read as 80-150x for most young tokens)
      accel: now - first >= 10 * 60_000 ? (b5 + 1) / (b10 + 1) : 1,
      netSol: net, bundled,
      windowMin: Math.round((now - first) / 60_000),
    },
    buyers: buyers.slice(-80),
  };
}
