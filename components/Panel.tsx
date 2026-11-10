"use client";

import React from "react";

export default function Panel({
  children,
  className,
  style,
  hoverable,
  header,
  footer,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  hoverable?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-md ${className || ""}`}
      style={{
        background: "#0a0a0a",
        border: "1px solid #1a1a1a",
        ...(hoverable
          ? { transition: "all 0.15s ease", willChange: "transform" }
          : {}),
        ...style,
      }}
    >
      <div style={{ padding: 16 }}>
        {header && (
          <div
            style={{
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {header}
          </div>
        )}
        <div>{children}</div>
        {footer && <div style={{ marginTop: 12 }}>{footer}</div>}
      </div>
    </div>
  );
}
