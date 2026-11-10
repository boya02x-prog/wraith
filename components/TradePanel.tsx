"use client";

import { useState } from "react";
import { C } from "@/lib/theme";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

type TradeMode = "buy" | "sell" | "turbo";

const AMOUNT_PRESETS = [0.5, 1, 5];

export interface TradePanelProps {
  symbol: string;
  walletLabel?: string; // e.g. "W1  3i…8J"
  hasSufficientBalance?: boolean;
  slippagePct?: number;
  priorityFeeSol?: number;
  onSubmit?: (args: { mode: TradeMode; amountSol: number }) => void;
}

/**
 * Right-side trade panel matching Telemetry's Market/Limit/Advanced +
 * Buy/Sell/Turbo layout. Wired to onSubmit — plug in your existing
 * PaperTrader logic (or a real Jupiter swap call later) there. This
 * component only owns amount/mode UI state, not execution.
 */
export function TradePanel({
  symbol,
  walletLabel = "W1",
  hasSufficientBalance = false,
  slippagePct = 15,
  priorityFeeSol = 0.001,
  onSubmit,
}: TradePanelProps) {
  const [mode, setMode] = useState<TradeMode>("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "advanced">(
    "market",
  );
  const [amount, setAmount] = useState<number>(0);
  const [autoStrat, setAutoStrat] = useState(false);

  const modeColor =
    mode === "buy" ? C.green : mode === "sell" ? C.red : C.yellow;

  return (
    <div
      style={{
        width: "100%",
        padding: 14,
        background: "#0a0a0a",
        border: "1px solid #161616",
        borderRadius: 6,
        ...MONO,
      }}
    >
      {/* Order type tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(["market", "limit", "advanced"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            style={{
              flex: 1,
              background: orderType === t ? "#161616" : "transparent",
              border: "none",
              color: orderType === t ? "#eee" : "#555",
              fontSize: 10,
              fontWeight: orderType === t ? 700 : 400,
              padding: "6px 0",
              borderRadius: 4,
              cursor: "pointer",
              textTransform: "capitalize" as const,
              ...MONO,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Buy / Sell / Turbo */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(["buy", "sell", "turbo"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              background:
                mode === m
                  ? m === "buy"
                    ? "#0d1f18"
                    : m === "sell"
                      ? "#1f0d0d"
                      : "#1f1a0d"
                  : "#111",
              border: `1px solid ${mode === m ? (m === "buy" ? C.green : m === "sell" ? C.red : C.yellow) + "55" : "#1e1e1e"}`,
              color:
                mode === m
                  ? m === "buy"
                    ? C.green
                    : m === "sell"
                      ? C.red
                      : C.yellow
                  : "#666",
              fontSize: 11,
              fontWeight: 700,
              padding: "9px 0",
              borderRadius: 4,
              cursor: "pointer",
              textTransform: "capitalize" as const,
              ...MONO,
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Wallet row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#0e0e0e",
          border: "1px solid #1a1a1a",
          borderRadius: 4,
          padding: "8px 10px",
          marginBottom: 10,
          fontSize: 10,
          color: "#888",
        }}
      >
        <span>{walletLabel}</span>
        <span style={{ color: "#444" }}>P1</span>
      </div>

      {/* Amount */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "1px solid #1a1a1a",
          borderRadius: 4,
          padding: "10px 12px",
          marginBottom: 8,
        }}
      >
        <span style={{ color: "#555", fontSize: 10 }}>AMOUNT</span>
        <input
          type="number"
          value={amount || ""}
          placeholder="0"
          onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#eee",
            fontSize: 14,
            fontWeight: 700,
            textAlign: "right" as const,
            width: 100,
            ...MONO,
          }}
        />
      </div>

      {/* Presets */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {AMOUNT_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(p)}
            style={{
              flex: 1,
              background: amount === p ? "#161616" : "#0e0e0e",
              border: `1px solid ${amount === p ? "#333" : "#1a1a1a"}`,
              color: amount === p ? "#eee" : "#666",
              fontSize: 10,
              fontWeight: 700,
              padding: "7px 0",
              borderRadius: 4,
              cursor: "pointer",
              ...MONO,
            }}
          >
            {p}
          </button>
        ))}
        <button
          title="Edit presets"
          style={{
            width: 30,
            background: "#0e0e0e",
            border: "1px solid #1a1a1a",
            color: "#555",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          ✎
        </button>
      </div>

      {/* Slippage / priority fee row */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            background: "#0e0e0e",
            border: "1px solid #1a1a1a",
            borderRadius: 4,
            padding: "6px 0",
            fontSize: 10,
            color: "#888",
          }}
        >
          ≋ {slippagePct}%
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            background: "#0e0e0e",
            border: "1px solid #1a1a1a",
            borderRadius: 4,
            padding: "6px 0",
            fontSize: 10,
            color: "#888",
          }}
        >
          ⛽ {priorityFeeSol}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0e0e0e",
            border: "1px solid #1a1a1a",
            borderRadius: 4,
            padding: "6px 0",
            fontSize: 10,
            color: "#555",
          }}
        >
          OFF
        </div>
      </div>

      {/* Submit */}
      <button
        disabled={!hasSufficientBalance || amount <= 0}
        onClick={() => onSubmit?.({ mode, amountSol: amount })}
        style={{
          width: "100%",
          background:
            hasSufficientBalance && amount > 0 ? modeColor + "22" : "#111",
          border: `1px solid ${hasSufficientBalance && amount > 0 ? modeColor + "55" : "#1e1e1e"}`,
          color: hasSufficientBalance && amount > 0 ? modeColor : "#444",
          fontSize: 12,
          fontWeight: 700,
          padding: "12px 0",
          borderRadius: 4,
          cursor: hasSufficientBalance && amount > 0 ? "pointer" : "default",
          marginBottom: 12,
          ...MONO,
        }}
      >
        {hasSufficientBalance ? mode.toUpperCase() : "INSUFFICIENT"}
      </button>

      {/* Auto Strat */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 2px",
          borderTop: "1px solid #161616",
        }}
      >
        <span style={{ color: "#888", fontSize: 10 }}>Auto Strat</span>
        <button
          onClick={() => setAutoStrat((v) => !v)}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            background: autoStrat ? C.green + "44" : "#1a1a1a",
            border: `1px solid ${autoStrat ? C.green : "#2a2a2a"}`,
            position: "relative" as const,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: autoStrat ? C.green : "#555",
              position: "absolute" as const,
              top: 2,
              left: autoStrat ? 16 : 2,
              transition: "left .15s ease",
            }}
          />
        </button>
      </div>
    </div>
  );
}
