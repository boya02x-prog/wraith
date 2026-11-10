// GET /api/landing → public, read-only proof data for the marketing site.
// Only already-played history is exposed (tracked calls, wins, the call record), never the live signals feed,
// so the tier-gated "live signals" stay gated. Telegram text comes from the bot's own builders, so the site
// shows exactly what users receive.
//
// The landing page AND the login page poll this route, so it must never make a visitor wait on slow work:
//   - it answers from a 30s in-memory copy (the CDN keeps that for a few seconds more),
//   - an older copy is served instantly while ONE background refresh rebuilds it (single-flight),
//   - every slow piece (Mongo, the scanner sample, the chart) has its own time budget,
//   - on a cold start it waits at most ~6s for the database-only part, then answers 503 and the page retries shortly.
// Before this, every call ran the whole scanner plus a chart fetch (35-100s on a dev machine). Calls stacked up behind the
// poll interval, used up the browser's ~6 connections to the host, and the sign-in request could not get through.
import { after, NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import type { SignalCall } from "@/lib/signalCalls";
import { milestoneFor, signalMessage, winMessage } from "@/lib/telegramBot";
import { tokenKeyboard } from "@/lib/telegramUi";
import type { Signal } from "@/app/api/signals/route";
import { callGet } from "@/lib/internalCall";
import { edge } from "@/lib/edge";

export const maxDuration = 30;

type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };
type TgBlock = { html: string; kb: unknown };

const xOf = (c: SignalCall) => (c.spottedMcap > 0 ? c.peakMcap / c.spottedMcap : 0);
/** where the call stands now vs. where Wraith flagged it: the calls that stayed up */
const nowOf = (c: SignalCall) => (c.spottedMcap > 0 ? c.lastMcap / c.spottedMcap : 0);
const slim = (c: SignalCall) => ({
  address: c.address,
  chain: c.chain ?? "solana",
  symbol: c.symbol,
  imageUrl: c.imageUrl ?? null,
  tier: c.tier,
  score: c.score,
  spottedAt: c.spottedAt,
  spottedMcap: c.spottedMcap,
  peakMcap: c.peakMcap,
  lastMcap: c.lastMcap,
  x: Math.round(xOf(c) * 100) / 100,
  nowX: Math.round(nowOf(c) * 100) / 100,
});
type Slim = ReturnType<typeof slim>;

type Body = {
  updatedAt: number;
  stats: { calls: number; hit2: number; rate: number };
  wins: Slim[];
  recent: Slim[];
  telegram: { signal: TgBlock | null; win: TgBlock | null };
  chart: { symbol: string; chain: string; spottedAt: number; spottedMcap: number; candles: Candle[] } | null;
};

const FRESH_MS = 30_000; // served as-is
const STALE_MS = 15 * 60_000; // served instantly while a background refresh runs
let cache: { ts: number; body: Body } | null = null;
let refreshing: Promise<void> | null = null;

/** Resolves with `fallback` if `p` fails or takes longer than `ms`. Never rejects, never hangs. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => {
      t = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    if (t) clearTimeout(t);
  });
}

async function loadCalls(now: number): Promise<SignalCall[] | null> {
  try {
    const db = await getDb();
    // No features / buyers: those are the heavy per-call fields (wallet lists) and the site never shows them.
    return (await db
      .collection<SignalCall>("signal_calls")
      .find(
        { spottedAt: { $gt: now - 7 * 86_400_000 }, spottedMcap: { $gt: 0 }, shadow: { $ne: true }, engine: 2 },
        { projection: { _id: 0, features: 0, buyers: 0 }, maxTimeMS: 8_000 },
      )
      .toArray()) as SignalCall[];
  } catch {
    return null; // db optional: the site shows empty states
  }
}

async function candlesFor(origin: string, c: SignalCall): Promise<Candle[]> {
  try {
    const chain = c.chain && c.chain !== "solana" ? c.chain : null;
    const url = chain
      ? `${origin}/api/evm-chart?address=${c.address}&chain=${chain}&tf=15m`
      : `${origin}/api/token-chart?address=${c.address}&tf=15m`;
    const j = await callGet<{ candles?: Candle[] }>(
      () => (chain ? import("@/app/api/evm-chart/route") : import("@/app/api/token-chart/route")),
      url,
      12_000,
    );
    return (j.candles ?? []).slice(-90);
  } catch {
    return [];
  }
}

/** Real Telegram text for one older call that is still in the live list. */
async function sampleSignal(origin: string, calls: SignalCall[], now: number): Promise<TgBlock | null> {
  const sigs = (await callGet<{ signals?: Signal[] }>(() => import("@/app/api/signals/route"), `${origin}/api/signals`, 12_000)).signals ?? [];
  const old = new Set(calls.filter((c) => c.spottedAt < now - 3_600_000).map((c) => c.address));
  const s = sigs.find((x) => old.has(x.token.address));
  return s ? { html: signalMessage(s), kb: tokenKeyboard(s.token.address, s.token.chain ?? "solana") } : null;
}

/** Everything that comes from the database alone: pure and instant. */
function shape(calls: SignalCall[], now: number) {
  const hit2 = calls.filter((c) => xOf(c) >= 2).length;
  const stats = { calls: calls.length, hit2, rate: calls.length ? Math.round((hit2 / calls.length) * 100) : 0 };
  // Showcase the calls that STAYED up (still well above the call price now), not ones that spiked and dumped.
  const held = calls.filter((c) => nowOf(c) >= 1.5).sort((a, b) => nowOf(b) - nowOf(a));
  const winCalls = held.length >= 3 ? held : calls.filter((c) => xOf(c) >= 1.5).sort((a, b) => xOf(b) - xOf(a));
  const wins = winCalls.slice(0, 8).map(slim);
  const recent = calls.filter((c) => c.spottedAt < now - 3_600_000).sort((a, b) => b.spottedAt - a.spottedAt).slice(0, 8).map(slim);
  const topWin = held.find((c) => nowOf(c) >= 2) ?? calls.filter((c) => xOf(c) >= 2).sort((a, b) => xOf(b) - xOf(a))[0];
  const win: TgBlock | null = topWin
    ? { html: winMessage(topWin, milestoneFor(topWin.lastMcap / topWin.spottedMcap) || 2), kb: tokenKeyboard(topWin.address, topWin.chain ?? "solana") }
    : null;
  return { stats, wins, recent, win, chartSrc: topWin ?? winCalls[0] ?? null };
}

/** One rebuild at a time, shared by every visitor. Publishes the database part first, the slow extras after. */
function refresh(origin: string): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const now = Date.now();
    const calls = await within(loadCalls(now), 9_000, null);
    if (!calls) return; // database unreachable: keep serving whatever we already have
    const s = shape(calls, now);
    const prev = cache?.body ?? null;
    cache = {
      ts: now,
      body: { updatedAt: now, stats: s.stats, wins: s.wins, recent: s.recent, telegram: { signal: prev?.telegram.signal ?? null, win: s.win }, chart: prev?.chart ?? null },
    };

    const src = s.chartSrc;
    const [signal, candles] = await Promise.all([
      within(sampleSignal(origin, calls, now), 14_000, null),
      src ? within(candlesFor(origin, src), 14_000, [] as Candle[]) : Promise.resolve([] as Candle[]),
    ]);
    // A slow or empty extra never wipes what the last good run found.
    const chart: Body["chart"] = !src
      ? null
      : candles.length
        ? { symbol: src.symbol, chain: src.chain ?? "solana", spottedAt: src.spottedAt, spottedMcap: src.spottedMcap, candles }
        : prev?.chart && prev.chart.symbol === src.symbol
          ? prev.chart
          : { symbol: src.symbol, chain: src.chain ?? "solana", spottedAt: src.spottedAt, spottedMcap: src.spottedMcap, candles: [] };
    cache = {
      ts: Date.now(),
      body: { updatedAt: now, stats: s.stats, wins: s.wins, recent: s.recent, telegram: { signal: signal ?? prev?.telegram.signal ?? null, win: s.win }, chart },
    };
  })()
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const age = cache ? Date.now() - cache.ts : Infinity;
  if (cache && age < FRESH_MS) return edge(NextResponse.json(cache.body), 15, 90);

  const run = refresh(origin); // single-flight: concurrent visitors share one rebuild
  after(() => run); // serverless: stay alive until it settles, but never make the visitor wait for it
  if (cache && age < STALE_MS) return edge(NextResponse.json(cache.body), 5, 60);

  // Cold start: nothing to show yet. Give the database-only part a few seconds, then let the page retry.
  for (let i = 0; i < 40 && !cache; i++) await new Promise((r) => setTimeout(r, 150));
  if (cache) return edge(NextResponse.json(cache.body), 5, 60);
  return NextResponse.json({ error: "warming up" }, { status: 503, headers: { "Retry-After": "5" } });
}
