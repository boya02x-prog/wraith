"use client";
// Launch control: every OMEN-related switch, the launch dates and the landing roadmap, saved to the database.
// Changes reach every visitor within about a minute, no redeploy.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import { refreshLaunchSettings } from "@/hooks/useLaunchSettings";
import { LAUNCH_ITEMS, MINT_RE, resolveSettings, type LaunchSettings, type RoadmapItem } from "@/lib/launchSettings";
import "../quests/quests.css";

type Stats = { users: number; telegram: number; questers: number; pendingBugs: number } | null;
type Resp = { isAdmin: boolean; stored: LaunchSettings; live: LaunchSettings; stats: Stats };
type BoolKey = "featuresFree" | "tiersLive" | "autoLaunch" | "vipRoomOpen" | "questsOpen" | "claimOpen";

const SWITCHES: { key: BoolKey; title: string; on: string; off: string }[] = [
  { key: "featuresFree", title: "Beta: unlock every tool for everyone", on: "Signals, sniper, auto TP/SL, hot wallet, AI score and Telegram DM alerts work for every signed-in user. Fees stay 1.5%.", off: "Tools follow OMEN tiers (needs tiers live, otherwise everyone is GHOST)." },
  { key: "tiersLive", title: "OMEN tiers live", on: "Wallet OMEN balance sets the tier, fee discount and gas boost.", off: "Nobody gets a tier from holdings. Turn on at launch, after the mint is set." },
  { key: "autoLaunch", title: "Auto-launch at the OMEN date", on: "At the launch time: tiers go live, beta turns off, holders room opens, roadmap card flips to LIVE.", off: "Nothing happens by itself. You flip switches by hand." },
  { key: "vipRoomOpen", title: "Holders-only Telegram room", on: "Real SPECTER+ holders are approved into the private room; others are removed hourly.", off: "Join requests are declined with an 'opens at launch' message." },
  { key: "questsOpen", title: "Quests earn points", on: "Tasks, trades, invites and X posts earn points.", off: "Quests are paused. Nothing new is awarded." },
  { key: "claimOpen", title: "Airdrop points final / claim open", on: "Quests page shows final OMEN amounts and the claim section.", off: "Shows 'Est. OMEN today' and 'Claim after launch'." },
];

const toLocal = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : "");
const toDay = (iso: string) => (iso ? toLocal(iso).slice(0, 10) : "");
const fromDay = (v: string) => (v ? new Date(`${v}T12:00`).toISOString() : "");

function countdown(iso: string, now: number) {
  if (!iso) return "not set";
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "passed";
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return `in ${d}d ${h}h ${m}m`;
}

export default function LaunchControlPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState<LaunchSettings | null>(null);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/settings", { cache: "no-store" });
    if (r.status === 403 || r.status === 401) { setDenied(true); return; }
    const j = (await r.json()) as Resp;
    setData(j);
    setForm(j.stored);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const dirty = useMemo(() => !!form && !!data && JSON.stringify(form) !== JSON.stringify(data.stored), [form, data]);
  const preview = form ? resolveSettings(form, now) : null;

  async function save(next: LaunchSettings) {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const j = (await r.json()) as { ok: boolean; message?: string; warn?: string | null; stored: LaunchSettings; live: LaunchSettings };
      if (!j.ok) { setMsg({ ok: false, text: j.message ?? "Save failed." }); return; }
      setData((d) => (d ? { ...d, stored: j.stored, live: j.live } : d));
      setForm(j.stored);
      refreshLaunchSettings(j.live);
      setMsg({ ok: true, text: j.warn ?? "Saved. Live for everyone within about a minute." });
    } catch { setMsg({ ok: false, text: "Network error. Try again." }); }
    finally { setSaving(false); setArmed(false); }
  }

  const set = <K extends keyof LaunchSettings>(k: K, v: LaunchSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const setItem = (i: number, patch: Partial<RoadmapItem>) => setForm((f) => (f ? { ...f, roadmap: f.roadmap.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : f));

  function launchNow() {
    if (!form) return;
    if (!MINT_RE.test(form.omenMint)) { setMsg({ ok: false, text: "Paste the OMEN mint address first." }); return; }
    if (!armed) { setArmed(true); return; }
    void save({
      ...form,
      tiersLive: true,
      featuresFree: false,
      vipRoomOpen: true,
      omenLaunchAt: form.omenLaunchAt || new Date().toISOString(),
      roadmap: form.roadmap.map((r) => (r.id === "omen" ? { ...r, status: "live", date: r.date || new Date().toISOString() } : r)),
    });
  }

  if (denied) {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <div className="q-shell"><section className="q-card"><h2>Admins only</h2><p className="q-note">Sign in with the admin account (QUESTS_ADMIN_EMAILS, or yuriesb01@gmail.com when that is not set).</p></section></div>
      </main>
    );
  }
  if (!form || !data || !preview) {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <div className="q-shell"><div className="q-hero"><span className="q-eyebrow">ADMIN</span><h1>LOADING…</h1></div></div>
      </main>
    );
  }

  const mintOk = MINT_RE.test(form.omenMint);
  const st = data.stats;

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="q-shell">
        <div className="q-hero">
          <span className="q-eyebrow">ADMIN · LAUNCH CONTROL</span>
          <h1>{preview.tiersLive ? "OMEN IS LIVE" : preview.featuresFree ? "BETA: ALL TOOLS FREE" : "PRE-LAUNCH"}</h1>
          <p>Flip a switch and press Save. Every visitor gets it within about a minute. No redeploy.</p>
          {st && (
            <div className="q-stats">
              <div className="q-stat"><span>Accounts</span><strong>{st.users.toLocaleString()}</strong></div>
              <div className="q-stat"><span>Telegram linked</span><strong>{st.telegram.toLocaleString()}</strong></div>
              <div className="q-stat"><span>Questers</span><strong>{st.questers.toLocaleString()}</strong></div>
              <div className="q-stat"><span>Bugs to review</span><strong>{st.pendingBugs}</strong></div>
            </div>
          )}
          <div className="q-row" style={{ marginTop: 12 }}>
            <Link className="q-btn is-ghost" href="/app/quests/admin">Review bug reports</Link>
            <Link className="q-btn is-ghost" href="/app/quests">Quests page</Link>
            <Link className="q-btn is-ghost" href="/">Landing page</Link>
          </div>
        </div>

        <section className="q-card">
          <h2>OMEN token</h2>
          <label className="q-note" htmlFor="mint">Mint address (Solana)</label>
          <input id="mint" className="q-input" placeholder="Paste the OMEN mint after it's created on pump.fun" value={form.omenMint} onChange={(e) => set("omenMint", e.target.value.trim())} spellCheck={false} />
          {form.omenMint && !mintOk && <p className="q-msg" style={{ color: "#ff6b6b" }}>That doesn&apos;t look like a Solana mint address.</p>}
          <div className="q-row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <label className="q-note" htmlFor="omenAt">OMEN launch date &amp; time</label>
              <input id="omenAt" type="datetime-local" className="q-input" value={toLocal(form.omenLaunchAt)} onChange={(e) => set("omenLaunchAt", fromLocal(e.target.value))} />
            </div>
            <span className="q-note">{countdown(form.omenLaunchAt, now)}</span>
          </div>
          <div className="q-row" style={{ marginTop: 14 }}>
            <button className="q-btn is-solid" onClick={launchNow} disabled={saving || preview.tiersLive}>
              {preview.tiersLive ? "Launched" : armed ? "Tap again to launch OMEN now" : "Launch OMEN now"}
            </button>
            <span className="q-note">Sets tiers live, turns the beta off, opens the holders room and marks the roadmap card LIVE.</span>
          </div>
        </section>

        <section className="q-card">
          <h2>Switches</h2>
          <div className="q-list">
            {SWITCHES.map((sw) => {
              const on = form[sw.key];
              const scheduled = sw.key !== "autoLaunch" && preview[sw.key] !== on;
              return (
                <div key={sw.key} className="q-task" style={{ alignItems: "flex-start" }}>
                  <div className="q-task-body">
                    <strong>{sw.title}</strong>
                    <span className="q-note">{on ? sw.on : sw.off}</span>
                    {scheduled && <span className="q-note" style={{ color: "var(--accent-text)" }}>Auto-launch has already switched this {preview[sw.key] ? "ON" : "OFF"}.</span>}
                    {sw.key === "tiersLive" && on && !mintOk && <span className="q-note" style={{ color: "#ff6b6b" }}>Needs the mint address above.</span>}
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    className={`q-btn ${on ? "is-solid" : "is-ghost"}`}
                    style={{ minWidth: 74 }}
                    onClick={() => set(sw.key, !on)}
                  >
                    {on ? "ON" : "OFF"}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: 4, marginTop: 12 }}>
            <label className="q-note" htmlFor="claimAt">Airdrop claim date</label>
            <input id="claimAt" type="datetime-local" className="q-input" value={toLocal(form.claimAt)} onChange={(e) => set("claimAt", fromLocal(e.target.value))} />
          </div>
          <div style={{ display: "grid", gap: 4, marginTop: 12 }}>
            <label className="q-note" htmlFor="banner">Landing page banner (empty = hidden)</label>
            <input id="banner" className="q-input" maxLength={160} placeholder="e.g. Beta is open: every tool is free. Join the channel →" value={form.banner} onChange={(e) => set("banner", e.target.value)} />
          </div>
        </section>

        <section className="q-card">
          <h2>Roadmap on the landing page</h2>
          <div className="q-list">
            {form.roadmap.map((r, i) => (
              <div key={r.id + i} className="q-card" style={{ padding: 12, display: "grid", gap: 8 }}>
                <input className="q-input" value={r.title} maxLength={60} onChange={(e) => setItem(i, { title: e.target.value })} />
                <textarea className="q-textarea" rows={2} value={r.body} maxLength={220} onChange={(e) => setItem(i, { body: e.target.value })} />
                <div className="q-row">
                  <button className={`q-btn ${r.status === "live" ? "is-solid" : "is-ghost"}`} onClick={() => setItem(i, { status: r.status === "live" ? "soon" : "live" })}>{r.status === "live" ? "LIVE" : "SOON"}</button>
                  <input type="date" className="q-input" style={{ maxWidth: 180 }} value={toDay(r.date)} onChange={(e) => setItem(i, { date: fromDay(e.target.value) })} />
                  <button className="q-btn is-ghost" disabled={i === 0} onClick={() => setForm((f) => { if (!f) return f; const a = [...f.roadmap]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return { ...f, roadmap: a }; })}>↑</button>
                  <button className="q-btn is-ghost" onClick={() => setForm((f) => (f ? { ...f, roadmap: f.roadmap.filter((_, j) => j !== i) } : f))}>Remove</button>
                </div>
              </div>
            ))}
          </div>
          {form.roadmap.length < 12 && (
            <button className="q-btn is-ghost" style={{ marginTop: 10 }} onClick={() => set("roadmap", [...form.roadmap, { id: `item${Date.now().toString(36)}`, title: "New item", body: "", status: "soon", date: "" }])}>+ Add item</button>
          )}
        </section>

        <section className="q-card">
          <h2>Everything OMEN touches</h2>
          <div className="q-list">
            {LAUNCH_ITEMS.map((it) => {
              const nowText =
                it.id === "scanner" ? it.before
                : it.id === "fees" || it.id === "gas" ? (preview.tiersLive ? it.after : it.before)
                : it.id === "vip" ? (preview.vipRoomOpen ? it.after : it.before)
                : it.id === "quests" ? (preview.questsOpen ? (preview.claimOpen ? "Earning (claim is open)" : "Earning") : "Paused")
                : it.id === "claim" ? (preview.claimOpen ? "Open" : "Closed")
                : preview.featuresFree ? "Free for everyone (beta)" : preview.tiersLive ? it.after : "Locked (no tiers yet)";
              return (
                <div key={it.id} className="q-li" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                  <div><strong>{it.label}</strong><div className="q-note">After launch: {it.after}</div></div>
                  <span className="q-badge">{nowText}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div style={{ position: "sticky", bottom: 12, zIndex: 20 }}>
          <section className="q-card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", boxShadow: "0 10px 40px rgba(0,0,0,.5)" }}>
            <button className="q-btn is-solid" disabled={!dirty || saving} onClick={() => form && save(form)}>{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
            {dirty && <button className="q-btn is-ghost" onClick={() => setForm(data.stored)}>Undo</button>}
            {msg && <span className="q-msg" style={{ color: msg.ok ? "var(--accent-text)" : "#ff6b6b" }}>{msg.text}</span>}
            {data.stored.updatedAt && !msg && <span className="q-note">Last saved {new Date(data.stored.updatedAt).toLocaleString()} by {data.stored.updatedBy}</span>}
          </section>
        </div>
      </div>
    </main>
  );
}
