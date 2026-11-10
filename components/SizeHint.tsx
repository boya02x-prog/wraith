"use client";

// "How much should I put in?" Fixed-fraction risk sizing: pick how much of your balance you accept to lose if the stop is hit,
// and the size follows from the stop distance. The maths is in lib/exitLogic.ts (suggestSize) and is tested.
import { suggestSize } from "@/lib/exitLogic";

const RISKS = [0.5, 1, 2];
const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

export default function SizeHint({ balance, stopPct, risk, setRisk, liquidity, symbol, fmt, onUse }: {
  balance: number | null; stopPct: number; risk: number; setRisk: (r: number) => void;
  liquidity?: number | null; symbol: string; fmt: (usd: number) => string; onUse: (usd: number) => void;
}) {
  if (balance === null || !(balance > 0)) {
    return (
      <div style={{ marginTop: 10, padding: "9px 12px", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.5 }}>
        <span style={{ ...MONO, letterSpacing: ".06em", fontSize: 9 }}>POSITION SIZE</span><br />
        Once you have cash here, Wraith suggests a size from your stop-loss, for example 1% risk with a 30% stop is 3.3% of your balance.
      </div>
    );
  }
  const s = suggestSize({ balance, riskPct: risk, stopPct, liquidity: liquidity ?? undefined });
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 9, letterSpacing: ".06em", ...MONO }}>POSITION SIZE · RISK PER TRADE</span>
        <div style={{ display: "flex", gap: 4 }}>
          {RISKS.map((r) => (
            <button key={r} type="button" onClick={() => setRisk(r)} style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${risk === r ? "var(--orange)" : "var(--border)"}`, background: risk === r ? "rgba(255,123,61,.12)" : "transparent", color: risk === r ? "var(--orange)" : "var(--text-muted)", fontSize: 10, cursor: "pointer", ...MONO }}>{r}%</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{fmt(s.size)} <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>· {s.pctOfBalance.toFixed(1)}% of your balance</span></div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.45 }}>
            {stopPct > 0 ? `If the ${stopPct}% stop on ${symbol} hits, you lose about ${fmt(s.riskAmount)}.` : "Turn on a stop-loss to size by risk."}
          </div>
        </div>
        <button type="button" disabled={s.size <= 0} onClick={() => onUse(s.size)} style={{ flex: "none", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--orange)", background: "rgba(255,123,61,.12)", color: "var(--orange)", fontSize: 11, fontWeight: 700, cursor: "pointer", ...MONO }}>Use</button>
      </div>
      {s.notes.map((n) => <div key={n} style={{ marginTop: 4, fontSize: 9.5, color: "var(--text-dim)", lineHeight: 1.4 }}>{n}</div>)}
    </div>
  );
}
