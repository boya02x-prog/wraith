"use client";
// Auto-trader (beta). Only the owner and the people the owner added in the admin page get in; the server decides (see /api/auto-trader), this page
// just shows what it is told. Today it is a paper-money test: nothing here touches a wallet or real money. The point is to find out, with real
// numbers, whether auto-trading would earn anything after fees, and to be honest about it either way.

import { useEffect, useState } from "react";
import { FlaskConical, Lock, TriangleAlert } from "lucide-react";
import Header from "@/components/HeaderSlot";
import LabView from "@/components/LabView";
import type { LabReport } from "@/lib/autoLab";
import "../quests/quests.css";
import "../admin/admin.css";

type State = { kind: "loading" } | { kind: "signin" } | { kind: "denied" } | { kind: "error" } | { kind: "ok"; d: LabReport };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="q-shell ad-shell">{children}</div>
    </main>
  );
}

export default function AutoTraderPage() {
  const [s, setS] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let on = true;
    const load = async () => {
      try {
        const r = await fetch("/api/auto-trader?report=1", { cache: "no-store" });
        if (!on) return;
        if (r.status === 401) { setS({ kind: "signin" }); return; }
        if (!r.ok) { setS((p) => (p.kind === "ok" ? p : { kind: "error" })); return; }
        const j = (await r.json()) as { allowed?: boolean } & Partial<LabReport>;
        if (!on) return;
        if (!j.allowed) { setS({ kind: "denied" }); return; }
        setS({ kind: "ok", d: j as LabReport });
      } catch { if (on) setS((p) => (p.kind === "ok" ? p : { kind: "error" })); }
    };
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { on = false; window.clearInterval(t); };
  }, []);

  if (s.kind === "loading") {
    return (
      <Shell>
        <div className="wsk-b" style={{ height: 150, borderRadius: 18 }} aria-busy="true" aria-label="Loading" />
        <div className="wsk-b" style={{ height: 260, borderRadius: 16 }} />
      </Shell>
    );
  }
  if (s.kind === "signin" || s.kind === "denied") {
    return (
      <Shell>
        <section className="q-card ad-denied">
          <Lock size={28} />
          <h2>{s.kind === "signin" ? "Sign in first" : "Not open to your account yet"}</h2>
          <p className="q-note">{s.kind === "signin" ? "Sign in to see this page." : "The Auto-trader is in a private beta for a small, hand-picked group. If you should have it, ask the Wraith team to add your sign-in email."}</p>
        </section>
      </Shell>
    );
  }
  if (s.kind === "error") {
    return (
      <Shell>
        <section className="q-card ad-denied">
          <TriangleAlert size={28} />
          <h2>Could not load this page</h2>
          <p className="q-note">The server did not answer. Nothing was changed.</p>
        </section>
      </Shell>
    );
  }

  const d = s.d;
  return (
    <Shell>
      <section className="q-hero ad-hero">
        <span className="q-eyebrow">PRIVATE BETA · PAPER MONEY</span>
        <h1>Auto-trader</h1>
        <p>Wraith&apos;s brain picks the calls and trades them for you. Right now it does this with <b>pretend money only</b>, to find out with real numbers whether it would actually earn anything after fees.</p>
      </section>

      <section className="q-card ad-card">
        <h2><FlaskConical size={16} /> How it works today</h2>
        <p className="q-note">Every time Wraith makes a public call, the test auto-trader &quot;buys&quot; it with ${d.sizeUsd} of pretend money, then sells it by one of three styles: <b>Scalp</b> (quick in and out), <b>Day</b> (holds up to a day) or <b>Long</b> (holds up to three days). Trading fees and slippage are taken off every trade, so the numbers below are what a real account would have seen, not the flattering version.</p>
        <p className="q-note">No wallet, no deposit, no real money. Nothing on this page can lose you anything.</p>
      </section>

      <section className="q-card ad-card">
        <h2>Live results</h2>
        <LabView d={d} />
      </section>

      <section className="q-card ad-card">
        <h2>What comes next</h2>
        <p className="q-note">Real-money trading opens <b>only if these results hold up after fees</b> over enough trades. We would rather tell you it does not work yet than take your money to find out. If it does hold up, the plan is:</p>
        <ul className="q-note" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>You choose a style: scalp, day or long.</li>
          <li>You put in a small amount and set a daily trading window (for example 2 hours).</li>
          <li>A loss limit that stops it on its own, and a Stop button that works any time.</li>
          <li>Trading is never a promise of profit: any real trade can lose money.</li>
        </ul>
      </section>
    </Shell>
  );
}
