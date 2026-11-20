"use client";
// Admin: the paper auto-trader lab. Shows, for three trading styles, what a bot that bought every Wraith call (virtual $10 each, fees included) is
// doing so far. The point is an honest answer to "would auto-trading earn anything?" before any real money goes near it.
import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";

type S = { style: string; label: string; blurb: string; open: number; closed: number; wins: number; avg: number | null; low: number | null; high: number | null; middle: number | null; totalUsd: number; best: number | null; worst: number | null; top: { closed: number; avg: number | null; low: number | null; high: number | null } };
type R = { styles: S[]; sizeUsd: number; since: number | null; recent: { symbol: string; style: string; net: number; reason: string; at: number }[] };
const pct = (v: number | null, d = 1) => (v === null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const usd = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}`;
const WHY: Record<string, string> = { tp: "target", stop: "stop", trail: "trailing stop", time: "time", rug: "token vanished" };

export default function AdminLab() {
  const [d, setD] = useState<R | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    const load = () => fetch("/api/admin/lab", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on) { setD(j); setErr(!j); } }).catch(() => { if (on) setErr(true); });
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { on = false; window.clearInterval(t); };
  }, []);
  const days = d?.since ? Math.max(1, Math.round((Date.now() - d.since) / 86_400_000)) : 0;
  return (
    <section className="q-card ad-card" id="lab">
      <h2><FlaskConical size={16} /> Auto-trader lab (paper money)</h2>
      <p className="q-note">A simulated auto-trader that &quot;buys&quot; every Wraith call the moment it appears ({d ? `$${d.sizeUsd}` : "$10"} of pretend money each, trading fees and slippage included) and sells by three styles&apos; rules. No real money, no wallet. It runs on live calls so we learn, with real numbers, whether auto-trading would earn anything <b>before</b> anyone&apos;s money is put on it.</p>
      {err && !d ? <p className="q-note">Could not load the lab right now.</p> : !d ? <div className="wsk-b" style={{ height: 140, borderRadius: 12 }} /> : (
        <>
          <div className="lab-grid">
            {d.styles.map((s) => {
              const verdict = s.closed < 30 ? "Too early to say" : s.low !== null && s.low > 0 ? "Earning, range above zero" : s.high !== null && s.high < 0 ? "Losing, range below zero" : "Not proven: range includes zero";
              return (
                <div key={s.style} className="lab-card">
                  <b>{s.label}</b><small>{s.blurb}</small>
                  <div className={`lab-avg ${s.avg !== null && s.avg >= 0 ? "up" : "down"}`}>{pct(s.avg)}<i>average per trade</i></div>
                  <div className="lab-rows">
                    <span>Trades finished<b>{s.closed}</b></span>
                    <span>Win rate<b>{s.closed ? `${Math.round((s.wins / s.closed) * 100)}%` : "–"}</b></span>
                    <span>Typical trade<b>{pct(s.middle, 0)}</b></span>
                    <span>Range of the average<b>{s.low === null ? "–" : `${pct(s.low, 0)} to ${pct(s.high, 0)}`}</b></span>
                    <span>Pretend profit<b className={s.totalUsd >= 0 ? "g" : "r"}>{usd(s.totalUsd)}</b></span>
                    <span>Still open<b>{s.open}</b></span>
                    <span>Only the best calls (score 75+)<b>{s.top.closed ? `${pct(s.top.avg)} (${s.top.closed} trades)` : "–"}</b></span>
                  </div>
                  <em className="lab-verdict">{verdict}</em>
                </div>
              );
            })}
          </div>
          <p className="q-note">{d.since ? `Running for about ${days} day${days > 1 ? "s" : ""}. ` : "Waiting for the first call. "}It needs 30+ finished trades per style before a number means anything, and a range that includes zero is a coin flip minus fees. The lab checks prices about every 2 minutes; a real bot would watch closer, so real results could differ either way.</p>
          {d.recent.length > 0 && (
            <div className="lab-recent">
              {d.recent.map((t, i) => <span key={i} className={t.net >= 0 ? "g" : "r"}>${t.symbol} {t.style} {pct(t.net, 0)} <i>{WHY[t.reason] ?? t.reason}</i></span>)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
