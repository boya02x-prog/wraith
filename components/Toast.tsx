"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { C } from "@/lib/theme";

const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };

export type ToastKind = "error" | "warning" | "success" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  timeoutMs: number;
}

interface ToastContextValue {
  push: (
    message: string,
    kind?: ToastKind,
    opts?: { actionLabel?: string; onAction?: () => void; timeoutMs?: number },
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLE: Record<
  ToastKind,
  { icon: string; color: string; bg: string }
> = {
  error: { icon: "⚠", color: "#ff5252", bg: "#1a0000" },
  warning: { icon: "⚠", color: "#ffaa00", bg: "#1a1200" },
  success: { icon: "✓", color: "#00c47a", bg: "#001a0a" },
  info: { icon: "ℹ", color: "#00b4d8", bg: "#001018" },
};

/**
 * Wrap your app (or just the trading-enabled part of the tree) in this once,
 * e.g. in app/app/layout.tsx or page.tsx:
 *
 *   <ToastProvider>
 *     ...rest of the app...
 *   </ToastProvider>
 *
 * Then anywhere: const { push } = useToast(); push("Not enough SOL — lower size or priority fee", "error");
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback<ToastContextValue["push"]>(
    (message, kind = "error", opts) => {
      const id = ++idRef.current;
      const timeoutMs = opts?.timeoutMs ?? 5000;
      setToasts((t) => [
        ...t,
        {
          id,
          kind,
          message,
          actionLabel: opts?.actionLabel,
          onAction: opts?.onAction,
          timeoutMs,
        },
      ]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, timeoutMs);
    },
    [],
  );

  const dismiss = (id: number) =>
    setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        style={{
          position: "fixed",
          left: "50%",
          bottom: "calc(20px + var(--sai-bottom) + var(--wx-tabbar-h, 0px))",
          transform: "translateX(-50%)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => {
          const s = KIND_STYLE[t.kind];
          return (
            <div
              key={t.id}
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: `linear-gradient(90deg, ${s.color}1f, transparent 55%), rgba(20,20,22,.96)`,
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,.09)",
                borderRadius: 14,
                padding: "11px 12px 11px 11px",
                boxShadow: "0 14px 40px -12px rgba(0,0,0,.8)",
                minWidth: 260,
                maxWidth: "min(440px, calc(100vw - 32px))",
                animation: "wraithToastIn 0.2s ease",
              }}
            >
              <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", background: `${s.color}26`, color: s.color, fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                {s.icon}
              </span>
              <span
                style={{
                  color: "#ececec",
                  fontSize: 13,
                  fontWeight: 500,
                  flex: 1,
                  lineHeight: 1.4,
                }}
              >
                {t.message}
              </span>
              {t.actionLabel && t.onAction && (
                <button
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id);
                  }}
                  style={{
                    background: "transparent",
                    border: `1px solid ${s.color}44`,
                    color: s.color,
                    fontSize: 9,
                    ...MONO,
                    padding: "5px 11px",
                    borderRadius: 8,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {t.actionLabel}
                </button>
              )}
              <button
                onClick={() => dismiss(t.id)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#777",
                  fontSize: 18,
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes wraithToastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be used inside <ToastProvider>");
  }
  return ctx;
}
