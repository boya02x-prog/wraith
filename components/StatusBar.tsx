"use client";
// Wraith live tape: the platform's own top signals and winners scrolling along the bottom, plus the 7-day record and Telegram.
import { useEffect, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { useRouter } from "next/navigation";
import ChainLogo from "@/components/ChainLogo";
import { changeColor, fmtPct, fmtUsd } from "@/lib/market";

interface Sig { address: string; chain: string; symbol: string; score: number; tier: "HOT" | "WATCH"; mcap: number; h1: number | null }
interface Win { address: string; chain: string; symbol: string; x: number; mcap: number }
interface Tape { signals: Sig[]; wins: Win[]; stats: { calls: number; hit2: number; rate: number } }

const TG_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/wraithportal";

export default function StatusBar() {
  const router = useRouter();
  const [tape, setTape] = useState<Tape | null>(null);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/tape", { cache: "no-store" });
        const d: Tape = await res.json();
        if (!alive) return;
        setTape(d);
        setOk(res.ok);
      } catch { if (alive) setOk(false); }
    };
    void load();
    const t = visibleInterval(() => void load(), 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  const go = (address: string, chain: string) => router.push(`/app/token/${encodeURIComponent(address)}${chain !== "solana" ? `?chain=${chain}` : ""}`);

  // winners first (they are the proof), then live signals
  const items: { key: string; node: React.ReactNode }[] = [
    ...(tape?.wins ?? []).map((w) => ({
      key: `w${w.address}`,
      node: (
        <button type="button" className="wx-tp-item win" onClick={() => go(w.address, w.chain)}>
          <span className="wx-tp-badge win">WIN</span>
          <ChainLogo chain={w.chain} size={13} />
          <b>${w.symbol}</b>
          <em className="up">{w.x.toFixed(w.x >= 10 ? 1 : 2)}x</em>
          <small>{fmtUsd(w.mcap)}</small>
        </button>
      ),
    })),
    ...(tape?.signals ?? []).map((s) => ({
      key: `s${s.address}`,
      node: (
        <button type="button" className="wx-tp-item" onClick={() => go(s.address, s.chain)}>
          <span className={`wx-tp-badge ${s.tier === "HOT" ? "hot" : "watch"}`}>{s.tier === "HOT" ? "HOT" : "WATCH"}</span>
          <ChainLogo chain={s.chain} size={13} />
          <b>${s.symbol}</b>
          <em>{s.score}</em>
          <small>{fmtUsd(s.mcap)}</small>
          {s.h1 !== null && <small style={{ color: changeColor(s.h1) }}>{fmtPct(s.h1)}</small>}
        </button>
      ),
    })),
  ];
  const seconds = Math.max(30, items.length * 5);

  return (
    <footer className="wx-statusbar wx-tape" aria-label="Wraith live tape">
      <span className={`wx-tp-live${ok ? "" : " bad"}`}><i />LIVE</span>
      {tape?.stats && tape.stats.calls > 0 && (
        <span className="wx-tp-record" title="Calls from the last 7 days that reached 2x or more">
          <b>{tape.stats.rate}%</b> hit 2x <small>· {tape.stats.hit2}/{tape.stats.calls} calls 7d</small>
        </span>
      )}
      <div className="wx-tp-viewport">
        {items.length ? (
          <div className="wx-tp-track" style={{ animationDuration: `${seconds}s` }}>
            {[0, 1].map((n) => (
              <div className="wx-tp-run" key={n} aria-hidden={n === 1}>
                {items.map((it) => <span key={`${n}-${it.key}`}>{it.node}</span>)}
              </div>
            ))}
          </div>
        ) : (
          <span className="wx-tp-empty">{ok ? "Scanning every chain…" : "Tape delayed"}</span>
        )}
      </div>
      <a className="wx-tp-tg" href={TG_URL} target="_blank" rel="noopener noreferrer" aria-label="Wraith Portal on Telegram" title="Join the Wraith Portal on Telegram">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#27a7e7" /><path fill="#fff" d="M17.9 7.3 15.600 17c-.2.700-.6.800-1.200.5l-3.300-2.400-1.600 1.500c-.2.200-.3.300-.7.300l.3-3.400 6.100-5.500c.3-.2-.1-.4-.4-.2l-7.500 4.700-3.200-1c-.7-.2-.7-.7.100-1l12.600-4.800c.600-.2 1.100.1.900 1z" /></svg>
        <span>Portal</span>
      </a>
    </footer>
  );
}
