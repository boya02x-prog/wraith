"use client";

import React from "react";
import Panel from "./Panel";

export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <Panel style={{ background: "#100807", border: "1px solid #3a1712" }}>
      <div style={{ color: "#ffb3a8", fontWeight: 700 }}>{children}</div>
    </Panel>
  );
}

export function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <Panel
      style={{
        background: "transparent",
        border: "1px dashed rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ textAlign: "center", color: "#8b8b8b" }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13 }}>{subtitle}</div>}
      </div>
    </Panel>
  );
}

export default ErrorMessage;
