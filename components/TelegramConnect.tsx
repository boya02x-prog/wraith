// components/TelegramConnect.tsx
// Drop this button wherever you want in the app (Scanner settings, profile, etc.)
// It generates a one-time link and opens the bot with the user's token.

"use client";

import { useState } from "react";

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

export default function TelegramConnect({ linked }: { linked: boolean }) {
  const [loading, setLoading] = useState(false);
  const [isLinked, setIsLinked] = useState(linked);

  async function handleConnect() {
    setLoading(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch (err) {
      console.error("Failed to generate link:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlink() {
    setLoading(true);
    try {
      await fetch("/api/telegram/link", { method: "DELETE" });
      setIsLinked(false);
    } finally {
      setLoading(false);
    }
  }

  if (isLinked) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#00c47a",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: "#00c47a",
              fontWeight: 700,
              letterSpacing: ".1em",
              ...MONO,
            }}
          >
            TELEGRAM CONNECTED
          </span>
        </div>
        <button
          onClick={handleUnlink}
          disabled={loading}
          style={{
            fontSize: 9,
            color: "#333",
            background: "transparent",
            border: "1px solid #1e1e1e",
            padding: "4px 10px",
            borderRadius: 3,
            cursor: "pointer",
            letterSpacing: ".1em",
            ...MONO,
          }}
        >
          UNLINK
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "transparent",
        border: "1px solid #26a5e433",
        color: "#26a5e4",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: ".12em",
        padding: "8px 16px",
        borderRadius: 4,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.5 : 1,
        transition: "all .15s",
        ...MONO,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#26a5e412";
        e.currentTarget.style.borderColor = "#26a5e466";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "#26a5e433";
      }}
    >
      {loading ? "GENERATING LINK..." : "📲 CONNECT TELEGRAM"}
    </button>
  );
}
