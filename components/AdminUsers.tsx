"use client";
// Admin: every account, who is online right now, and recent activity. Refreshes itself every 30 seconds.
import { useEffect, useState } from "react";
import { Users } from "lucide-react";

type U = { id: string; name: string | null; email: string | null; tier: string | null; createdAt: number | null; lastSeenAt: number | null; telegram: boolean; wallet: string | null };
type R = { counts: { total: number; online: number; hour: number; day: number; newDay: number }; users: U[] };
const ago = (t: number | null) => { if (!t) return "never"; const s = (Date.now() - t) / 1000; return s < 120 ? "online" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

export default function AdminUsers() {
  const [d, setD] = useState<R | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    let on = true;
    const load = () => fetch("/api/admin/users", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on) { setD(j); setErr(!j); } }).catch(() => { if (on) setErr(true); });
    void load();
    const t = window.setInterval(load, 30_000);
    return () => { on = false; window.clearInterval(t); };
  }, []);
  const list = (d?.users ?? []).filter((u) => !q.trim() || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="q-card ad-card" id="users">
      <h2><Users size={16} /> Users</h2>
      {err && !d ? <p className="q-note">Could not load users right now.</p> : !d ? <div className="wsk-b" style={{ height: 120, borderRadius: 12 }} /> : (
        <>
          <div className="q-stats">
            <div className="q-stat"><span>Online now</span><strong className="ad-online">{d.counts.online}</strong></div>
            <div className="q-stat"><span>Active last hour</span><strong>{d.counts.hour}</strong></div>
            <div className="q-stat"><span>Active last 24h</span><strong>{d.counts.day}</strong></div>
            <div className="q-stat"><span>All accounts</span><strong>{d.counts.total}</strong></div>
            <div className="q-stat"><span>New last 24h</span><strong>{d.counts.newDay}</strong></div>
          </div>
          <input className="ad-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search users" />
          <div className="ad-users">
            {list.map((u) => (
              <div key={u.id} className="ad-user">
                <i className={`ad-dot${ago(u.lastSeenAt) === "online" ? " on" : ""}`} />
                <div className="ad-user-who"><b>{u.name || u.email || "No name"}</b><small>{u.name && u.email ? u.email : u.wallet ? `${u.wallet.slice(0, 4)}…${u.wallet.slice(-4)}` : ""}</small></div>
                <span className="ad-user-tier">{u.tier ?? "GHOST"}{u.telegram ? " · TG" : ""}</span>
                <span className="ad-user-seen">{ago(u.lastSeenAt)}<small>joined {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "?"}</small></span>
              </div>
            ))}
            {list.length === 0 && <p className="q-note">No accounts match.</p>}
          </div>
          <small className="q-note">&ldquo;Online&rdquo; means the app was open and visible in the last 2 minutes. It starts counting from this update, so everyone shows &ldquo;never&rdquo; until they next open the app.</small>
        </>
      )}
    </section>
  );
}
