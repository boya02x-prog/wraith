// Trading streak: how many days in a row (UTC days) a trader closed at least one trade. The streak is still alive if the last trade was today or yesterday.
export type StreakInfo = { current: number; best: number };

export function streakOf(trades: { ts?: number; closedAt?: number }[], now = Date.now()): StreakInfo {
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  const days = [...new Set(trades.map((t) => t.closedAt ?? t.ts ?? 0).filter((n) => n > 0).map(day))].sort((a, b) => a - b);
  if (!days.length) return { current: 0, best: 0 };
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i++) { run = days[i] === days[i - 1] + 1 ? run + 1 : 1; if (run > best) best = run; }
  const today = day(now);
  const last = days[days.length - 1];
  if (last < today - 1) return { current: 0, best };
  let cur = 1;
  for (let i = days.length - 1; i > 0 && days[i] - 1 === days[i - 1]; i--) cur++;
  return { current: cur, best };
}

/** what a streak unlocks on the Wraith */
export const STREAK_UNLOCKS = [
  { days: 3, label: "A hat", key: "hat" },
  { days: 7, label: "Something to hold", key: "prop" },
  { days: 14, label: "A mark on its belly", key: "emblem" },
] as const;

export function nextUnlock(streak: number): { days: number; label: string; left: number } | null {
  const n = STREAK_UNLOCKS.find((u) => streak < u.days);
  return n ? { days: n.days, label: n.label, left: n.days - streak } : null;
}
