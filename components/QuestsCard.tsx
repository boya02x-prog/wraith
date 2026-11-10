"use client";
// Small points card on the profile page; the full page is /app/quests.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Gift } from "lucide-react";

type Me = { points: number; rank: number | null; estimatedTokens: number; refActive: number };

export default function QuestsCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [tasksLeft, setTasksLeft] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/quests", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { me?: Me; tasks?: { doneAt: number | null }[] }) => {
        if (!alive || !j.me) return;
        setMe(j.me);
        setTasksLeft((j.tasks ?? []).filter((t) => !t.doneAt).length);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!me) return null;
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  return (
    <section className="profile-panel" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderColor: "rgba(var(--accent-rgb), .35)" }}>
      <Gift size={22} style={{ color: "var(--accent)" }} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11, letterSpacing: ".1em", color: "var(--accent)" }}>OMEN AIRDROP POINTS</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{n(me.points)} <span style={{ fontSize: 13, color: "#8d8d8d", fontWeight: 500 }}>{me.rank ? `· rank #${n(me.rank)}` : ""} · est. {n(me.estimatedTokens)} OMEN</span></div>
        <div style={{ fontSize: 12.5, color: "#8d8d8d" }}>{tasksLeft ? `${tasksLeft} task${tasksLeft > 1 ? "s" : ""} left to complete` : "All tasks done. Keep trading and inviting."}</div>
      </div>
      <Link className="profile-action" href="/app/quests" style={{ padding: "9px 14px", borderRadius: 10, background: "var(--accent)", color: "#0c0c0c", fontWeight: 700, fontSize: 13 }}>Open quests</Link>
    </section>
  );
}
