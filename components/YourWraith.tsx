"use client";

// Everyone's own Wraith (lib/wraithPet.ts decides how it looks and how it feels, lib/wraithPet3d.ts draws it): a small 3D character whose colour, body, hat and
// face come from the account and its trades, and whose mood follows the money in the wallet, this week's profit or loss, the win rate and the place on the board.
//  - <YourWraith> is yours: it reads your numbers itself and sits on the Market screen (top of the left panel on a computer, top of the list on a phone).
//  - <WraithPetCard> is the same card for anyone else's numbers (a trader's profile).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import Wraith3D from "@/components/Wraith3D";
import { useCash } from "@/lib/cash";
import { nextUnlock } from "@/lib/tradeStreak";
import { genomeOf, lookOf, moodOf, petKey, type PetLook, type PetStats } from "@/lib/wraithPet";
import { loadHeaderProfile, readHeaderProfile } from "@/lib/profileCache";
import { swrPeek, swrWrite } from "@/lib/swrCache";

const WIDE = "(min-width: 1100px)";
function subWide(cb: () => void) { const mq = window.matchMedia(WIDE); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); }
/** true where the left panel of the Market screen is shown (1100px and wider) */
export function useWide(): boolean {
  return useSyncExternalStore(subWide, () => window.matchMedia(WIDE).matches, () => false);
}

/** how far back the camera sits for a pet: a wizard hat or a pair of bunny ears reaches much higher than a bare head */
function framing(l: PetLook): { zoom: number; lift: number } {
  if (l.hat === "wizard" || l.hat === "bunny") return { zoom: 0.7, lift: 0.56 };
  if (l.aura === "rain") return { zoom: 0.76, lift: 0.5 };
  if (l.hat === "crown" || l.hat === "antenna" || l.hat === "sprout" || l.hat === "party" || l.hat === "halo" || l.hat === "horns" || l.aura === "coins" || l.aura === "hearts") return { zoom: 0.8, lift: 0.42 };
  return { zoom: 0.86, lift: 0.34 };
}

/** the big view of a pet: tap the little one and it comes up large on its own stage (a separate 3D scene, so the card's keeps running) */
function PetViewer({ look, hue, title, name, line, chips, facts, onClose }: { look: PetLook; hue: number; title: string; name: string; line: string; chips: { t: string; earned: boolean }[]; facts: { k: string; v: string }[]; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);
  const { zoom, lift } = framing(look);
  // (a slightly different zoom is a different scene key: the card keeps its own scene and canvas)
  return createPortal(
    <div className="pv" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="pv-card" onClick={(e) => e.stopPropagation()} style={{ "--pet-hue": `${Math.round(hue * 360)}deg` } as React.CSSProperties}>
        <button type="button" className="pv-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="pv-stage">
          <Wraith3D pose="wave" podium={0} confetti={0} spotlight={false} zoom={+(zoom * 1.12).toFixed(3)} lift={lift} pet={look} poster="/mascot/wraith-wave.webp" alt={`${title}: ${name}`} />
          <span className="pv-hint">Move around or tap it</span>
        </div>
        <div className="pv-info">
          <small>{title}</small>
          <b>{name}</b>
          <p>{line}</p>
          {chips.length > 0 && <div className="yw-chips">{chips.map((c) => <span key={c.t} className={c.earned ? "earned" : undefined}>{c.t}</span>)}</div>}
          {facts.length > 0 && <dl className="pv-facts">{facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}</dl>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function WraithPetCard({ seed, stats, title, variant, fmtMoney, streak }: { seed: string; stats: PetStats | null; title: string; variant: "rail" | "card" | "profile"; fmtMoney?: (sol: number) => string; /** current streak in days, shown as a fact */ streak?: number }) {
  const read = useMemo(() => {
    const g = genomeOf(seed, stats);
    const m = moodOf(stats, fmtMoney, variant === "profile" ? "they" : "you");
    return { g, m, look: lookOf(g, m.mood, stats) };
  }, [seed, stats, fmtMoney, variant]);
  // the 3D scene is rebuilt only when what it shows really changes: the same look keeps the same object
  const key = petKey(read.look);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => read.look, [key]);
  const { zoom, lift } = framing(look);
  const closed = stats?.closed ?? 0;
  // (the narrow left panel has room for the one thing it earned, nothing more)
  const earnedChips = read.g.earned.slice(0, variant === "rail" ? 1 : 2).map((t) => ({ t, earned: true }));
  const chips = variant === "rail" ? earnedChips : [...earnedChips, { t: closed ? `${closed} ${closed === 1 ? "trade" : "trades"}` : "No trades yet", earned: false }];
  const [big, setBig] = useState(false);
  const facts: { k: string; v: string }[] = [];
  if (closed) facts.push({ k: "Trades", v: String(closed) });
  if (stats?.winRate != null) facts.push({ k: "Win rate", v: `${Math.round(stats.winRate)}%` });
  if (stats?.rank != null && stats.of) facts.push({ k: "Rank", v: `#${stats.rank} of ${stats.of}` });
  if (stats?.bestPct) facts.push({ k: "Best call", v: `+${Math.round(stats.bestPct)}%` });
  if (streak) facts.push({ k: "Streak", v: `${streak} ${streak === 1 ? "day" : "days"}` });
  const nu = title === "Your Wraith" ? nextUnlock(stats?.streak ?? 0) : null;
  return (
    <section className={`yw yw-${variant}`} aria-label={title}>
      {big && <PetViewer look={look} hue={look.hue} title={title} name={read.m.title} line={read.m.line} chips={[...earnedChips, ...read.g.earned.slice(earnedChips.length).map((t) => ({ t, earned: true }))]} facts={facts} onClose={() => setBig(false)} />}
      <div className="yw-pet" role="button" tabIndex={0} aria-label={`Look at ${title} up close`} onClick={() => setBig(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBig(true); } }} style={{ "--pet-hue": `${Math.round(look.hue * 360)}deg` } as React.CSSProperties}>
        <span className="yw-zoom" aria-hidden="true"><Maximize2 size={12} /></span>
        <Wraith3D pose="wave" podium={0} confetti={0} spotlight={false} zoom={zoom} lift={lift} pet={look} poster="/mascot/wraith-wave.webp" alt={`${title}: ${read.m.title}`} />
      </div>
      <div className="yw-info">
        <small>{title}</small>
        <b>{read.m.title}</b>
        <p>{read.m.line}</p>
        {nu && <p className="yw-next">Trade {nu.left} more {nu.left === 1 ? "day" : "days"} in a row to unlock {nu.label.toLowerCase()}.</p>}
        {chips.length > 0 && <div className="yw-chips">{chips.map((c) => <span key={c.t} className={c.earned ? "earned" : undefined}>{c.t}</span>)}</div>}
      </div>
    </section>
  );
}

type Rank = { rank: number | null; of: number; pnlSol: number; closed: number; winRate: number | null; bestPct: number; topPct: number | null; petClaimed?: boolean; streak?: number; bestStreak?: number };

/** the cash the header already works out and remembers (see EmbeddedWalletBalanceChip): read here, never asked from the chains again */
function cashNow(): number | null {
  try {
    const j: unknown = JSON.parse(localStorage.getItem("wraith_cash_cache_v1") || "null");
    const per = (j as { per?: Record<string, unknown> } | null)?.per;
    if (!per || typeof per !== "object") return null;
    let t = 0, any = false;
    for (const v of Object.values(per)) if (typeof v === "number" && Number.isFinite(v)) { t += v; any = true; }
    return any ? t : null;
  } catch { return null; }
}

export default function YourWraith({ variant }: { variant: "rail" | "card" | "profile" }) {
  const { money } = useCash();
  const [seed, setSeed] = useState<string | null>(null);
  const [rank, setRank] = useState<Rank | null>(() => swrPeek<Rank>("pet:rank") ?? null);
  const [hide, setHide] = useState(false);
  const [cash, setCash] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      const p = readHeaderProfile();
      const id = p?.uid || p?.username;
      if (id) { if (alive) setSeed(id); return; }
      void loadHeaderProfile().then((q) => { const k = q?.uid || q?.username; if (alive && k) setSeed(k); });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/traders/rank?period=d7", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Rank>) : Promise.reject()))
        .then((d) => { if (alive) { swrWrite("pet:rank", d); setRank(d); setHide(false); } })
        .catch(() => { if (alive) setHide(true); }); // signed out, or it could not be worked out: no pet
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    window.addEventListener("wraith:refresh", load);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener("wraith:refresh", load); };
  }, []);

  useEffect(() => {
    const read = () => setCash(cashNow());
    const first = window.setTimeout(read, 300);
    const t = window.setInterval(read, 5000);
    return () => { window.clearTimeout(first); window.clearInterval(t); };
  }, []);

  const stats = useMemo<PetStats | null>(() => (rank ? { closed: rank.closed, winRate: rank.winRate, pnlSol: rank.pnlSol, bestPct: rank.bestPct, topPct: rank.topPct, rank: rank.rank, of: rank.of, cashUsd: cash, streak: rank.bestStreak ?? 0 } : null), [rank, cash]);
  // (before the SOL price has loaded the money formatter has no figure to give: say it in SOL instead of printing a dash)
  const fmt = useMemo(() => (sol: number) => { const s = money(sol); return /\d/.test(s) ? s : `${sol.toFixed(2)} SOL`; }, [money]);
  const [claiming, setClaiming] = useState(false);
  const [claimErr, setClaimErr] = useState("");
  if (hide || !seed || !rank) return null;
  // it is earned, then claimed: nothing hatches until you have made a trade and tapped Claim
  if (!rank.petClaimed) {
    const ready = rank.closed > 0;
    const claim = () => {
      setClaiming(true); setClaimErr("");
      fetch("/api/user/pet", { method: "POST" })
        .then(async (r) => { if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "Could not claim it."); const d = { ...rank, petClaimed: true }; swrWrite("pet:rank", d); setRank(d); })
        .catch((e: unknown) => setClaimErr(e instanceof Error ? e.message : "Could not claim it."))
        .finally(() => setClaiming(false));
    };
    return (
      <section className={`yw yw-${variant} yw-egg`} aria-label="Your Wraith">
        <div className="yw-pet yw-pet-egg" aria-hidden="true"><span className="yw-egg-shape" /></div>
        <div className="yw-info">
          <small>Your Wraith</small>
          <b>{ready ? "It is ready" : "Still an egg"}</b>
          <p>{ready ? "You made your first trade. Claim your Wraith." : "Make your first trade to claim your own Wraith."}</p>
          {ready && <button type="button" className="yw-claim" onClick={claim} disabled={claiming}>{claiming ? "Claiming…" : "Claim your Wraith"}</button>}
          {claimErr && <p className="yw-err">{claimErr}</p>}
        </div>
      </section>
    );
  }
  return <WraithPetCard seed={seed} stats={stats} title="Your Wraith" variant={variant} fmtMoney={fmt} streak={rank.streak ?? 0} />;
}

