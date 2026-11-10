// lib/paperTrading.ts
//
// Shared paper-account executor. PaperTrader.tsx owns the full paper-trading
// UI (SL/TP/trail config, positions list, auto-sell polling) and keeps its
// own React state in sync with localStorage. This module lets OTHER
// components — right now just the TokenHoverPreview quick-buy row — fire a
// paper buy against that exact same account without needing to be inside
// PaperTrader's component tree.
//
// It talks to PaperTrader purely through localStorage + a custom window
// event ("wraith:paper-sync"). PaperTrader listens for that event and
// re-reads its state from localStorage when it fires — see the effect added
// near its other PAPER_*_KEY effects. Without that listener, a quick-buy
// fired from here would get silently overwritten the next time PaperTrader
// itself re-persists its (stale, in-memory) state.
//
// Scope: PAPER account only. This intentionally never touches the hot
// wallet / live trading path — one-click buys with no confirmation step
// should never move real SOL.

import { getMcap } from "@/lib/getTokenPrice";

const PAPER_BAL_KEY = "wraith_paper_bal_v1";
const PAPER_POSITIONS_KEY = "wraith_paper_positions_v1";
const PAPER_LOG_KEY = "wraith_paper_log_v1";
const PAPER_STARTING_SOL = 10;
const WINS_BOUGHT_KEY = "wraith_bought_keys";

// Defaults used when a position is opened with no SL/TP/trail config UI in
// front of it — same numbers PaperTrader itself defaults to.
const DEFAULT_SL = -20;
const DEFAULT_TP = 2;
const DEFAULT_TRAIL = 15;

const SYNC_EVENT = "wraith:paper-sync";

interface PaperFill {
  mcap: number;
  amountSol: number;
  ts: number;
}

interface PaperPosition {
  id: string;
  symbol: string;
  mint: string;
  entryMcap: number;
  entryPrice: number;
  tokenAmount: number;
  amountSol: number;
  slPct: number;
  tpX: number;
  trailPct: number;
  peakMcap: number;
  currentMcap: number;
  currentPnlPct: number;
  trailStopMcap: number;
  status: "watching" | "closed";
  exitReason?: "TP" | "SL" | "TRAIL" | "MANUAL";
  exitMcap?: number;
  exitPnlPct?: number;
  imageUrl?: string;
  ts: number;
  fills?: PaperFill[];
}

interface PaperLog {
  id: string;
  symbol: string;
  mint: string;
  entryMcap: number;
  exitMcap?: number;
  amountSol: number;
  slPct: number;
  tpX: number;
  pnlPct?: number;
  exitReason?: string;
  imageUrl?: string;
  ts: number;
}

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet<T>(key: string, val: T) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

function markBoughtInWinsPanel(keyword: string) {
  if (typeof window === "undefined") return;
  try {
    const existing: string[] = JSON.parse(
      localStorage.getItem(WINS_BOUGHT_KEY) || "[]",
    );
    const kw = keyword.toLowerCase();
    if (!existing.includes(kw)) {
      existing.push(kw);
      localStorage.setItem(WINS_BOUGHT_KEY, JSON.stringify(existing));
    }
  } catch {}
}

export interface QuickBuyResult {
  ok: boolean;
  message: string;
}

/**
 * Fires an instant paper buy — no confirmation, no config step. Mirrors
 * PaperTrader's own handlePaperBuy (average-in on rebuy, same defaults),
 * just callable from anywhere.
 */
export async function quickPaperBuy(args: {
  mint: string;
  symbol: string;
  amountSol: number;
  imageUrl?: string;
  /** how the size should read in messages (e.g. "₱100"); defaults to the SOL amount */
  amountLabel?: string;
}): Promise<QuickBuyResult> {
  const { mint, symbol, amountSol, imageUrl } = args;
  const sizeText = args.amountLabel ?? `${amountSol} SOL`;

  if (!mint || !symbol || !Number.isFinite(amountSol) || amountSol <= 0) {
    return { ok: false, message: "Invalid buy request" };
  }

  const paperBal = lsGet<number>(PAPER_BAL_KEY, PAPER_STARTING_SOL);
  if (amountSol > paperBal) {
    return {
      ok: false,
      message: "Not enough paper balance for this buy",
    };
  }

  const entryMcap = await getMcap(mint, { skipJupiter: true });
  if (!entryMcap) {
    return { ok: false, message: "No mcap data yet — try again shortly" };
  }

  const positions = lsGet<PaperPosition[]>(PAPER_POSITIONS_KEY, []);
  const log = lsGet<PaperLog[]>(PAPER_LOG_KEY, []);
  const fill: PaperFill = { mcap: entryMcap, amountSol, ts: Date.now() };
  const existing = positions.find(
    (p) => p.status === "watching" && p.mint === mint,
  );

  let nextPositions: PaperPosition[];
  let message: string;

  if (existing) {
    const totalSol = existing.amountSol + amountSol;
    const avgEntryMcap =
      (existing.entryMcap * existing.amountSol + entryMcap * amountSol) /
      totalSol;
    const newPeak = Math.max(existing.peakMcap, entryMcap);
    const newPnlPct = (existing.currentMcap / avgEntryMcap - 1) * 100;
    nextPositions = positions.map((p) =>
      p.id === existing.id
        ? {
            ...p,
            entryMcap: avgEntryMcap,
            amountSol: totalSol,
            peakMcap: newPeak,
            currentPnlPct: newPnlPct,
            trailStopMcap: newPeak * (1 - p.trailPct / 100),
            fills: [
              ...(p.fills || [
                { mcap: p.entryMcap, amountSol: p.amountSol, ts: p.ts },
              ]),
              fill,
            ],
          }
        : p,
    );
    message = `Added ${sizeText} to ${symbol} · avg entry now ${avgEntryMcap >= 1000 ? `$${(avgEntryMcap / 1000).toFixed(1)}K` : `$${avgEntryMcap.toFixed(0)}`}`;
  } else {
    const trailFrac = DEFAULT_TRAIL / 100;
    const pos: PaperPosition = {
      id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      mint,
      entryMcap,
      entryPrice: 0,
      tokenAmount: 0,
      amountSol,
      slPct: DEFAULT_SL,
      tpX: DEFAULT_TP,
      trailPct: DEFAULT_TRAIL,
      peakMcap: entryMcap,
      currentMcap: entryMcap,
      currentPnlPct: 0,
      trailStopMcap: entryMcap * (1 - trailFrac),
      status: "watching",
      imageUrl,
      ts: Date.now(),
      fills: [fill],
    };
    nextPositions = [pos, ...positions];
    message = `✓ Bought ${symbol} — ${sizeText} · auto-sell armed (${DEFAULT_SL}% SL / ${DEFAULT_TP}x TP)`;
  }

  lsSet(PAPER_BAL_KEY, parseFloat((paperBal - amountSol).toFixed(6)));
  lsSet(PAPER_POSITIONS_KEY, nextPositions);
  lsSet(PAPER_LOG_KEY, log); // unchanged here — logged on close, same as PaperTrader
  markBoughtInWinsPanel(symbol.toLowerCase());

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  }

  return { ok: true, message };
}

export function getPaperBalance(): number {
  return lsGet<number>(PAPER_BAL_KEY, PAPER_STARTING_SOL);
}

export { SYNC_EVENT as PAPER_SYNC_EVENT };
