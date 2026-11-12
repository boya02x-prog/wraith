"use client";
// Shown ONCE on a brand-new account (first 3 days, no trade yet, no invite code yet): "Got an invite code?". People who came through
// an invite link are credited automatically and never see it. Anyone can still add a code later on the Quests page.
import { useEffect, useState } from "react";
import { useWraithSession } from "@/components/SessionProvider";

const SEEN = "wraith_ref_prompt_v1";

export default function ReferralPrompt() {
  const { status } = useWraithSession();
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  const finish = () => { try { localStorage.setItem(SEEN, "1"); } catch { /* storage blocked */ } setShow(false); };

  useEffect(() => {
    if (status !== "authenticated") return;
    try { if (localStorage.getItem(SEEN)) return; } catch { /* storage blocked: ask the server anyway */ }
    // a few seconds after sign-in, so it never competes with the app opening
    const t = window.setTimeout(() => {
      fetch("/api/quests/referral", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { eligible?: boolean } | null) => {
          if (!d) return;
          if (d.eligible) setShow(true); else { try { localStorage.setItem(SEEN, "1"); } catch { /* ignore */ } }
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [status]);

  async function apply() {
    if (code.length < 5 || busy) return;
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/quests/referral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = (await r.json()) as { ok: boolean; message: string };
      setRes({ ok: j.ok, text: j.message });
      if (j.ok) window.setTimeout(finish, 1400);
    } catch { setRes({ ok: false, text: "No connection. Try again." }); }
    finally { setBusy(false); }
  }

  if (!show) return null;
  return (
    <div className="rf-back" role="dialog" aria-modal="true" aria-label="Invite code" onClick={finish}>
      <div className="rf-card" onClick={(e) => e.stopPropagation()}>
        <strong>Got an invite code?</strong>
        <p>If a friend invited you, add their code so they get credit when you trade. You can also do this later on the Quests page.</p>
        <input autoFocus placeholder="Paste the code" value={code} maxLength={12} autoCapitalize="characters" autoComplete="off" spellCheck={false}
          onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") void apply(); }} />
        {res && <span className={res.ok ? "ok" : "err"}>{res.text}</span>}
        <div className="rf-actions">
          <button type="button" className="rf-skip" onClick={finish}>Skip</button>
          <button type="button" className="rf-go" disabled={busy || code.length < 5} onClick={() => void apply()}>{busy ? "…" : "Apply"}</button>
        </div>
      </div>
    </div>
  );
}
