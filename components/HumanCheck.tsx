"use client";

// The "checking that you are human" screen (see lib/humanGate.ts). Cloudflare Turnstile draws its own small box ("Verifying..." then "Success!");
// when it hands over a token the server confirms it and the app opens. Wraith's ghost keeps watch while it works.
import { useCallback, useEffect, useRef, useState } from "react";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
// not declared on Window here: another file in the project already types window.turnstile, so it is read through this helper
const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile;

export default function HumanCheck({ siteKey, next }: { siteKey: string; next: string }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [state, setState] = useState<"working" | "failed" | "blocked">("working");
  const [msg, setMsg] = useState("");

  const onToken = useCallback(async (token: string) => {
    try {
      const r = await fetch("/api/human", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (r.ok) { window.location.replace(next); return; }
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      setMsg(d.error ?? "The check did not pass.");
    } catch {
      setMsg("No connection. Check your internet and try again.");
    }
    setState("failed");
  }, [next]);

  useEffect(() => {
    let dead = false;
    const mount = () => {
      const t = turnstile();
      if (dead || !t || !box.current || widget.current) return;
      widget.current = t.render(box.current, {
        sitekey: siteKey,
        theme: "dark",
        retry: "auto",
        callback: (t: string) => void onToken(t),
        "error-callback": () => { setMsg("The check could not run in this browser."); setState("failed"); },
        "timeout-callback": () => { setMsg("The check took too long."); setState("failed"); },
      });
    };
    if (turnstile()) mount();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = mount;
      s.onerror = () => setState("blocked");
      document.head.appendChild(s);
    }
    return () => {
      dead = true;
      try { if (widget.current) turnstile()?.remove(widget.current); } catch { /* already gone */ }
      widget.current = null;
    };
  }, [siteKey, onToken]);

  const retry = () => {
    setState("working");
    setMsg("");
    try { turnstile()?.reset(widget.current ?? undefined); } catch { window.location.reload(); }
  };

  return (
    <main className="hc">
      <style>{`
        .hc{min-height:100dvh;display:grid;place-items:center;padding:28px 20px;background:#0a0a0b;color:#ededee;font-family:var(--font-sans),system-ui,sans-serif}
        .hc-in{width:min(420px,100%);display:grid;gap:14px;justify-items:start}
        .hc img{width:54px;height:auto;animation:hc-f 2.8s ease-in-out infinite}
        .hc h1{margin:6px 0 0;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.025em}
        .hc p{margin:0;color:rgba(255,255,255,.6);font-size:15px;line-height:1.55}
        .hc-box{min-height:68px;margin-top:6px}
        .hc-bad{padding:12px 14px;border-radius:12px;background:rgba(255,107,98,.12);color:#ffb3ad;font-size:14px;line-height:1.5;width:100%}
        .hc button{height:44px;padding:0 20px;border:0;border-radius:12px;background:#ff7b3d;color:#1a0b03;font:800 15px var(--font-sans),system-ui;cursor:pointer}
        .hc small{color:rgba(255,255,255,.4);font-size:12px}
        @keyframes hc-f{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @media (prefers-reduced-motion:reduce){.hc img{animation:none}}
      `}</style>
      <div className="hc-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={54} height={54} />
        <h1>Checking that you are human</h1>
        <p>This takes a moment. Wraith runs a quick security check before it opens, to keep bots out.</p>
        <div ref={box} className="hc-box" />
        {state === "failed" && (
          <>
            <div className="hc-bad" role="alert">{msg || "The check did not pass."}</div>
            <button type="button" onClick={retry}>Try again</button>
          </>
        )}
        {state === "blocked" && (
          <div className="hc-bad" role="alert">
            The security check could not load. An ad blocker or a strict privacy setting may be blocking challenges.cloudflare.com. Turn it off for this site and reload.
          </div>
        )}
        <small>Protected by Cloudflare</small>
      </div>
    </main>
  );
}
