"use client";
// First-run setup for a brand-new account, one calm step at a time: pick a handle, follow top traders, optional invite code,
// then the terms. Every step except the terms can be skipped. Nothing here is saved until the person taps the button of the
// step (handle -> PUT username, follow -> POST follow, terms -> the parent's accept call, which also checks the invite code).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import Link from "next/link";
import { suggestUsername } from "@/lib/usernameUtils";

type Trader = { userId: string; username: string | null; displayName: string; avatarDataUrl: string; profitSol: number; closedTradeCount: number };
type Step = 0 | 1 | 2 | 3;
const STEPS = ["Handle", "Follow", "Invite", "Terms"] as const;

export default function OnboardingFlow({
  nameHint, saving, error, onAccept, onLogout,
}: {
  nameHint: string;
  saving: boolean;
  error: string;
  onAccept: (code: string) => void | Promise<void>;
  onLogout: () => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const go = (n: Step) => { setDir(n > step ? 1 : -1); setStep(n); };

  // 0: handle
  const [handle, setHandle] = useState(() => suggestUsername(nameHint || "trader"));
  const [avail, setAvail] = useState<boolean | null>(null);
  const [handleMsg, setHandleMsg] = useState("");
  const [claiming, setClaiming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clean = handle.toLowerCase().replace(/[^a-z0-9_]/g, "");
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (clean.length < 4) { setAvail(null); setHandleMsg(clean.length ? "At least 4 characters" : ""); return; }
    setAvail(null); setHandleMsg("");
    timer.current = setTimeout(() => {
      fetch(`/api/user/username/check?q=${encodeURIComponent(clean)}`)
        .then((r) => r.json())
        .then((d: { available?: boolean; error?: string }) => { setAvail(!!d.available); setHandleMsg(d.available ? "" : d.error ?? "Already taken"); })
        .catch(() => setHandleMsg("Could not check right now"));
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [clean]);
  const claim = async () => {
    if (!avail || claiming) return;
    setClaiming(true);
    try {
      const r = await fetch("/api/user/username", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: clean }) });
      if (!r.ok) { const d = (await r.json().catch(() => null)) as { error?: string } | null; setHandleMsg(d?.error ?? "Could not save that handle"); setClaiming(false); return; }
      try { localStorage.setItem("wraith_username_modal_dismissed_v1", "1"); } catch { /* storage blocked */ }
      setClaiming(false);
      go(1);
    } catch { setHandleMsg("Something went wrong. Try again."); setClaiming(false); }
  };

  // 1: follow top traders (the three best start ticked)
  const [traders, setTraders] = useState<Trader[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false);
  const [following, setFollowing] = useState(false);
  useEffect(() => {
    if (step !== 1 || traders) return;
    fetch("/api/traders").then((r) => r.json()).then((d: { traders?: Trader[] }) => {
      const list = (d.traders ?? []).filter((t) => t.closedTradeCount > 0).slice(0, 15);
      const all = list.length ? list : (d.traders ?? []).slice(0, 8);
      setTraders(all);
      setPicked(new Set(all.slice(0, 3).map((t) => t.userId)));
    }).catch(() => setTraders([]));
  }, [step, traders]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const followPicked = async () => {
    if (following) return;
    setFollowing(true);
    await Promise.all([...picked].map((traderId) =>
      fetch("/api/traders/following", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ traderId }) }).catch(() => undefined)));
    setFollowing(false);
    go(2);
  };

  // 2: invite code (a link already left it in a cookie)
  const [code, setCode] = useState("");
  useEffect(() => {
    try { const m = document.cookie.match(/(?:^|; )wr_ref=([A-Za-z0-9]{5,12})/); if (m) setCode((c) => c || m[1].toUpperCase()); } catch { /* cookies blocked */ }
  }, []);

  // 3: terms
  const [ok, setOk] = useState(false);
  const visible = useMemo(() => (traders ? (more ? traders : traders.slice(0, 5)) : []), [traders, more]);

  return (
    <div className="ob-backdrop">
      <section className="ob" role="dialog" aria-modal="true" aria-label="Set up your Wraith account">
        <header className="ob-top">
          {step > 0 ? <button type="button" className="ob-back" onClick={() => go((step - 1) as Step)} aria-label="Back"><ArrowLeft size={20} /></button> : <span className="ob-back" />}
          <div className="ob-dots" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => <i key={s} className={i === step ? "on" : i < step ? "done" : ""} />)}
          </div>
          {step === 1 || step === 2 ? <button type="button" className="ob-skip" onClick={() => go((step + 1) as Step)}>Skip</button> : step === 0 ? <button type="button" className="ob-skip" onClick={() => go(1)}>Skip</button> : <span className="ob-back" />}
        </header>

        <div className={`ob-page ${dir > 0 ? "fwd" : "back"}`} key={step}>
          {step === 0 && (
            <>
              <div className="ob-ghost" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" /></div>
              <h2>Pick your handle</h2>
              <p className="ob-sub">This is how traders find and follow you. You can change it later.</p>
              <label className={`ob-field${avail === false || (handleMsg && avail === null && clean.length) ? " bad" : avail ? " good" : ""}`}>
                <span className="ob-at">@</span>
                <input value={handle} maxLength={20} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="your_handle"
                  onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void claim(); }} />
                <span className="ob-state">{avail === null && clean.length >= 4 && !handleMsg ? <Loader2 size={16} className="spinning" /> : avail ? <Check size={17} /> : avail === false ? <X size={17} /> : null}</span>
              </label>
              <p className={`ob-hint${avail ? " ok" : handleMsg ? " bad" : ""}`}>{avail ? `@${clean} is yours to take` : handleMsg || "Letters, numbers and underscores"}</p>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Follow top traders</h2>
              <p className="ob-sub">Their buys and sells land in your alerts and feed. Untick anyone you do not want.</p>
              <div className="ob-list">
                {traders === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="ob-row sk" />)}
                {traders && traders.length === 0 && <p className="ob-empty">No public traders yet. You can find people to follow later in Discover.</p>}
                {visible.map((t, i) => (
                  <button type="button" key={t.userId} className={`ob-row${picked.has(t.userId) ? " on" : ""}`} onClick={() => toggle(t.userId)} style={{ animationDelay: `${i * 45}ms` }}>
                    <span className="ob-rank">{i + 1}</span>
                    {t.avatarDataUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={t.avatarDataUrl} alt="" /> : <span className="ob-av">{t.displayName[0]?.toUpperCase()}</span>}
                    <span className="ob-who"><b>{t.displayName}</b><small>{t.username ? `@${t.username}` : `${t.closedTradeCount} trades`}</small></span>
                    <span className="ob-check">{picked.has(t.userId) ? <Check size={16} /> : null}</span>
                  </button>
                ))}
                {traders && traders.length > 5 && !more && <button type="button" className="ob-more" onClick={() => setMore(true)}>Show more</button>}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Got an invite code?</h2>
              <p className="ob-sub">Use a friend&apos;s code and they earn from your trades. Valid in your first 3 days, before your first trade.</p>
              <label className="ob-field">
                <input className="mono" value={code} maxLength={12} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="Paste code"
                  onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} />
                <button type="button" className="ob-paste" onClick={() => { navigator.clipboard?.readText().then((t) => setCode(t.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12))).catch(() => undefined); }}>Paste</button>
              </label>
              <button type="button" className="ob-link" onClick={() => { setCode(""); go(3); }}>I don&apos;t have one</button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="ob-ghost" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.svg" alt="" /></div>
              <h2>Almost in</h2>
              <ul className="ob-points">
                <li><b>One Cash balance</b><span>Deposit once, trade on 7 chains.</span></li>
                <li><b>Calls with a track record</b><span>Wins and losses, all public.</span></li>
                <li><b>Your wallets, your PIN</b><span>Nobody else can move your funds.</span></li>
              </ul>
              <label className="ob-terms">
                <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
                <span>I am 18 or older and accept the <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span>
              </label>
              {error && <p className="ob-hint bad" role="alert">{error}</p>}
            </>
          )}
        </div>

        <footer className="ob-foot">
          {step === 0 && <button type="button" className="ob-cta" disabled={!avail || claiming} onClick={() => void claim()}>{claiming ? "Saving…" : "Continue"}</button>}
          {step === 1 && <button type="button" className="ob-cta" disabled={following} onClick={() => void followPicked()}>{following ? "Following…" : picked.size ? `Follow ${picked.size} & continue` : "Continue"}</button>}
          {step === 2 && <button type="button" className="ob-cta" onClick={() => go(3)}>{code.length >= 5 ? "Use this code" : "Continue"}</button>}
          {step === 3 && <button type="button" className="ob-cta" disabled={!ok || saving} onClick={() => void onAccept(code)}>{saving ? "Checking…" : "Enter Wraith"}</button>}
          {step === 3 && <button type="button" className="ob-out" onClick={onLogout}>Log out</button>}
        </footer>
      </section>
    </div>
  );
}
