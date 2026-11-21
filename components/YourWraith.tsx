"use client";

// Everyone's own Wraith (lib/wraithPet.ts decides how it looks and how it feels, lib/wraithPet3d.ts draws it): a small 3D character whose colour, body, hat and
// face come from the account and its trades, and whose mood follows the money in the wallet, this week's profit or loss, the win rate and the place on the board.
//  - <YourWraith> is yours: it reads your numbers itself and sits on the Market screen (top of the left panel on a computer, top of the list on a phone).
//  - <WraithPetCard> is the same card for anyone else's numbers (a trader's profile).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Wraith3D from "@/components/Wraith3D";
import { useCash } from "@/lib/cash";
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

export function WraithPetCard({ seed, stats, title, variant, fmtMoney }: { seed: string; stats: PetStats | null; title: string; variant: "rail" | "card" | "profile"; fmtMoney?: (sol: number) => string }) {
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
  return (
    <section className={`yw yw-${variant}`} aria-label={title}>
      <div className="yw-pet" style={{ "--pet-hue": `${Math.round(look.hue * 360)}deg` } as React.CSSProperties}>
        <Wraith3D pose="wave" podium={0} confetti={0} spotlight={false} zoom={zoom} lift={lift} pet={look} poster="/mascot/wraith-wave.webp" alt={`${title}: ${read.m.title}`} />
      </div>
      <div className="yw-info">
        <small>{title}</small>
        <b>{read.m.title}</b>
        <p>{read.m.line}</p>
        {chips.length > 0 && <div className="yw-chips">{chips.map((c) => <span key={c.t} className={c.earned ? "earned" : undefined}>{c.t}</span>)}</div>}
      </div>
    </section>
  );
}

type Rank = { rank: number | null; of: number; pnlSol: number; closed: number; winRate: number | null; bestPct: number; topPct: number | null };

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

  const stats = useMemo<PetStats | null>(() => (rank ? { closed: rank.closed, winRate: rank.winRate, pnlSol: rank.pnlSol, bestPct: rank.bestPct, topPct: rank.topPct, rank: rank.rank, of: rank.of, cashUsd: cash } : null), [rank, cash]);
  // (before the SOL price has loaded the money formatter has no figure to give: say it in SOL instead of printing a dash)
  const fmt = useMemo(() => (sol: number) => { const s = money(sol); return /\d/.test(s) ? s : `${sol.toFixed(2)} SOL`; }, [money]);
  if (hide || !seed || !rank) return null;
  return <WraithPetCard seed={seed} stats={stats} title="Your Wraith" variant={variant} fmtMoney={fmt} />;
}

