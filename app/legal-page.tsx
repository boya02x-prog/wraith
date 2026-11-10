import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", background: "#0b0b0d", color: "#d8d8dc", padding: "56px 20px 80px" }}>
      <article style={{ maxWidth: 720, margin: "0 auto", fontSize: 15, lineHeight: 1.7 }}>
        <a href="/" style={{ color: "#f26a35", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>Wraith</a>
        <h1 style={{ fontSize: 30, margin: "18px 0 4px", color: "#fff", letterSpacing: "-0.01em" }}>{title}</h1>
        <p style={{ margin: "0 0 28px", color: "#888", fontSize: 13 }}>Last updated {updated}</p>
        {children}
      </article>
    </main>
  );
}

export const H = ({ children }: { children: ReactNode }) => (
  <h2 style={{ fontSize: 18, color: "#fff", margin: "28px 0 8px" }}>{children}</h2>
);
