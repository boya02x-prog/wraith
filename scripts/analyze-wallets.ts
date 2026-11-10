/**
 * Offline analysis of the collected early buyers: who are these wallets and how do they behave?
 *   npx tsx scripts/analyze-wallets.ts
 * Reads scripts/.pilot/collect-big.json (no database, no network). Writes scripts/.pilot/wallet-profiles.json
 * Behaviour per wallet is measured from the first 30 minutes of each token it bought: how early it buys, how big, whether it
 * sells inside the window, whether it is still holding at the end, how many tokens it touches, and how those tokens ended.
 */
import { readFileSync, writeFileSync } from "node:fs";

interface W { w: string; sol: number; buyOffsetS: number; soldPct: number; heldS: number | null; holdingAtHourEnd: boolean }
interface Row { mint: string; win: boolean; ratioPeak: number; ratioLast: number; t0: number; wallets: W[] }

export type Kind = "sniper" | "flipper" | "holder" | "whale" | "volume-bot" | "regular";
const rows = (JSON.parse(readFileSync("scripts/.pilot/collect-big.json", "utf8")) as Row[]).filter((r) => r.t0 && r.wallets?.length);
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

interface Agg { tokens: number; wins: number; dumps: number; offs: number[]; sols: number[]; held: number; sold30: number; soldFast: number; sniped: number }
const agg = new Map<string, Agg>();
for (const r of rows) for (const w of r.wallets) {
  const a = agg.get(w.w) ?? { tokens: 0, wins: 0, dumps: 0, offs: [], sols: [], held: 0, sold30: 0, soldFast: 0, sniped: 0 };
  a.tokens++; if (r.win) a.wins++; if (r.ratioLast <= 0.5) a.dumps++;
  a.offs.push(w.buyOffsetS); a.sols.push(w.sol);
  if (w.buyOffsetS <= 3) a.sniped++;
  if (w.holdingAtHourEnd) a.held++;
  if (w.soldPct >= 50) a.sold30++;
  if (w.heldS !== null && w.heldS < 60) a.soldFast++;
  agg.set(w.w, a);
}

/** One label per wallet, first rule that fits. Needs 3+ tokens so a single trade is never labelled. */
export function classify(a: Agg, totalTokens: number): Kind {
  const n = a.tokens;
  const avgSol = a.sols.reduce((s, v) => s + v, 0) / n;
  if (n >= totalTokens * 0.2 && n >= 20) return "volume-bot"; // touches a fifth of everything: automated
  if (a.sniped / n >= 0.6) return "sniper"; // usually in within the first 3 seconds
  if (avgSol >= 5) return "whale";
  if (a.soldFast / n >= 0.5 || a.sold30 / n >= 0.7) return "flipper"; // out within a minute / sells most of it in 30 min
  if (a.held / n >= 0.7) return "holder"; // still holding at the end of the window most of the time
  return "regular";
}

const profiles = [...agg.entries()].filter(([, a]) => a.tokens >= 3).map(([w, a]) => ({
  w, kind: classify(a, rows.length), tokens: a.tokens, wins: a.wins, dumps: a.dumps,
  medOffsetS: Math.round(med(a.offs)), avgSol: +(a.sols.reduce((s, v) => s + v, 0) / a.tokens).toFixed(2),
  holdPct: Math.round((a.held / a.tokens) * 100), flipPct: Math.round((a.soldFast / a.tokens) * 100),
}));
writeFileSync("scripts/.pilot/wallet-profiles.json", JSON.stringify(profiles));

console.log(`${rows.length} tokens, ${agg.size} wallets, ${profiles.length} seen in 3+ tokens (those get a profile)\n`);
const kinds = new Map<Kind, typeof profiles>();
for (const p of profiles) kinds.set(p.kind, [...(kinds.get(p.kind) ?? []), p]);
console.log("kind         wallets   win rate   dump rate   median buy offset   avg size   holding at end");
for (const k of ["sniper", "volume-bot", "whale", "flipper", "holder", "regular"] as Kind[]) {
  const g = kinds.get(k) ?? [];
  if (!g.length) continue;
  const t = g.reduce((s, p) => s + p.tokens, 0);
  console.log(`${k.padEnd(12)} ${String(g.length).padStart(7)}   ${(g.reduce((s, p) => s + p.wins, 0) / t * 100).toFixed(1).padStart(6)}%   ${(g.reduce((s, p) => s + p.dumps, 0) / t * 100).toFixed(1).padStart(7)}%   ${String(Math.round(med(g.map((p) => p.medOffsetS)))).padStart(13)}s   ${med(g.map((p) => p.avgSol)).toFixed(2).padStart(8)}   ${Math.round(g.reduce((s, p) => s + p.holdPct, 0) / g.length).toString().padStart(8)}%`);
}
// proven vs dumpers: do the proven ones hold longer?
const proven = profiles.filter((p) => p.tokens >= 3 && p.wins / p.tokens >= 0.3 && p.dumps / p.tokens < 0.6);
const dumpers = profiles.filter((p) => p.tokens >= 4 && p.dumps / p.tokens >= 0.75);
const avg = (a: typeof profiles, f: (p: typeof profiles[number]) => number) => (a.length ? (a.reduce((s, p) => s + f(p), 0) / a.length).toFixed(0) : "n/a");
console.log(`\nproven (${proven.length}): holding at end of window ${avg(proven, (p) => p.holdPct)}%, flip within a minute ${avg(proven, (p) => p.flipPct)}%, median buy offset ${avg(proven, (p) => p.medOffsetS)}s`);
console.log(`dumpers (${dumpers.length}): holding at end of window ${avg(dumpers, (p) => p.holdPct)}%, flip within a minute ${avg(dumpers, (p) => p.flipPct)}%, median buy offset ${avg(dumpers, (p) => p.medOffsetS)}s`);
console.log(`everyone (${profiles.length}): holding ${avg(profiles, (p) => p.holdPct)}%, flip ${avg(profiles, (p) => p.flipPct)}%, offset ${avg(profiles, (p) => p.medOffsetS)}s`);
const kindOf = (a: typeof profiles) => { const c = new Map<string, number>(); a.forEach((p) => c.set(p.kind, (c.get(p.kind) ?? 0) + 1)); return [...c.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round((v / a.length) * 100)}%`).join(", "); };
console.log(`\nproven wallets are: ${kindOf(proven)}`);
console.log(`dumpers are: ${kindOf(dumpers)}`);
