// lib/signalLog.ts
// Client-side log of every token Wraith flagged, so the Wins board can show how
// those calls performed. Lives in localStorage (per browser).

export interface LoggedCall {
  address: string;
  chain?: string;
  symbol: string;
  name?: string;
  imageUrl?: string;
  spottedAt: number;
  spottedMcap: number;
  peakMcap: number;
  lastMcap: number;
  lastCheck: number;
  tier: "HOT" | "WATCH" | "SCANNER";
  score: number;
  source: "signal" | "scanner";
}

const KEY = "wraith_signal_log_v1";
const LEGACY_KEY = "wraith_token_history_v2";
const MAX = 150;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readCalls(): LoggedCall[] {
  if (typeof window === "undefined") return [];
  const own = readJson<LoggedCall[]>(KEY, []);
  const list = Array.isArray(own) ? own.filter((c) => c && c.address && c.spottedMcap > 0) : [];
  const have = new Set(list.map((c) => c.address));
  const before = list.length;
  // Pull in what the old scanner tracked so nothing is lost.
  const legacy = readJson<Record<string, Record<string, unknown>>>(LEGACY_KEY, {});
  for (const e of Object.values(legacy)) {
    const address = typeof e?.contractAddress === "string" ? e.contractAddress : "";
    const initial = Number(e?.initialMcap);
    if (!address || have.has(address) || !(initial > 0)) continue;
    const cur = Number(e.currentMcap) > 0 ? Number(e.currentMcap) : initial;
    const peak = Math.max(Number(e.peakMcap) || 0, cur, initial);
    list.push({
      address,
      symbol: String(e.tokenSymbol || e.keyword || "TOKEN").toUpperCase(),
      name: typeof e.displayName === "string" ? e.displayName : undefined,
      imageUrl: typeof e.tokenImageUrl === "string" ? e.tokenImageUrl : undefined,
      spottedAt: Number(e.seenAt) || Date.now(),
      spottedMcap: initial,
      peakMcap: peak,
      lastMcap: cur,
      lastCheck: Number(e.lastChecked) || 0,
      tier: "SCANNER",
      score: Number(e.aiScore) || 0,
      source: "scanner",
    });
    have.add(address);
  }
  list.sort((a, b) => b.spottedAt - a.spottedAt);
  // Keep imported scanner calls in our own log so their prices can be refreshed too.
  if (list.length !== before) writeOwn(list);
  return list;
}

function writeOwn(list: LoggedCall[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function logSignals(
  signals: { token: { address: string; symbol: string; name: string; imageUrl?: string; mcap: number }; score: number; tier: "HOT" | "WATCH" }[],
) {
  if (typeof window === "undefined") return;
  const current = readCalls();
  const known = new Set(current.map((c) => c.address));
  const now = Date.now();
  let changed = false;
  for (const s of signals) {
    if (s.score < 60 || known.has(s.token.address) || !(s.token.mcap > 0)) continue;
    current.unshift({
      address: s.token.address,
      symbol: s.token.symbol.toUpperCase(),
      name: s.token.name,
      imageUrl: s.token.imageUrl,
      spottedAt: now,
      spottedMcap: s.token.mcap,
      peakMcap: s.token.mcap,
      lastMcap: s.token.mcap,
      lastCheck: now,
      tier: s.tier,
      score: s.score,
      source: "signal",
    });
    known.add(s.token.address);
    changed = true;
  }
  if (changed) writeOwn(current);
}

export function applyPrices(prices: Record<string, { mcap: number }>) {
  if (typeof window === "undefined") return;
  const own = readJson<LoggedCall[]>(KEY, []);
  let changed = false;
  for (const c of own) {
    const p = prices[c.address];
    if (!p || !(p.mcap > 0)) continue;
    c.lastMcap = p.mcap;
    c.lastCheck = Date.now();
    if (p.mcap > c.peakMcap) c.peakMcap = p.mcap;
    changed = true;
  }
  if (changed) {
    try { localStorage.setItem(KEY, JSON.stringify(own)); } catch { /* ignore */ }
  }
}

export function clearCalls() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
