"use client";
// Admin: the paper auto-trader lab. Shows, for three trading styles, what a bot that bought every Wraith call (virtual $10 each, fees included) is
// doing so far. The point is an honest answer to "would auto-trading earn anything?" before any real money goes near it.
import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import type { LabReport } from "@/lib/autoLab";
import LabView from "@/components/LabView";

export default function AdminLab() {
  const [d, setD] = useState<LabReport | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    const load = () => fetch("/api/admin/lab", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on) { setD(j); setErr(!j); } }).catch(() => { if (on) setErr(true); });
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { on = false; window.clearInterval(t); };
  }, []);
  return (
    <section className="q-card ad-card" id="lab">
      <h2><FlaskConical size={16} /> Auto-trader lab (paper money)</h2>
      <p className="q-note">A simulated auto-trader that &quot;buys&quot; every Wraith call the moment it appears ({d ? `$${d.sizeUsd}` : "$10"} of pretend money each, trading fees and slippage included) and sells by three styles&apos; rules. No real money, no wallet. It runs on live calls so we learn, with real numbers, whether auto-trading would earn anything <b>before</b> anyone&apos;s money is put on it.</p>
      {err && !d ? <p className="q-note">Could not load the lab right now.</p> : !d ? <div className="wsk-b" style={{ height: 140, borderRadius: 12 }} /> : <LabView d={d} />}
    </section>
  );
}
