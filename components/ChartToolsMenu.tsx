"use client";

// One dropdown for every chart tool, grouped by what it does. On a phone it opens as a bottom sheet (big tap targets, closes with
// a swipe-free tap outside); on a desktop it is a small popover under the button. Opening and closing are animated.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignJustify, ArrowUpRight, ChevronDown, Minus, MousePointer2, PenLine, Ruler, Slash, Square, Trash2, X, type LucideIcon } from "lucide-react";

export type ToolId = "hline" | "vline" | "trend" | "ray" | "rect" | "fib" | "measure" | "select" | "cursor";

const GROUPS: { title: string; items: { id: ToolId; label: string; hint: string; Icon: LucideIcon }[] }[] = [
  { title: "Lines", items: [
    { id: "hline", label: "Horizontal line", hint: "Tap once where it goes", Icon: Minus },
    { id: "vline", label: "Vertical line", hint: "Tap once where it goes", Icon: Minus },
    { id: "trend", label: "Trend line", hint: "Drag, or tap two points", Icon: Slash },
    { id: "ray", label: "Ray", hint: "A line that keeps going to the right", Icon: ArrowUpRight },
  ] },
  { title: "Shapes", items: [{ id: "rect", label: "Rectangle", hint: "Drag, or tap two corners", Icon: Square }] },
  { title: "Fibonacci", items: [{ id: "fib", label: "Fib retracement", hint: "Drag from a low to a high", Icon: AlignJustify }] },
  { title: "Measure", items: [{ id: "measure", label: "Measure", hint: "Price and % between two points", Icon: Ruler }] },
  { title: "Edit", items: [{ id: "select", label: "Select drawings", hint: "Drag a box over them, then delete", Icon: MousePointer2 }] },
];
const ALL = GROUPS.flatMap((g) => g.items);

// the desktop rail: same tools as the dropdown, in TradingView's order, with keyboard hints
const RAIL: ({ id: ToolId; label: string; key?: string; Icon: LucideIcon; rot?: number } | "sep")[] = [
  { id: "cursor", label: "Cursor: select, move and edit drawings", key: "Esc", Icon: MousePointer2 },
  "sep",
  { id: "trend", label: "Trend line", key: "Alt+T", Icon: Slash },
  { id: "ray", label: "Ray", Icon: ArrowUpRight },
  { id: "hline", label: "Horizontal line", key: "Alt+H", Icon: Minus },
  { id: "vline", label: "Vertical line", key: "Alt+V", Icon: Minus, rot: 90 },
  { id: "rect", label: "Rectangle", key: "Alt+R", Icon: Square },
  { id: "fib", label: "Fib retracement", key: "Alt+F", Icon: AlignJustify },
  "sep",
  { id: "measure", label: "Measure price and %", key: "Shift+click", Icon: Ruler },
];

/** Vertical tool rail down the left of the chart (desktop only; CSS hides it on phones, which use the dropdown). */
export function ChartToolRail({ active, drawCount, selCount, onPick, onDelete }: {
  active: ToolId | null; drawCount: number; selCount: number; onPick: (id: ToolId) => void; onDelete: () => void;
}) {
  const cur = active ?? "cursor";
  return (
    <div className="wx-rail" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      {RAIL.map((it, i) => it === "sep" ? <i key={i} className="wx-rail-sep" /> : (
        <button key={it.id} type="button" className={`wx-rail-btn${cur === it.id ? " on" : ""}`} data-tip={`${it.label}${it.key ? `  (${it.key})` : ""}`} aria-label={it.label} aria-pressed={cur === it.id} onClick={() => onPick(it.id)}>
          <it.Icon size={18} style={it.rot ? { transform: `rotate(${it.rot}deg)` } : undefined} />
        </button>
      ))}
      <i className="wx-rail-sep" />
      <button type="button" className="wx-rail-btn" disabled={drawCount === 0} data-tip={selCount ? `Delete ${selCount} selected  (Del)` : "Remove all drawings"} aria-label="Remove drawings" onClick={onDelete}>
        <Trash2 size={18} />
      </button>
    </div>
  );
}

export default function ChartToolsMenu({ active, drawCount, selCount, onPick, onDelete }: {
  active: ToolId | null; drawCount: number; selCount: number; onPick: (id: ToolId) => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, 170);
  }, []);
  const toggle = () => {
    if (open) { close(); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // open below the button, or above it when there is more room there; never taller than the space available
      const below = window.innerHeight - r.bottom - 14, above = r.top - 14;
      const up = below < 380 && above > below;
      setPos({ right: Math.max(8, window.innerWidth - r.right), maxHeight: Math.max(240, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open, close]);

  const cur = ALL.find((x) => x.id === active);
  const TriggerIcon = cur?.Icon ?? PenLine;
  const pick = (id: ToolId) => { onPick(id); close(); };

  return (
    <>
      <button ref={btnRef} type="button" className={`wx-icon-btn cm-trigger${active ? " on" : ""}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={cur ? `Chart tools, ${cur.label} active` : "Chart tools"} title="Drawing and measuring tools">
        <TriggerIcon size={14} />
        <span className="cm-trigger-label">{cur ? cur.label : "Tools"}</span>
        <ChevronDown size={12} className={`cm-chev${open && !closing ? " up" : ""}`} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className={`cm-backdrop${closing ? " out" : ""}`} onClick={close} />
          <div ref={menuRef} className={`cm-menu${closing ? " out" : ""}`} role="menu" aria-label="Chart tools" style={pos ? { top: pos.top, bottom: pos.bottom, right: pos.right, maxHeight: pos.maxHeight } : undefined}>
            <div className="cm-grab" aria-hidden="true" />
            <div className="cm-head"><b>Chart tools</b><button type="button" className="cm-x" onClick={close} aria-label="Close"><X size={16} /></button></div>
            {GROUPS.map((g) => (
              <div key={g.title} className="cm-group" role="group" aria-label={g.title}>
                <small>{g.title}</small>
                {g.items.map(({ id, label, hint, Icon }) => (
                  <button key={id} type="button" role="menuitem" className={`cm-item${active === id ? " on" : ""}`} onClick={() => pick(id)}>
                    <span className="cm-ico"><Icon size={17} /></span>
                    <span className="cm-txt"><b>{label}</b><em>{hint}</em></span>
                    {active === id && <span className="cm-on">On</span>}
                  </button>
                ))}
              </div>
            ))}
            {drawCount > 0 && (
              <div className="cm-group" role="group" aria-label="Delete">
                <small>Clean up</small>
                <button type="button" role="menuitem" className="cm-item danger" onClick={() => { onDelete(); close(); }}>
                  <span className="cm-ico"><Trash2 size={17} /></span>
                  <span className="cm-txt"><b>{selCount ? `Delete ${selCount} selected` : `Clear all drawings (${drawCount})`}</b><em>{selCount ? "Removes only what you selected" : "Removes every line and shape on this chart"}</em></span>
                </button>
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
