"use client";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({ children, delay = 0, y = 26, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function CountUp({ to, prefix = "", suffix = "" }: { to: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration: 1.4, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [inView, to, reduce]);
  return <span ref={ref}>{prefix}{v}{suffix}</span>;
}

/** Browser-style frame that tilts toward the cursor. */
export function TiltFrame({ children, title, tag = "live data" }: { children: ReactNode; title: string; tag?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [t, setT] = useState("perspective(1100px) rotateX(0deg) rotateY(0deg)");
  return (
    <div
      ref={ref}
      className="lp-frame"
      style={{ transform: t }}
      onMouseMove={(e) => {
        if (reduce || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        setT(`perspective(1100px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`);
      }}
      onMouseLeave={() => setT("perspective(1100px) rotateX(0deg) rotateY(0deg)")}
    >
      <div className="lp-frame-bar"><i /><i /><i /><span>{title}</span><em>{tag}</em></div>
      <div className="lp-frame-body">{children}</div>
    </div>
  );
}

/** Button/link that leans toward the pointer. */
export function Magnetic({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const [p, setP] = useState({ x: 0, y: 0 });
  return (
    <span
      style={{ display: "inline-block", transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform .2s cubic-bezier(.22,1,.36,1)" }}
      onMouseMove={(e) => {
        if (reduce) return;
        if (typeof window !== "undefined" && window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
        const r = e.currentTarget.getBoundingClientRect();
        setP({ x: (e.clientX - r.left - r.width / 2) * 0.18, y: (e.clientY - r.top - r.height / 2) * 0.28 });
      }}
      onMouseLeave={() => setP({ x: 0, y: 0 })}
    >
      {children}
    </span>
  );
}

/** Soft orange glow that follows the cursor. Desktop with a fine pointer only. */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let raf = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current) ref.current.style.transform = `translate(${e.clientX - 260}px, ${e.clientY - 260}px)`;
      });
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} className="lp-cursor" aria-hidden="true" />;
}
