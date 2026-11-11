"use client";
// Admin: the one place the owner runs the launch from. Token address, launch date, every on/off switch, the airdrop,
// the landing-page banner and roadmap. Saved to the database; every visitor gets a change within about a minute, no redeploy.
// Only the owner's account can load or save anything here: the server checks it on every request (see /api/admin/settings).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Bug, Check, ExternalLink, Gift, Megaphone, Rocket, ShieldCheck, ToggleRight, Trash2, TriangleAlert } from "lucide-react";
import Header from "@/components/HeaderSlot";
import DateTimeField from "@/components/DateTimeField";
import { refreshLaunchSettings } from "@/hooks/useLaunchSettings";
import { LAUNCH_ITEMS, MINT_RE, resolveSettings, type LaunchSettings, type RoadmapItem } from "@/lib/launchSettings";
import "../quests/quests.css";
import "./admin.css";

type Stats = { users: number; telegram: number; questers: number; pendingBugs: number } | null;
type Resp = { isAdmin: boolean; stored: LaunchSettings; live: LaunchSettings; stats: Stats };
type BoolKey = "featuresFree" | "tiersLive" | "autoLaunch" | "vipRoomOpen" | "questsOpen" | "claimOpen";
type Sw = { key: BoolKey; title: string; on: string; off: string };

const TOOL_SWITCHES: Sw[] = [
  { key: "featuresFree", title: "Free beta: every tool for everyone", on: "ON: every signed-in user gets signals, sniper, auto take-profit / stop-loss, hot wallet, AI score and Telegram alerts. The fee stays 1.5%.", off: "OFF: tools are locked behind OMEN tiers. If tiers are also off, nobody has the paid tools." },
  { key: "tiersLive", title: "OMEN tiers", on: "ON: how much OMEN a wallet holds decides its tier, fee discount and free-gas boost.", off: "OFF: holding OMEN does nothing yet. Turn this on at launch, after the token address is set." },
  { key: "vipRoomOpen", title: "Holders-only Telegram room", on: "ON: real holders are let into the private room, and anyone who sells is removed every hour.", off: "OFF: join requests get an \"opens at launch\" reply." },
];
const AIRDROP_SWITCHES: Sw[] = [
  { key: "questsOpen", title: "Quests give points", on: "ON: tasks, trades, invites and X posts earn points.", off: "OFF: quests are paused. Nobody earns anything new; old points stay." },
  { key: "claimOpen", title: "Points are final, claim is open", on: "ON: the quests page shows each person's final OMEN amount and the claim section.", off: "OFF: the quests page shows an estimate and \"Claim after launch\"." },
];

function countdown(iso: string, now: number) {
  if (!iso) return "No date set";
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "This time has passed";
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return `In ${d ? `${d}d ` : ""}${h}h ${m}m`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="q-shell ad-shell">{children}</div>
    </main>
  );
}

function Toggle({ sw, on, onFlip, note }: { sw: Sw; on: boolean; onFlip: () => void; note?: React.ReactNode }) {
  return (
    <div className={`ad-sw${on ? " is-on" : ""}`}>
      <div className="ad-sw-text">
        <strong>{sw.title}</strong>
        <span>{on ? sw.on : sw.off}</span>
        {note}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={sw.title} className="ad-toggle" onClick={onFlip}><i /><b>{on ? "ON" : "OFF"}</b></button>
    </div>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [form, setForm] = useState<LaunchSettings | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await fetch("/api/admin/settings", { cache: "no-store" });
      if (r.status === 403 || r.status === 401) { setDenied(true); return; }
      if (!r.ok) { setFailed(true); return; }
      const j = (await r.json()) as Resp;
      setData(j);
      setForm(j.stored);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 6000); return () => clearTimeout(t); }, [armed]);

  const dirty = useMemo(() => !!form && !!data && JSON.stringify(form) !== JSON.stringify(data.stored), [form, data]);
  // leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const preview = form ? resolveSettings(form, now) : null;

  async function save(next: LaunchSettings) {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const j = (await r.json()) as { ok: boolean; message?: string; warn?: string | null; stored: LaunchSettings; live: LaunchSettings };
      if (!j.ok) { setMsg({ ok: false, text: j.message ?? "Could not save." }); return; }
      setData((d) => (d ? { ...d, stored: j.stored, live: j.live } : d));
      setForm(j.stored);
      refreshLaunchSettings(j.live);
      setMsg({ ok: !j.warn, text: j.warn ?? "Saved. Everyone sees it within about a minute." });
    } catch { setMsg({ ok: false, text: "No connection. Nothing was saved, try again." }); }
    finally { setSaving(false); setArmed(false); }
  }

  const set = <K extends keyof LaunchSettings>(k: K, v: LaunchSettings[K]) => { setMsg(null); setForm((f) => (f ? { ...f, [k]: v } : f)); };
  const setItem = (i: number, patch: Partial<RoadmapItem>) => setForm((f) => (f ? { ...f, roadmap: f.roadmap.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : f));
  const move = (i: number, by: number) => setForm((f) => {
    if (!f) return f;
    const a = [...f.roadmap]; const j = i + by;
    if (j < 0 || j >= a.length) return f;
    [a[i], a[j]] = [a[j], a[i]];
    return { ...f, roadmap: a };
  });

  function launchNow() {
    if (!form) return;
    if (!MINT_RE.test(form.omenMint)) { setMsg({ ok: false, text: "Paste the OMEN token address first (step 1)." }); return; }
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
      <Shell>
        <section className="q-card ad-denied">
          <ShieldCheck size={28} />
          <h2>This page is for the owner only</h2>
          <p className="q-note">You are signed in with an account that is not the owner&apos;s. Log out and sign in with the owner account to open it.</p>
          <Link className="q-btn is-ghost" href="/app">Back to the app</Link>
        </section>
      </Shell>
    );
  }
  if (failed) {
    return (
      <Shell>
        <section className="q-card ad-denied">
          <TriangleAlert size={28} />
          <h2>Could not load the admin page</h2>
          <p className="q-note">The server did not answer. Nothing was changed.</p>
          <button className="q-btn is-solid" onClick={() => void load()}>Try again</button>
        </section>
      </Shell>
    );
  }
  if (!form || !data || !preview) {
    return (
      <Shell>
        <div className="wsk-b" style={{ height: 210, borderRadius: 18 }} aria-busy="true" aria-label="Loading admin" />
        <div className="wsk-b" style={{ height: 44, borderRadius: 12 }} />
        <div className="wsk-b" style={{ height: 300, borderRadius: 16 }} />
        <div className="wsk-b" style={{ height: 260, borderRadius: 16 }} />
      </Shell>
    );
  }

  const mintOk = MINT_RE.test(form.omenMint);
  const st = data.stats;
  const mode = preview.tiersLive ? "OMEN IS LIVE" : preview.featuresFree ? "FREE BETA" : "BEFORE LAUNCH";
  const modeLine = preview.tiersLive
    ? "OMEN is launched. Tiers, fee discounts and the holders room follow what each wallet holds."
    : preview.featuresFree
      ? "OMEN is not launched yet. Every signed-in user has every tool for free."
      : "OMEN is not launched yet and the free beta is off, so the paid tools are locked for everyone.";
  const steps = [
    { done: mintOk, text: "Token address pasted" },
    { done: !!form.omenLaunchAt, text: "Launch date picked" },
    { done: preview.tiersLive, text: "Launched" },
  ];
  const scheduledNote = (k: BoolKey) => (preview[k] !== form[k]
    ? <em className="ad-warn">The automatic launch already turned this {preview[k] ? "ON" : "OFF"}.</em>
    : null);

  return (
    <Shell>
      <section className="q-hero ad-hero">
        <span className="q-eyebrow">ADMIN · ONLY YOU CAN SEE THIS</span>
        <h1>{mode}</h1>
        <p>{modeLine}</p>
        {st && (
          <div className="q-stats">
            <div className="q-stat"><span>Accounts</span><strong>{st.users.toLocaleString()}</strong></div>
            <div className="q-stat"><span>Telegram linked</span><strong>{st.telegram.toLocaleString()}</strong></div>
            <div className="q-stat"><span>Earning points</span><strong>{st.questers.toLocaleString()}</strong></div>
            <Link className={`q-stat ad-stat-link${st.pendingBugs ? " is-hot" : ""}`} href="/app/quests/admin"><span>Bug reports waiting</span><strong>{st.pendingBugs}</strong></Link>
          </div>
        )}
      </section>

      <nav className="ad-nav" aria-label="Admin sections">
        <a href="#launch"><Rocket size={14} /> Launch</a>
        <a href="#tools"><ToggleRight size={14} /> Tools</a>
        <a href="#airdrop"><Gift size={14} /> Airdrop</a>
        <a href="#site"><Megaphone size={14} /> Landing page</a>
        <Link href="/app/quests/admin"><Bug size={14} /> Bug reports{st?.pendingBugs ? <b>{st.pendingBugs}</b> : null}</Link>
        <Link href="/app/quests"><ExternalLink size={14} /> Quests page</Link>
      </nav>

      <section className="q-card ad-card" id="launch">
        <h2><Rocket size={16} /> Launch OMEN</h2>
        <div className="q-sub">Three steps. Nothing goes live until you press Save or Launch.</div>
        <div className="ad-steps">
          {steps.map((s, i) => <span key={i} className={s.done ? "is-done" : ""}><i>{s.done ? <Check size={12} /> : i + 1}</i>{s.text}</span>)}
        </div>

        <div className="ad-field">
          <label htmlFor="mint"><b>1.</b> OMEN token address (Solana)</label>
          <input id="mint" className="q-input ad-mono" placeholder="Paste the address after you create the token" value={form.omenMint} onChange={(e) => set("omenMint", e.target.value.trim())} spellCheck={false} autoComplete="off" />
          {form.omenMint && !mintOk
            ? <small className="ad-err">That is not a Solana token address. Check for a missing or extra character.</small>
            : <small>Any launchpad works. Create the token there, then copy its address here. Tiers read this address to see who holds OMEN.</small>}
        </div>

        <div className="ad-field">
          <label htmlFor="omenAt"><b>2.</b> Launch date and time <em>(your local time)</em></label>
          <div className="ad-inline">
            <DateTimeField id="omenAt" value={form.omenLaunchAt} onChange={(v) => set("omenLaunchAt", v)} placeholder="Pick the launch date" />
            <span className="ad-count">{countdown(form.omenLaunchAt, now)}</span>
          </div>
          <small>Shown as the countdown on the landing page.</small>
        </div>

        <div className="ad-field">
          <label><b>3.</b> Go live</label>
          <Toggle
            sw={{ key: "autoLaunch", title: "Launch by itself at that date", on: "ON: at the launch time the app switches over on its own. Needs steps 1 and 2.", off: "OFF: nothing happens by itself. You press the button below when you are ready." }}
            on={form.autoLaunch}
            onFlip={() => set("autoLaunch", !form.autoLaunch)}
            note={form.autoLaunch && (!mintOk || !form.omenLaunchAt) ? <em className="ad-err">It cannot fire yet: {!mintOk ? "the token address" : "the launch date"} is missing.</em> : null}
          />
          <div className="ad-launch">
            <button className={`q-btn is-solid ad-launch-btn${armed ? " is-armed" : ""}`} onClick={launchNow} disabled={saving || preview.tiersLive}>
              <Rocket size={15} /> {preview.tiersLive ? "Already launched" : armed ? "Tap again to confirm" : "Launch OMEN now"}
            </button>
            <span className="q-note">Does four things at once: turns tiers on, ends the free beta, opens the holders room and marks OMEN as LIVE on the roadmap.</span>
          </div>
        </div>
      </section>

      <section className="q-card ad-card" id="tools">
        <h2><ToggleRight size={16} /> Tools and tiers</h2>
        <div className="q-sub">Who gets the paid tools right now.</div>
        {TOOL_SWITCHES.map((sw) => (
          <Toggle key={sw.key} sw={sw} on={form[sw.key]} onFlip={() => set(sw.key, !form[sw.key])}
            note={<>{scheduledNote(sw.key)}{sw.key === "tiersLive" && form.tiersLive && !mintOk ? <em className="ad-err">Needs the token address from step 1, otherwise nobody gets a tier.</em> : null}</>} />
        ))}
        <details className="ad-details">
          <summary>See what each feature is doing right now</summary>
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
                <div key={it.id} className="ad-item">
                  <div><strong>{it.label}</strong><span className="q-note">After launch: {it.after}</span></div>
                  <span className="q-badge">{nowText}</span>
                </div>
              );
            })}
          </div>
        </details>
      </section>

      <section className="q-card ad-card" id="airdrop">
        <h2><Gift size={16} /> Quests and airdrop</h2>
        <div className="q-sub">Points turn into OMEN at the claim. These switches only change what people see and earn; no tokens move from here.</div>
        {AIRDROP_SWITCHES.map((sw) => <Toggle key={sw.key} sw={sw} on={form[sw.key]} onFlip={() => set(sw.key, !form[sw.key])} note={scheduledNote(sw.key)} />)}
        <div className="ad-field">
          <label htmlFor="claimAt">Claim opens on <em>(shown on the quests page)</em></label>
          <div className="ad-inline">
            <DateTimeField id="claimAt" value={form.claimAt} onChange={(v) => set("claimAt", v)} placeholder="Pick the claim date" />
            <span className="ad-count">{countdown(form.claimAt, now)}</span>
          </div>
        </div>
      </section>

      <section className="q-card ad-card" id="site">
        <h2><Megaphone size={16} /> Landing page</h2>
        <div className="ad-field">
          <label htmlFor="banner">Announcement bar <em>(leave empty to hide it)</em></label>
          <input id="banner" className="q-input" maxLength={160} placeholder="e.g. Beta is open: every tool is free." value={form.banner} onChange={(e) => set("banner", e.target.value)} />
          <small>{form.banner.length}/160</small>
        </div>
        <div className="ad-field">
          <label>Roadmap cards</label>
          <div className="ad-road">
            {form.roadmap.map((r, i) => (
              <div key={r.id + i} className="ad-road-item">
                <div className="ad-road-top">
                  <input className="q-input" aria-label="Card title" value={r.title} maxLength={60} onChange={(e) => setItem(i, { title: e.target.value })} />
                  <button type="button" className={`ad-pill${r.status === "live" ? " is-live" : ""}`} onClick={() => setItem(i, { status: r.status === "live" ? "soon" : "live" })} title="Tap to switch between SOON and LIVE">{r.status === "live" ? "LIVE" : "SOON"}</button>
                </div>
                <textarea className="q-textarea" aria-label="Card text" rows={2} value={r.body} maxLength={220} onChange={(e) => setItem(i, { body: e.target.value })} />
                <div className="ad-road-foot">
                  <DateTimeField value={r.date} withTime={false} onChange={(v) => setItem(i, { date: v })} placeholder="No date" />
                  <span className="ad-road-btns">
                    <button type="button" className="ad-ico" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={15} /></button>
                    <button type="button" className="ad-ico" disabled={i === form.roadmap.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={15} /></button>
                    <button type="button" className="ad-ico is-danger" onClick={() => setForm((f) => (f ? { ...f, roadmap: f.roadmap.filter((_, j) => j !== i) } : f))} aria-label="Remove card"><Trash2 size={15} /></button>
                  </span>
                </div>
              </div>
            ))}
          </div>
          {form.roadmap.length < 12 && (
            <button className="q-btn is-ghost" style={{ justifySelf: "start" }} onClick={() => set("roadmap", [...form.roadmap, { id: `item${Date.now().toString(36)}`, title: "New card", body: "", status: "soon", date: "" }])}>+ Add a card</button>
          )}
        </div>
      </section>

      <div className={`ad-save${dirty ? " is-dirty" : ""}`}>
        <div className="ad-save-text">
          {msg
            ? <span className={msg.ok ? "is-ok" : "is-err"}>{msg.text}</span>
            : dirty
              ? <span className="is-warn">You have changes that are not saved yet.</span>
              : <span>{data.stored.updatedAt ? `Everything is saved. Last change ${new Date(data.stored.updatedAt).toLocaleString()}.` : "Everything is saved."}</span>}
        </div>
        {dirty && <button className="q-btn is-ghost" disabled={saving} onClick={() => { setForm(data.stored); setMsg(null); }}>Undo</button>}
        <button className="q-btn is-solid" disabled={!dirty || saving} onClick={() => form && save(form)}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </Shell>
  );
}
