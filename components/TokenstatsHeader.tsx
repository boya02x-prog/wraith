"use client";

import { C } from "@/lib/theme";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

function fmt(n?: number, prefix = "$"): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${prefix}${(n / 1e9).toFixed(2)}b`;
  if (n >= 1e6) return `${prefix}${(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `${prefix}${(n / 1e3).toFixed(1)}k`;
  return `${prefix}${n.toFixed(2)}`;
}

function fmtPrice(n?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  if (n < 0.00001) return `$${n.toFixed(9)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: "#555", fontSize: 9, marginBottom: 3, ...MONO }}>
        {label}
      </div>
      <div
        style={{
          color: valueColor || "#eee",
          fontSize: 13,
          fontWeight: 700,
          ...MONO,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export interface TokenStatsHeaderData {
  symbol: string;
  name?: string;
  imageUrl?: string;
  mcap?: number;
  athMcap?: number;
  price?: number;
  volume24h?: number;
  liquidity?: number;
  bondingCurvePct?: number; // undefined if already migrated (show liquidity instead)
  supply?: number;
  ageLabel?: string;
}

/**
 * Row of key stats sitting under the token avatar/name, matching Telemetry's
 * MCap / ATH MCap / Price / Volume / B.Curve (or Liquidity post-migration) /
 * Supply strip. Pure display component — feed it whatever TokenPanel
 * already computes from getTokenPrice()/ScanResult.
 */
export function TokenStatsHeader({ data }: { data: TokenStatsHeaderData }) {
  const migrated = data.bondingCurvePct === undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 16px",
        background: "#0a0a0a",
        border: "1px solid #161616",
        borderRadius: 6,
        marginBottom: 8,
        flexWrap: "wrap" as const,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        {data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt={data.symbol}
            width={44}
            height={44}
            style={{
              borderRadius: "50%",
              border: "1px solid #2a2a2a",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: `${C.orange}1a`,
              border: `1px solid ${C.orange}44`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.orange,
              fontSize: 18,
              fontWeight: 900,
              ...MONO,
            }}
          >
            {data.symbol.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                color: "#f0f0f0",
                fontSize: 15,
                fontWeight: 700,
                ...MONO,
              }}
            >
              {data.symbol}
            </span>
            {data.name && (
              <span style={{ color: "#666", fontSize: 11, ...MONO }}>
                {data.name}
              </span>
            )}
          </div>
          {data.ageLabel && (
            <div style={{ color: "#555", fontSize: 10, marginTop: 2, ...MONO }}>
              {data.ageLabel}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 24,
          flex: 1,
          flexWrap: "wrap" as const,
          borderLeft: "1px solid #1a1a1a",
          paddingLeft: 20,
          marginLeft: 4,
        }}
      >
        <Stat label="MCAP" value={fmt(data.mcap)} />
        <Stat
          label="ATH MCAP"
          value={fmt(data.athMcap)}
          valueColor={C.yellow}
        />
        <Stat label="PRICE" value={fmtPrice(data.price)} />
        <Stat label="VOLUME" value={fmt(data.volume24h)} />
        {migrated ? (
          <Stat label="LIQUIDITY" value={fmt(data.liquidity)} />
        ) : (
          <Stat
            label="B.CURVE"
            value={
              data.bondingCurvePct !== undefined
                ? `${data.bondingCurvePct.toFixed(1)}%`
                : "—"
            }
            valueColor={C.green}
          />
        )}
        <Stat label="SUPPLY" value={data.supply ? fmt(data.supply, "") : "—"} />
      </div>
    </div>
  );
}
