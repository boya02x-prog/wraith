"use client";

import { disarmLiveExit, type LiveExitRule } from "@/lib/liveExits";

export interface ExitPrefs { tp: string; sl: string; trail: string; tp1?: string; tp1Sell?: string; hold?: string; risk?: string }

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
export default function ExitBox({ mint, symbol, on, setOn, prefs, setPrefs, allowed, armed }: {
  mint: string; symbol: string; on: boolean; setOn: (v: boolean) => void;
  prefs: ExitPrefs; setPrefs: (p: ExitPrefs) => void;
  allowed: boolean; armed: LiveExitRule | null;
}) {
  const field = (key: "tp" | "sl" | "trail" | "tp1" | "tp1Sell" | "hold", label: string, hint: string, unit = "%") => (
    <label style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", color: "var(--text-muted)", fontSize: 9, marginBottom: 4 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", padding: "0 8px", height: 34 }}>
        <input aria-label={hint} inputMode="decimal" value={prefs[key] ?? ""} onChange={(e) => setPrefs({ ...prefs, [key]: e.target.value.replace(/[^0-9.]/g, "") })} style={{ width: "100%", minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--text)", fontSize: 13, ...MONO }} />
        <span style={{ color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", flex: "none", marginLeft: 4 }}>{unit}</span>
      </div>
    </label>
  );
  if (!allowed) {
    return <a href="/#omen" style={{ display: "block", marginTop: 12, padding: "10px 12px", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-muted)", fontSize: 11, textDecoration: "none" }}>🔒 Auto TP / SL / trailing stop unlocks at SHADE (250K OMEN)</a>;
  }
  return (
    <div style={{ marginTop: 12, padding: 12, border: `1px solid ${on ? "var(--orange)" : "var(--border)"}`, borderRadius: 10 }}>
      <button type="button" onClick={() => setOn(!on)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: 0, padding: 0, color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        <span>Auto-exit (TP / SL / trail)</span>
        <span style={{ color: on ? "#37d58a" : "var(--text-muted)", fontSize: 10 }}>{on ? "ON" : "OFF"}</span>
      </button>
      {on && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {field("tp", "TAKE PROFIT +", "Take profit percent")}
            {field("sl", "STOP LOSS −", "Stop loss percent")}
            {field("trail", "TRAIL −", "Trailing stop percent from peak")}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {field("tp1", "SELL PART AT +", "First target percent")}
            {field("tp1Sell", "SELL HOW MUCH", "Share of the position to sell at the first target")}
            {field("hold", "TIME STOP", "Sell everything after this many minutes", "min")}
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: 10, lineHeight: 1.5 }}>Exits are measured from the price you actually paid. Each level needs two price readings in a row before it sells (a single bad tick can not trigger it); a big crash sells at once. With a first target set, Wraith sells that share when it hits, then moves the stop up to break-even and keeps trailing the rest. Leave a box at 0 to turn it off. Works only while Wraith is open.</p>
        </>
      )}
      {armed && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>
          <span>● Armed: {armed.tp1Pct ? `${armed.tp1Done ? "✓ " : ""}Part +${armed.tp1Pct}% (${armed.tp1SellPct ?? 50}%) ` : ""}{armed.tpPct ? `TP +${armed.tpPct}% ` : ""}{armed.slPct ? `SL −${armed.slPct}% ` : ""}{armed.trailPct ? `Trail −${armed.trailPct}% ` : ""}{armed.maxHoldMin ? `Time ${armed.maxHoldMin}m` : ""}{armed.fails ? ` · retrying (${armed.fails})` : ""}</span>
          <button type="button" onClick={() => disarmLiveExit(mint)} style={{ background: "none", border: 0, color: "#e58d80", cursor: "pointer", fontSize: 10 }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
