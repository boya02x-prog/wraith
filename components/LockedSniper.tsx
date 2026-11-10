"use client";

import { Lock } from "lucide-react";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

export default function LockedSniper() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "var(--surface)",
        padding: 24,
        textAlign: "center" as const,
        ...MONO,
      }}
    >
      <span style={{ display: "flex" }}>
        <Lock size={26} color="var(--orange-hot)" />
      </span>
      <div
        style={{
          color: "var(--orange-hot)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.15em",
        }}
      >
        SNIPER LOCKED
      </div>
      <div
        style={{
          color: "var(--text-muted)",
          fontSize: 11,
          lineHeight: 1.7,
          maxWidth: 220,
        }}
      >
        Hold{" "}
        <span style={{ color: "var(--orange-hot)", fontWeight: 700 }}>
          10,000+ WRAITH
        </span>{" "}
        tokens to unlock the sniper.
      </div>
      <a
        href="/access"
        style={{
          marginTop: 4,
          background: "var(--orange)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          padding: "8px 14px",
          borderRadius: 8,
          textDecoration: "none",
          letterSpacing: "0.1em",
        }}
      >
        VIEW TIERS →
      </a>
    </div>
  );
}
