"use client";
// A row or card that reacts when its number really moved. Give it the value it shows (market cap); when a refresh brings a
// different value it returns a CSS class to play once: a green tint for up (with a shake from `shakePct` up), a red tint for down.
// Nothing plays on first render or for moves smaller than `minPct`, and each row gets its own short random delay so a refresh
// that updates thirty rows at once ripples through the list instead of flashing as one block.
import { useEffect, useRef, useState } from "react";

export function useTick(value: number | null | undefined, opts: { minPct?: number; shakePct?: number } = {}): { cls: string; delay: number } | null {
  const { minPct = 0.3, shakePct = 1 } = opts;
  const prev = useRef(value);
  const n = useRef(0);
  const [tick, setTick] = useState<{ cls: string; delay: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (!p || !value || !(p > 0) || !(value > 0) || p === value) return;
    const pct = (value / p - 1) * 100;
    if (Math.abs(pct) < minPct) return;
    n.current += 1;
    const ab = n.current % 2 ? "a" : "b"; // alternate between two identical animations so the same move twice in a row replays
    const kind = pct > 0 ? (pct >= shakePct ? "buy" : "up") : "down";
    setTick({ cls: `wx-tick-${kind}-${ab}`, delay: Math.round(Math.random() * 1200) });
  }, [value, minPct, shakePct]);
  return tick;
}
