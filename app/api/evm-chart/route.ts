// GET /api/evm-chart?address=0x…&chain=base&tf=15m
// OHLCV from GeckoTerminal for the token's deepest pool (pool resolved via DexScreener, cached).
import { NextRequest, NextResponse } from "next/server";
import { arr, GECKO_HEADERS, getJson, num, obj } from "@/lib/marketProviders";
import { getEvmSnapshot } from "@/lib/evmData";
import { chainOf, EVM_ADDR_RE } from "@/lib/chains";

const TF: Record<string, { tf: "minute" | "hour" | "day"; agg: number; sec: number }> = {
  "1m": { tf: "minute", agg: 1, sec: 60 },
  "5m": { tf: "minute", agg: 5, sec: 300 },
  "15m": { tf: "minute", agg: 15, sec: 900 },
  "1h": { tf: "hour", agg: 1, sec: 3600 },
  "4h": { tf: "hour", agg: 4, sec: 14400 },
  "1d": { tf: "day", agg: 1, sec: 86400 },
};
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
const cache = new Map<string, { ts: number; candles: Candle[] }>();
const CACHE_MS = 8_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geckoOhlcv(url: string): Promise<unknown> {
  try {
    return await getJson(url, GECKO_HEADERS, 9000);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("429")) { await sleep(1200); return getJson(url, GECKO_HEADERS, 9000); }
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address") ?? "";
  const tf = TF[sp.get("tf") ?? "15m"] ?? TF["15m"];
  if (!EVM_ADDR_RE.test(address)) return NextResponse.json({ candles: [], error: "Invalid EVM address" }, { status: 400 });

  const key = `${address.toLowerCase()}:${sp.get("chain") ?? ""}:${tf.tf}${tf.agg}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return NextResponse.json({ candles: hit.candles, source: "gecko", intervalSec: tf.sec, updatedAt: hit.ts });

  try {
    const snap = await getEvmSnapshot(address, sp.get("chain"));
    const chain = chainOf(snap?.chain ?? sp.get("chain"));
    if (!snap || !chain || !snap.pairAddress) return NextResponse.json({ candles: [], source: "none", intervalSec: tf.sec });
    let list: unknown[] = [];
    let lastErr = "no pools";
    for (const pool of (snap.pools?.length ? snap.pools : [snap.pairAddress])) {
      try {
        const url = `https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/pools/${pool}/ohlcv/${tf.tf}?aggregate=${tf.agg}&limit=300&currency=usd`;
        const data = obj(await geckoOhlcv(url));
        list = arr(obj(obj(obj(data.data).attributes)).ohlcv_list);
        if (list.length) break;
        lastErr = `empty ohlcv for pool ${pool}`;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "gecko error";
      }
    }
    if (!list.length) {
      console.warn(`[evm-chart] ${chain.key} ${address}: ${lastErr}`);
      if (hit) return NextResponse.json({ candles: hit.candles, source: "gecko", stale: true, intervalSec: tf.sec, updatedAt: hit.ts });
      return NextResponse.json({ candles: [], error: lastErr }, { status: /^(429|5\d\d)/.test(lastErr) ? 502 : 200 });
    }
    const candles: Candle[] = list
      .map((r) => (Array.isArray(r) ? r : []))
      .filter((r) => r.length >= 6)
      .map((r) => ({ t: num(r[0]) * 1000, o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5]) }))
      .filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)
      .sort((a, b) => a.t - b.t);
    // forward-fill quiet intervals so the chart has no holes, and extend to "now"
    const filled: Candle[] = [];
    const stepMs = tf.sec * 1000;
    for (const c of candles) {
      const prev = filled[filled.length - 1];
      if (prev) {
        for (let t = prev.t + stepMs; t < c.t && filled.length < 2000; t += stepMs) filled.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      }
      filled.push(c);
    }
    const last = filled[filled.length - 1];
    if (last) {
      const nowBucket = Math.floor(Date.now() / stepMs) * stepMs;
      for (let t = last.t + stepMs; t <= nowBucket && filled.length < 2000; t += stepMs) filled.push({ t, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 });
    }
    cache.set(key, { ts: Date.now(), candles: filled });
    return NextResponse.json({ candles: filled, source: "gecko", intervalSec: tf.sec, updatedAt: Date.now() });
  } catch (e) {
    if (hit) return NextResponse.json({ candles: hit.candles, source: "gecko", stale: true, intervalSec: tf.sec, updatedAt: hit.ts });
    return NextResponse.json({ candles: [], error: e instanceof Error ? e.message : "Chart provider error" }, { status: 502 });
  }
}
