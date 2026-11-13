"use client";
// Bell on the token page: "tell me when this dips 25% / doubles". Alerts go to the phone through the same push as everything else.
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check, X } from "lucide-react";
import { PRESETS, alertLabel, type AlertKind } from "@/lib/priceAlerts";

interface Row { id: string; kind: AlertKind; pct: number }

export default function PriceAlertButton({ mint, symbol }: { mint: string; symbol: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch(`/api/price-alerts?mint=${encodeURIComponent(mint)}`).then((r) => (r.ok ? r.json() : { alerts: [] })).then((d: { alerts?: Row[] }) => setRows(d.alerts ?? [])).catch(() => undefined);
  }, [mint]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const has = (kind: AlertKind, pct: number) => rows.find((r) => r.kind === kind && r.pct === pct);
  const toggle = async (kind: AlertKind, pct: number) => {
    const key = `${kind}${pct}`;
    if (busy) return;
    setBusy(key); setMsg("");
    try {
      const ex = has(kind, pct);
      if (ex) await fetch(`/api/price-alerts?id=${ex.id}`, { method: "DELETE" });
      else {
        const r = await fetch("/api/price-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mint, symbol, kind, pct }) });
        if (!r.ok) { const d = (await r.json().catch(() => null)) as { error?: string } | null; setMsg(d?.error ?? "Could not set that alert."); }
      }
      load();
    } catch { setMsg("Could not reach Wraith. Try again."); }
    setBusy("");
  };

  return (
    <div className="pa" ref={box}>
      <button type="button" className={`wx-icon-btn${rows.length ? " active" : ""}`} onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} aria-label="Price alerts" title="Alert me on a dip or a run">
        {rows.length ? <BellRing size={14} /> : <Bell size={14} />}
      </button>
      {open && (
        <div className="pa-pop" role="dialog" aria-label={`Alerts for ${symbol}`}>
          <div className="pa-head"><b>Alert me on ${symbol}</b><button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={15} /></button></div>
          <p className="pa-sub">Measured from the price right now. You get a phone alert once, then it switches off.</p>
          <div className="pa-grid">
            {PRESETS.map((p) => {
              const on = !!has(p.kind, p.pct);
              return (
                <button key={`${p.kind}${p.pct}`} type="button" className={`${p.kind}${on ? " on" : ""}`} disabled={busy !== ""} onClick={() => void toggle(p.kind, p.pct)}>
                  {on ? <Check size={14} /> : null}{p.label}
                </button>
              );
            })}
          </div>
          {rows.length > 0 && <p className="pa-on">Active: {rows.map((r) => alertLabel(r)).join(" · ")}</p>}
          {msg && <p className="pa-err" role="alert">{msg}</p>}
          <p className="pa-note">Needs phone notifications on (bell in the top bar). A dip alert is a heads-up, not a buy signal: in Wraith&apos;s backtests, buying dips on called tokens did not pay.</p>
        </div>
      )}
    </div>
  );
}
