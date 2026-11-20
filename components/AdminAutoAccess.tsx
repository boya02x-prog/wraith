"use client";
// Admin: who can see the Auto-trader. The owner always can; everyone else only if their sign-in email is added here. Takes effect at once.
import { useEffect, useState } from "react";
import { UserCheck, X } from "lucide-react";

type P = { email: string; addedAt: number };

export default function AdminAutoAccess() {
  const [people, setPeople] = useState<P[] | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let on = true;
    fetch("/api/admin/auto-access", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on && j?.people) setPeople(j.people); }).catch(() => undefined);
    return () => { on = false; };
  }, []);

  const call = async (init: RequestInit, url = "/api/admin/auto-access") => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, { ...init, cache: "no-store" });
      const j = (await r.json()) as { ok?: boolean; message?: string; people?: P[] };
      if (!r.ok || j.ok === false) { setMsg({ ok: false, text: j.message ?? "Could not save." }); return false; }
      if (j.people) setPeople(j.people);
      return true;
    } catch { setMsg({ ok: false, text: "No connection. Nothing was changed." }); return false; }
    finally { setBusy(false); }
  };
  const add = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    if (await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e }) })) { setEmail(""); setMsg({ ok: true, text: `${e} can now see the Auto-trader.` }); }
  };
  const remove = async (e: string) => {
    if (await call({ method: "DELETE" }, `/api/admin/auto-access?email=${encodeURIComponent(e)}`)) setMsg({ ok: true, text: `${e} can no longer see it.` });
  };

  return (
    <section className="q-card ad-card" id="lab-access">
      <h2><UserCheck size={16} /> Who can see the Auto-trader</h2>
      <p className="q-note">Only the people you add here (by the email they sign in with) get an <b>Auto-trader</b> entry in their menu and the page behind it. You always see it. Nobody is on the list until you add them, and removing someone takes effect immediately.</p>
      <div className="ad-inline">
        <input className="ad-search" type="email" inputMode="email" autoComplete="off" value={email} placeholder="name@gmail.com" aria-label="Email to add" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
        <button type="button" className="q-btn is-solid" onClick={() => void add()} disabled={busy || !email.trim()}>Add</button>
      </div>
      {msg && <p className={`q-note${msg.ok ? "" : " ad-err"}`}>{msg.text}</p>}
      {people === null ? <div className="wsk-b" style={{ height: 60, borderRadius: 12 }} /> : people.length === 0 ? <p className="q-note">No one yet: only you can see it.</p> : (
        <div className="ad-users">
          {people.map((p) => (
            <div key={p.email} className="ad-user" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <div className="ad-user-who"><b>{p.email}</b><small>added {new Date(p.addedAt).toLocaleDateString()}</small></div>
              <button type="button" className="q-btn is-ghost" onClick={() => void remove(p.email)} disabled={busy} aria-label={`Remove ${p.email}`}><X size={14} /> Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
