"use client";
// Date (and optional time) picker drawn in the app's own theme, instead of the browser's grey native one.
// Value in and out is an ISO string ("" = not set). Times are shown in the viewer's own timezone.

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import "./DateTimeField.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const p2 = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function DateTimeField({ value, onChange, withTime = true, placeholder = "Pick a date", id }: {
  value: string;
  onChange: (iso: string) => void;
  withTime?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const picked = useMemo(() => (value && Number.isFinite(Date.parse(value)) ? new Date(value) : null), [value]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => { const d = picked ?? new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = picked ?? new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
    const away = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // week starts on Monday
    const count = new Date(view.y, view.m + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) out.push(new Date(view.y, view.m, d));
    while (out.length % 7) out.push(null);
    return out;
  }, [view]);

  const hour = picked ? picked.getHours() : 12;
  const minute = picked ? picked.getMinutes() : 0;
  const emit = (d: Date) => onChange(d.toISOString());
  const pickDay = (d: Date) => {
    emit(new Date(d.getFullYear(), d.getMonth(), d.getDate(), withTime ? hour : 12, withTime ? minute : 0));
    if (!withTime) setOpen(false);
  };
  const setTime = (h: number, m: number) => {
    const b = picked ?? new Date();
    emit(new Date(b.getFullYear(), b.getMonth(), b.getDate(), h, m));
  };
  const step = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const today = new Date();
  const label = picked
    ? picked.toLocaleString(undefined, withTime
      ? { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : placeholder;

  return (
    <div className="dtf" ref={wrap}>
      <button type="button" id={id} className={`dtf-btn${picked ? "" : " is-empty"}${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <CalendarDays size={15} />
        <span>{label}</span>
      </button>
      {picked && <button type="button" className="dtf-clear" onClick={() => onChange("")} aria-label="Clear date"><X size={14} /></button>}
      {open && (
        <div className="dtf-pop" role="dialog" aria-label="Choose a date">
          <div className="dtf-head">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <strong>{MONTHS[view.m]} {view.y}</strong>
            <button type="button" onClick={() => step(1)} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
          <div className="dtf-grid">
            {DAYS.map((d) => <i key={d}>{d}</i>)}
            {cells.map((d, i) => d
              ? <button type="button" key={i} className={`${picked && sameDay(d, picked) ? "is-on" : ""}${sameDay(d, today) ? " is-today" : ""}`} onClick={() => pickDay(d)}>{d.getDate()}</button>
              : <span key={i} />)}
          </div>
          {withTime && (
            <div className="dtf-time">
              <span>Time</span>
              <select value={hour} onChange={(e) => setTime(Number(e.target.value), minute)} aria-label="Hour">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h % 12 === 0 ? 12 : h % 12} {h < 12 ? "AM" : "PM"}</option>)}
              </select>
              <b>:</b>
              <select value={minute - (minute % 5)} onChange={(e) => setTime(hour, Number(e.target.value))} aria-label="Minute">
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={i * 5}>{p2(i * 5)}</option>)}
              </select>
            </div>
          )}
          <div className="dtf-foot">
            <button type="button" onClick={() => { const n = new Date(); emit(withTime ? new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes() - (n.getMinutes() % 5)) : new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12)); }}>{withTime ? "Now" : "Today"}</button>
            <button type="button" className="is-solid" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
