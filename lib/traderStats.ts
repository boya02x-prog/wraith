// Trader statistics: period gains, win rate, streaks, average hold, and a 6-axis "what is this trader good at" profile.
// Pure functions, so the same numbers come out on the server (traders list) and in the browser (own profile).

export interface StatTrade {
  amountSol?: number;
  pnlPct?: number;
  /** open time (ms) */
  ts?: number;
  /** close time (ms), only recorded for trades closed after hold-time tracking shipped */
  closedAt?: number;
}

export interface RadarPoint {
  key: string;
  label: string;
  value: number; // 0..100
}

export interface TraderStatsResult {
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null; // 0..100
  bestPct: number;
  avgWinPct: number;
  avgLossPct: number; // positive magnitude
  streak: number;
  avgHoldMs: number | null;
  holdSamples: number;
  pnlSol: { d1: number; d7: number; d30: number; all: number };
  radar: RadarPoint[];
  tags: string[];
  curve: number[]; // cumulative SOL pnl, oldest -> newest (last 24 closes)
}

export const DAY_MS = 86_400_000;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const closeTs = (t: StatTrade) => t.closedAt ?? t.ts ?? 0;
const pnlOf = (t: StatTrade) => (t.amountSol ?? 0) * ((t.pnlPct ?? 0) / 100);

export function computeTraderStats(input: StatTrade[], opts: { sinceMs?: number; now?: number } = {}): TraderStatsResult {
  const now = opts.now ?? Date.now();
  const all = input.filter(
    (t) => typeof t.pnlPct === "number" && Number.isFinite(t.pnlPct) && typeof t.amountSol === "number" && Number.isFinite(t.amountSol),
  );
  const sum = (since: number) => all.filter((t) => closeTs(t) >= since).reduce((s, t) => s + pnlOf(t), 0);
  const pnlSol = { d1: sum(now - DAY_MS), d7: sum(now - 7 * DAY_MS), d30: sum(now - 30 * DAY_MS), all: sum(0) };

  const scoped = (opts.sinceMs ? all.filter((t) => closeTs(t) >= now - opts.sinceMs!) : all)
    .slice()
    .sort((a, b) => closeTs(a) - closeTs(b));

  const winsList = scoped.filter((t) => (t.pnlPct ?? 0) > 0);
  const lossList = scoped.filter((t) => (t.pnlPct ?? 0) <= 0);
  const closed = scoped.length;
  const winRate = closed ? (winsList.length / closed) * 100 : null;
  const bestPct = scoped.reduce((m, t) => Math.max(m, t.pnlPct ?? 0), 0);
  const avgWinPct = winsList.length ? winsList.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / winsList.length : 0;
  const avgLossPct = lossList.length ? Math.abs(lossList.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / lossList.length) : 0;

  let streak = 0;
  let run = 0;
  for (const t of scoped) {
    if ((t.pnlPct ?? 0) > 0) {
      run += 1;
      streak = Math.max(streak, run);
    } else run = 0;
  }

  const holds = scoped
    .filter((t) => typeof t.closedAt === "number" && typeof t.ts === "number" && t.closedAt! > t.ts!)
    .map((t) => t.closedAt! - t.ts!);
  const avgHoldMs = holds.length ? holds.reduce((s, h) => s + h, 0) / holds.length : null;

  const radar: RadarPoint[] = [
    { key: "acc", label: "Accuracy", value: winRate === null ? 0 : clamp(winRate) },
    { key: "win", label: "Avg win", value: clamp((avgWinPct / 150) * 100) },
    { key: "dis", label: "Discipline", value: closed && lossList.length ? clamp(100 - avgLossPct * 1.6) : closed ? 100 : 0 },
    { key: "moon", label: "Moonshot", value: bestPct > 0 ? clamp((Math.log10(1 + bestPct / 100) / Math.log10(11)) * 100) : 0 },
    { key: "act", label: "Activity", value: clamp((closed / 30) * 100) },
    { key: "str", label: "Streak", value: clamp((streak / 8) * 100) },
  ];

  const tags: string[] = [];
  if (closed < 3) tags.push("Unrated");
  else {
    if ((winRate ?? 0) >= 60) tags.push("Sharpshooter");
    if (bestPct >= 500) tags.push("Moonshot hunter");
    if (lossList.length && avgLossPct <= 20) tags.push("Disciplined");
    if (closed >= 20) tags.push("Grinder");
    if (streak >= 4) tags.push("On fire");
  }

  const tail = all.slice().sort((a, b) => closeTs(a) - closeTs(b)).slice(-24);
  let acc = 0;
  const curve = tail.map((t) => (acc += pnlOf(t)));

  return {
    closed,
    wins: winsList.length,
    losses: lossList.length,
    winRate,
    bestPct,
    avgWinPct,
    avgLossPct,
    streak,
    avgHoldMs,
    holdSamples: holds.length,
    pnlSol,
    radar,
    tags: tags.slice(0, 2),
    curve,
  };
}

export function fmtHold(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "-";
  const m = ms / 60_000;
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}

export function fmtMult(pct: number): string {
  const x = 1 + pct / 100;
  return `${x < 10 ? x.toFixed(1) : Math.round(x)}x`;
}
