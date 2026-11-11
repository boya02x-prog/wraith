"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import "../quests.css";

type Bug = { id: string; userId: string; email: string | null; title: string; details: string; page: string; status: string; pts: number; at: string };

export default function QuestAdminPage() {
  const [bugs, setBugs] = useState<Bug[] | null>(null);
  const [status, setStatus] = useState("pending");
  const [pts, setPts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/quests/bugs?status=${status}`, { cache: "no-store" });
    if (r.status === 403) { setError("This page is for the owner only. Sign in with the owner account to review reports."); setBugs([]); return; }
    const j = (await r.json()) as { bugs: Bug[] };
    setBugs(j.bugs);
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: "approved" | "rejected") {
    await fetch("/api/quests/bugs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: decision, pts: Number(pts[id] ?? 250) }) });
    await load();
  }

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="q-shell">
        <section className="q-card">
          <h2>Bug reports</h2>
          <div className="q-row" style={{ margin: "8px 0 12px", flexWrap: "wrap" }}>
            {["pending", "approved", "rejected", "all"].map((s) => (
              <button key={s} className={`q-btn${s === status ? " is-solid" : " is-ghost"}`} onClick={() => setStatus(s)}>{s}</button>
            ))}
            <Link className="q-btn is-ghost" href="/app/admin">Back to admin</Link>
          </div>
          {error && <div className="q-msg is-err">{error}</div>}
          {bugs === null ? <div className="q-note">Loading…</div> : !bugs.length ? <div className="q-note">Nothing here.</div> : bugs.map((b) => (
            <div key={b.id} className="q-card" style={{ marginTop: 10, background: "#0b0b0c" }}>
              <div className="q-li"><b>{b.title}</b><span className={`q-badge is-${b.status}`}>{b.status}</span></div>
              <div className="q-note">{b.email ?? b.userId} · {new Date(b.at).toLocaleString()} {b.page && `· from ${b.page}`}</div>
              <p style={{ whiteSpace: "pre-wrap", fontSize: 13.5, margin: "10px 0" }}>{b.details}</p>
              {b.status === "pending" ? (
                <div className="q-row" style={{ flexWrap: "wrap" }}>
                  <input className="q-input" aria-label="Points to pay" style={{ maxWidth: 140 }} type="number" min={0} max={5000} placeholder="250" value={pts[b.id] ?? ""} onChange={(e) => setPts({ ...pts, [b.id]: e.target.value })} />
                  <button className="q-btn is-solid" onClick={() => decide(b.id, "approved")}>Approve + pay</button>
                  <button className="q-btn is-ghost" onClick={() => decide(b.id, "rejected")}>Reject</button>
                </div>
              ) : b.pts > 0 && <div className="q-pts">Paid +{b.pts}</div>}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
