"use client";

import { Component, type ReactNode } from "react";

// Wraps a bottom sheet's content. If the content throws, the sheet shows what went wrong and a retry button instead of an
// empty panel (the Buy/Sell sheet used to open blank with no clue why).
type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; attempt: number };

export default class SheetBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[sheet]", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "18px 16px 26px", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ display: "block", color: "var(--text)", fontSize: 15, marginBottom: 6 }}>{this.props.label ?? "This panel"} could not load</strong>
          <span style={{ display: "block", wordBreak: "break-word", opacity: 0.8 }}>{this.state.error.message || "Unknown error"}</span>
          <button
            type="button"
            onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
            style={{ marginTop: 14, height: 40, padding: "0 18px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return <div key={this.state.attempt} className="wx-sheet-body">{this.props.children}</div>;
  }
}
