"use client";

import { useEffect, useRef } from "react";

export interface LiveTrade {
  id: string;
  ts: number;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  priceSol: number;
  marketCapSol: number | null;
  wallet: string;
  pool: string | null;
}

const WS_URL = "wss://pumpportal.fun/api/data";

/**
 * Streams every buy/sell of a token in real time (PumpPortal websocket: pump.fun
 * bonding curve + PumpSwap). Auto-reconnects. Tokens it doesn't cover simply
 * produce no events and the page keeps using polling.
 */
export function useLiveTrades(mint: string, onTrade: (t: LiveTrade) => void, enabled = true) {
  const cb = useRef(onTrade);
  cb.current = onTrade;

  useEffect(() => {
    if (!mint || !enabled || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let alive = true;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A busy token can print 20+ trades a second. Handing each one to React separately means 20 renders a second of the
    // whole token page. Collect them for ~120ms and deliver together: React batches every setState of one tick into
    // a single render, so the page still updates ~8 times a second, which looks live but costs a fraction.
    const queue: LiveTrade[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      if (!alive) { queue.length = 0; return; }
      for (const t of queue.splice(0, queue.length)) cb.current(t);
    };

    const connect = () => {
      if (!alive) return;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        timer = setTimeout(connect, 5000);
        return;
      }
      ws.onopen = () => {
        retry = 0;
        ws?.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] }));
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (m.mint !== mint) return;
          const side = m.txType === "buy" ? "buy" : m.txType === "sell" ? "sell" : null;
          if (!side) return;
          const sol = Number(m.solAmount);
          const tokens = Number(m.tokenAmount);
          if (!(sol > 0) || !(tokens > 0)) return;
          const mc = Number(m.marketCapSol);
          queue.push({
            id: String(m.signature ?? `${Date.now()}-${Math.random()}`),
            ts: Date.now(),
            side,
            sol,
            tokens,
            priceSol: sol / tokens,
            marketCapSol: mc > 0 ? mc : null,
            wallet: String(m.traderPublicKey ?? ""),
            pool: typeof m.pool === "string" ? m.pool : null,
          });
          if (queue.length > 300) queue.splice(0, queue.length - 300);
          if (!flushTimer) flushTimer = setTimeout(flush, 120);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (!alive) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(15_000, 1000 * retry));
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* */ } };
    };
    connect();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      if (flushTimer) clearTimeout(flushTimer);
      queue.length = 0;
      try { ws?.close(); } catch { /* */ }
    };
  }, [mint, enabled]);
}
