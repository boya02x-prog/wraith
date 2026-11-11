"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bug, Check, Copy, Gift, Send, Trophy, Users, ShieldCheck } from "lucide-react";
import Header from "@/components/HeaderSlot";
import { swrRead, swrWrite } from "@/lib/swrCache";
import "./quests.css";

type Task = { id: string; title: string; points: number; verify: "auto"; doneAt: number | null };
type Row = { userId: string; points: number; name: string; username: string | null; avatar: string };
type Activity = { kind: string; pts: number; at: string; meta: Record<string, unknown> };
type BugRow = { id: string; title: string; status: string; pts: number; at: string };
type Data = {
  signedIn: boolean;
  isAdmin?: boolean;
  error?: string;
  channelUrl: string;
  xHandle: string;
  airdropFinal: boolean;
  questsOpen?: boolean;
  claimAt?: string;
  totalPoints: number;
  rules: { airdropTokens: number; tradePointsPerUsd: number; dailyTradeCap: number; referralShare: number; referralFirstTradeBonus: number; xPostPoints: number };
  leaderboard: Row[];
  me?: { points: number; rank: number | null; refCode: string; refCount: number; refActive: number; invitedBy: boolean; estimatedTokens: number; sharePct: number; canPostToday: boolean };
  tasks?: Task[];
  activity?: Activity[];
  bugs?: BugRow[];
};
type Msg = { ok: boolean; text: string } | null;

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const KIND: Record<string, string> = { task: "Task", trade: "Trade", referral: "Invite", x_post: "Post on X", bug: "Bug report", admin: "Bonus" };

export default function QuestsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, Msg>>({});
  const [postUrl, setPostUrl] = useState("");
  const [bug, setBug] = useState({ title: "", details: "" });
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/quests", { cache: "no-store", credentials: "same-origin" });
      const j = (await r.json()) as Data;
      setData(j);
      if (r.ok) swrWrite("quests", j);
    } catch {
      setData((d) => d ?? null);
    }
  }, []);
  // show what you saw last time straight away, then refresh behind it: coming back to this screen never shows a blank page
  useEffect(() => {
    const seen = swrRead<Data>("quests");
    if (seen) setData((d) => d ?? seen);
    void load();
  }, [load]);

  const say = (key: string, m: Msg) => setMsg((s) => ({ ...s, [key]: m }));

  async function runTask(task: string, extra: Record<string, unknown> = {}) {
    setBusy(task);
    say(task, null);
    try {
      const r = await fetch("/api/quests/task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, ...extra }) });
      const j = (await r.json()) as { ok: boolean; message: string };
      say(task, { ok: j.ok, text: j.message });
      if (j.ok) await load();
    } catch {
      say(task, { ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function sendBug() {
    setBusy("bug");
    say("bug", null);
    try {
      const r = await fetch("/api/quests/bugs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...bug, page: typeof window !== "undefined" ? document.referrer.slice(0, 200) : "" }) });
      const j = (await r.json()) as { ok: boolean; message: string };
      say("bug", { ok: j.ok, text: j.message });
      if (j.ok) { setBug({ title: "", details: "" }); await load(); }
    } catch {
      say("bug", { ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://www.wraith.farm";
  const refLink = data?.me ? `${origin}/?ref=${data.me.refCode}` : "";
  const postText = data ? `Scanning 7 chains with @${data.xHandle}. It spots tokens early and you trade them from one balance, gas on them.\n\n${refLink || origin}` : "";

  async function copyRef() {
    try { await navigator.clipboard.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }

  if (!data) {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <div className="q-shell" aria-busy="true" aria-label="Loading quests">
          <div className="wsk-b" style={{ height: 250, borderRadius: 18 }} />
          <div className="q-grid">
            <div style={{ display: "grid", gap: 16 }}><div className="wsk-b" style={{ height: 300, borderRadius: 16 }} /><div className="wsk-b" style={{ height: 150, borderRadius: 16 }} /></div>
            <div style={{ display: "grid", gap: 16 }}><div className="wsk-b" style={{ height: 230, borderRadius: 16 }} /><div className="wsk-b" style={{ height: 120, borderRadius: 16 }} /></div>
          </div>
        </div>
      </main>
    );
  }

  const me = data.me;
  const task = (id: string) => data.tasks?.find((t) => t.id === id);
  const done = (id: string) => !!task(id)?.doneAt;

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="q-shell">
        <section className="q-hero">
          <span className="q-eyebrow">QUESTS · OMEN AIRDROP</span>
          <h1>EARN YOUR SHARE</h1>
          <p>
            {n(data.rules.airdropTokens)} OMEN (5% of supply) goes to early users. Do the tasks, trade on Wraith and invite friends to earn points.
            Your share of the airdrop is your points divided by everyone&apos;s points.
          </p>
          {data.questsOpen === false && <p className="q-msg">Quests are paused right now. Points you already earned are safe.</p>}
          {data.claimAt && !data.airdropFinal && <p className="q-note">Claim opens {new Date(data.claimAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.</p>}
          {me ? (
            <div className="q-stats">
              <div className="q-stat"><span>Your points</span><strong className="is-accent">{n(me.points)}</strong></div>
              <div className="q-stat"><span>Rank</span><strong>{me.rank ? `#${n(me.rank)}` : "–"}</strong></div>
              <div className="q-stat"><span>{data.airdropFinal ? "Your OMEN" : "Est. OMEN today"}</span><strong>{n(me.estimatedTokens)}</strong></div>
              <div className="q-stat"><span>Share of pool</span><strong>{me.sharePct >= 0.01 ? `${me.sharePct.toFixed(2)}%` : me.points > 0 ? "<0.01%" : "0%"}</strong></div>
            </div>
          ) : (
            <div className="q-signin">
              <Link className="q-btn is-solid" href="/login?callbackUrl=%2Fapp%2Fquests">Sign in to start earning</Link>
            </div>
          )}
        </section>

        {data.isAdmin && (
          <div className="q-owner">
            <span><ShieldCheck size={15} /> Owner tools <em>only you see this</em></span>
            <div>
              <Link className="q-btn is-ghost" href="/app/quests/admin">Review bug reports</Link>
              <Link className="q-btn is-solid" href="/app/admin">Open admin</Link>
            </div>
          </div>
        )}

        {data.error && <div className="q-card"><div className="q-msg is-err">{data.error}</div></div>}

        <div className="q-grid">
          <div style={{ display: "grid", gap: 16 }}>
            <section className="q-card">
              <h2><Gift size={16} /> One-time tasks</h2>
              <div className="q-sub">Each one pays once, and every one is checked by the server.</div>

              <div className={`q-task${done("tg_join") ? " is-done" : ""}`}>
                <span className="q-check"><Check size={15} /></span>
                <div className="q-task-body"><b>Join the Wraith Telegram channel</b><small>Live calls and wins. Connect Telegram in your profile menu first.</small></div>
                <span className="q-pts">+{task("tg_join")?.points ?? 300}</span>
                <div className="q-actions">
                  <a className="q-btn is-ghost" href={data.channelUrl} target="_blank" rel="noreferrer">Join</a>
                  <button className="q-btn" disabled={!me || done("tg_join") || busy === "tg_join"} onClick={() => runTask("tg_join")}>{done("tg_join") ? "Done" : "Verify"}</button>
                </div>
              </div>
              {msg.tg_join && <div className={`q-msg ${msg.tg_join.ok ? "is-ok" : "is-err"}`}>{msg.tg_join.text}</div>}

              <div className={`q-task${done("x_link") ? " is-done" : ""}`}>
                <span className="q-check"><Check size={15} /></span>
                <div className="q-task-body"><b>Link your X account</b><small>From your profile. Needed for the daily post quest.</small></div>
                <span className="q-pts">+{task("x_link")?.points ?? 150}</span>
                <div className="q-actions">
                  <a className="q-btn is-ghost" href={`https://x.com/intent/follow?screen_name=${data.xHandle}`} target="_blank" rel="noreferrer">Follow @{data.xHandle}</a>
                  <Link className="q-btn is-ghost" href="/app/profile">Profile</Link>
                  <button className="q-btn" disabled={!me || done("x_link") || busy === "x_link"} onClick={() => runTask("x_link")}>{done("x_link") ? "Done" : "Verify"}</button>
                </div>
              </div>
              {msg.x_link && <div className={`q-msg ${msg.x_link.ok ? "is-ok" : "is-err"}`}>{msg.x_link.text}</div>}

              <div className={`q-task${done("first_trade") ? " is-done" : ""}`}>
                <span className="q-check"><Check size={15} /></span>
                <div className="q-task-body"><b>Make your first trade on Wraith</b><small>Any token, any of the 7 chains. Counted automatically.</small></div>
                <span className="q-pts">+{task("first_trade")?.points ?? 500}</span>
                <div className="q-actions"><Link className="q-btn is-ghost" href="/app">Trade</Link></div>
              </div>
            </section>

            <section className="q-card">
              <h2><Trophy size={16} /> Trade to earn</h2>
              <div className="q-sub">
                {data.rules.tradePointsPerUsd} point per $1 you trade on Wraith, on any chain, up to {n(data.rules.dailyTradeCap)} points a day.
                Every trade is checked on-chain and counted automatically within a few minutes.
              </div>
              <Link className="q-btn is-solid" href="/app">Open the scanner</Link>
            </section>

            <section className="q-card">
              <h2><Send size={16} /> Daily post on X</h2>
              <div className="q-sub">Post about Wraith from your linked X account, then paste the link. +{data.rules.xPostPoints} points, once a day.</div>
              <div className="q-row" style={{ marginBottom: 8 }}>
                <a className="q-btn is-ghost" href={`https://x.com/intent/post?text=${encodeURIComponent(postText)}`} target="_blank" rel="noreferrer">Write a post</a>
                {me && !me.canPostToday && <small className="q-note">Today&apos;s post is counted. Come back tomorrow.</small>}
              </div>
              <div className="q-row">
                <input className="q-input" placeholder="https://x.com/you/status/…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
                <button className="q-btn" disabled={!me || !postUrl || busy === "x_post" || !me.canPostToday} onClick={async () => { await runTask("x_post", { url: postUrl }); setPostUrl(""); }}>Verify</button>
              </div>
              {msg.x_post && <div className={`q-msg ${msg.x_post.ok ? "is-ok" : "is-err"}`}>{msg.x_post.text}</div>}
            </section>

            <section className="q-card">
              <h2><Bug size={16} /> Report a bug</h2>
              <div className="q-sub">Found something broken? Real bugs earn 100 to 5,000 points after review, more for anything that could lose money.</div>
              <div style={{ display: "grid", gap: 8 }}>
                <input className="q-input" placeholder="Short title, e.g. Sell button stuck on Base" maxLength={120} value={bug.title} onChange={(e) => setBug({ ...bug, title: e.target.value })} />
                <textarea className="q-textarea" placeholder="What did you do, what happened, and what did you expect? Add the token and chain if it was a trade." maxLength={4000} value={bug.details} onChange={(e) => setBug({ ...bug, details: e.target.value })} />
                <div><button className="q-btn is-solid" disabled={!me || busy === "bug"} onClick={sendBug}>Send report</button></div>
              </div>
              {msg.bug && <div className={`q-msg ${msg.bug.ok ? "is-ok" : "is-err"}`}>{msg.bug.text}</div>}
              {!!data.bugs?.length && (
                <div className="q-list" style={{ marginTop: 12 }}>
                  {data.bugs.map((b) => (
                    <div className="q-li" key={b.id}>
                      <span>{b.title} <em>· {ago(b.at)}</em></span>
                      <span><span className={`q-badge is-${b.status}`}>{b.status}</span>{b.pts > 0 && <b className="q-pts"> +{n(b.pts)}</b>}</span>
                    </div>
                  ))}
                </div>
              )}

            </section>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <section className="q-card">
              <h2><Users size={16} /> Invite friends</h2>
              <div className="q-sub">
                Earn {Math.round(data.rules.referralShare * 100)}% of your friends&apos; trade points, plus {n(data.rules.referralFirstTradeBonus)} when each one makes their first trade.
              </div>
              {me ? (
                <>
                  <div className="q-row">
                    <div className="q-ref">{refLink}</div>
                    <button className="q-btn" onClick={copyRef}>{copied ? "Copied" : <Copy size={14} />}</button>
                  </div>
                  <div className="q-mini">
                    <div><b>{n(me.refCount)}</b><span>Signed up</span></div>
                    <div><b>{n(me.refActive)}</b><span>Traded</span></div>
                    <div><b>{me.refCode}</b><span>Your code</span></div>
                  </div>
                </>
              ) : <div className="q-note">Sign in to get your invite link.</div>}
            </section>

            <section className="q-card">
              <h2>Claim</h2>
              <div className="q-claim">
                <div className="q-note">
                  {data.airdropFinal
                    ? "The snapshot is done. Connect your wallet to claim your OMEN."
                    : "Points are counted until the snapshot when OMEN launches. Then this turns into a Claim button, and you pay only the small network fee."}
                </div>
                <button className="q-btn is-solid" disabled>{data.airdropFinal ? "Claim opens soon" : "Claim after launch"}</button>
              </div>
            </section>

            {!!data.activity?.length && (
              <section className="q-card">
                <h2>Your points</h2>
                <div className="q-list">
                  {data.activity.map((a, i) => (
                    <div className="q-li" key={i}>
                      <span>{KIND[a.kind] ?? a.kind}{typeof a.meta.usd === "number" ? ` · $${a.meta.usd}` : ""}{typeof a.meta.task === "string" ? ` · ${String(a.meta.task).replace("_", " ")}` : ""} <em>· {ago(a.at)}</em></span>
                      <b className="q-pts">+{n(a.pts)}</b>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="q-card">
              <h2><Trophy size={16} /> Leaderboard</h2>
              <div className="q-sub">{n(data.totalPoints)} points earned so far by everyone.</div>
              {data.leaderboard.length ? data.leaderboard.map((r, i) => (
                <div className={`q-lb${i < 3 ? " is-top" : ""}${me && r.points === me.points && me.rank === i + 1 ? " is-me" : ""}`} key={r.userId}>
                  <span className="q-rank">{i + 1}</span>
                  {r.avatar ? <img className="q-av" src={r.avatar} alt="" /> : <span className="q-av" />}
                  <span className="q-name">{r.username ? <Link href={`/app/u/${r.username}`}>{r.name}</Link> : r.name}</span>
                  <b className="q-pts">{n(r.points)}</b>
                </div>
              )) : <div className="q-note">No points yet. Be the first.</div>}
            </section>

            <p className="q-note">
              Points have no cash value and OMEN isn&apos;t live yet, so nothing here is a promise of value. Farming with many accounts, fake trades or
              bots gets points removed. Rules can be adjusted before the snapshot to keep it fair.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
