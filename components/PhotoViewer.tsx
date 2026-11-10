"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Full-screen photo viewer (tap a profile photo → it opens big; tap outside, press Esc, or drag down to close).
 * Pinch-zoom is allowed inside the viewer even though the rest of the app locks zoom.
 */
export default function PhotoViewer({ src, alt = "", onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (!mounted) return null;
  const fade = Math.max(0.25, 1 - Math.abs(dy) / 420);
  return createPortal(
    <div
      className="wx-photo-viewer"
      role="dialog"
      aria-modal="true"
      style={{ opacity: fade }}
      onClick={onClose}
      onPointerDown={(e) => { start.current = e.clientY; }}
      onPointerMove={(e) => { if (start.current !== null) setDy(e.clientY - start.current); }}
      onPointerUp={() => { if (Math.abs(dy) > 110) onClose(); start.current = null; setDy(0); }}
      onPointerCancel={() => { start.current = null; setDy(0); }}
    >
      <div className="wx-photo-bg" style={{ backgroundImage: `url("${src}")` }} aria-hidden="true" />
      <button type="button" className="wx-photo-close" aria-label="Close photo" onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <X size={20} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="wx-photo-img"
        style={{ transform: `translateY(${dy}px) scale(${1 - Math.min(0.12, Math.abs(dy) / 2400)})` }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
