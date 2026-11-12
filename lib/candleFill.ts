// lib/candleFill.ts  (pure, shared by the chart and its tests)
//
// A thin token has minutes or hours with no trade at all, and the price providers simply leave those candles out. Drawn as they
// come, the chart is a handful of bars glued together with jumps between them, and it stops at the last trade instead of at "now".
// fillGaps makes the series continuous, the way pump.fun and Fomo draw it:
//   - every empty slot between two candles gets a flat candle at the last price, with no volume,
//   - each candle opens where the one before it closed, so there are no holes between bars,
//   - the series runs up to the current time, so a quiet token shows a flat line to now instead of an old last bar.
// Nothing is invented: a flat candle says exactly what happened in that slot, which is "no trade, price unchanged".

export interface FillCandle { t: number; o: number; h: number; l: number; c: number; v: number }

const flat = (t: number, p: number): FillCandle => ({ t, o: p, h: p, l: p, c: p, v: 0 });

export function fillGaps<T extends FillCandle>(
  rows: T[],
  stepMs: number,
  opts: { now?: number; maxBars?: number; longGap?: number; maxTail?: number } = {},
): FillCandle[] {
  if (!rows.length || !(stepMs > 0)) return rows;
  const { now = Date.now(), maxBars = 3000, longGap = 40, maxTail = 120 } = opts;
  const span = Math.round((rows[rows.length - 1].t - rows[0].t) / stepMs) + 1;
  // a very long, mostly empty history would be thousands of flat candles: then a dead stretch is drawn as at most `longGap` of them
  const cap = span > maxBars ? longGap : Infinity;
  const out: FillCandle[] = [];
  let prev: FillCandle | null = null;
  for (const r of rows) {
    if (!(r.t > 0) || !(r.c > 0)) continue;
    if (!prev) { out.push(r); prev = r; continue; }
    if (r.t <= prev.t) continue; // duplicate or out of order
    const missing = Math.round((r.t - prev.t) / stepMs) - 1;
    if (missing > 0) {
      const n = Math.min(missing, cap);
      const start = r.t - n * stepMs; // when capped, keep the part of the quiet stretch that leads into the next real candle
      for (let k = 0; k < n; k++) out.push(flat(start + k * stepMs, prev.c));
    }
    const o = prev.c;
    const next: FillCandle = o === r.o ? r : { ...r, o, h: Math.max(r.h, o), l: Math.min(r.l, o) };
    out.push(next);
    prev = next;
  }
  // run up to now
  if (prev) {
    const nowBucket = Math.floor(now / stepMs) * stepMs;
    const behind = Math.floor((nowBucket - prev.t) / stepMs);
    if (behind >= 1) {
      const n = Math.min(behind, maxTail);
      const start = nowBucket - (n - 1) * stepMs;
      for (let k = 0; k < n; k++) {
        const t = start + k * stepMs;
        if (t > prev.t + stepMs / 2) out.push(flat(t, prev.c));
      }
    }
  }
  return out;
}
