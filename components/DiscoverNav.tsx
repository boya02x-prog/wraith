"use client";
// The second row under the top bar on big screens: Market · Scanner · Wins · Intel · Traders. Market to Intel are views of the Discover screen (/app),
// Traders is its own screen (/app/traders). Both screens show this same row, so you can always get from one to the other (the Traders screen had
// no row at all and was a dead end on a computer). On phones the bottom tab bar does this job and the row is hidden by CSS.
import { useRouter } from "next/navigation";

export type DiscoverView = "market" | "scanner" | "wins" | "intel";
export const DISCOVER_VIEWS: { key: DiscoverView; label: string; hint: string }[] = [
  { key: "market", label: "Market", hint: "Live Solana tokens" },
  { key: "scanner", label: "Scanner", hint: "Live momentum signals" },
  { key: "wins", label: "Wins", hint: "How our calls performed" },
  { key: "intel", label: "Intel", hint: "What traders are calling right now" },
];

export default function DiscoverNav({ active, onPick }: { active: DiscoverView | "traders"; onPick?: (v: DiscoverView) => void }) {
  const router = useRouter();
  const pick = (v: DiscoverView) => {
    if (onPick) { onPick(v); return; }
    // from another screen: remember the view, then go to Discover, which opens on it
    try { localStorage.setItem("wraith_home_view", v); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent("wraith:view-changed", { detail: v }));
    router.push("/app");
  };
  return (
    <nav className="wx-subnav" aria-label="Discover sections">
      <div className="wx-subnav-inner">
        {DISCOVER_VIEWS.map((v) => (
          <button key={v.key} type="button" data-view={v.key} className={active === v.key ? "on" : ""} aria-current={active === v.key ? "page" : undefined} onClick={() => pick(v.key)}>
            {v.label}
          </button>
        ))}
        <button type="button" data-view="traders" className={active === "traders" ? "on" : ""} aria-current={active === "traders" ? "page" : undefined} onClick={() => { if (active !== "traders") router.push("/app/traders"); }} title="Rankings and the traders you follow">Traders</button>
        <span className="wx-subnav-hint">{active === "traders" ? "Rankings and the traders you follow" : DISCOVER_VIEWS.find((v) => v.key === active)?.hint}</span>
      </div>
    </nav>
  );
}
