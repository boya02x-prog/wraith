"use client";

// "Your rank" under the Leaderboard title: where you stand among everyone who has traded on Wraith in the period chosen above, your profit for it, and a
// line of analysis (how many traders you are ahead of, win rate, trades). The same row sits at the top of Fomo's leaderboard. Nothing is drawn when
// you are signed out. Counted over everybody who has closed a trade, even people who are not shown on the board (app/api/traders/rank).
import Link from "next/link";
import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { useCash } from "@/lib/cash";
import { defaultAvatar } from "@/lib/defaultArt";
import { readHeaderProfile } from "@/lib/profileCache";
import { swrPeek, swrWrite } from "@/lib/swrCache";

export type RankPeriod = "d1" | "d7" | "d30" | "all";
type Rank = { rank: number | null; of: number; pnlSol: number; closed: number; winRate: number | null; bestPct: number; topPct: number | null; publicTrading: boolean };
const NAME: Record<RankPeriod, string> = { d1: "24 hours", d7: "7 days", d30: "30 days", all: "all time" };

export default function YourRank({ period }: { period: RankPeriod }) {
  const { money } = useCash();
  const [res, setRes] = useState<{ period: RankPeriod; d: Rank } | null>(() => { const d = swrPeek<Rank>(`rank:${period}`); return d ? { period, d } : null; }); // (coming back to the screen shows the last answer at once)
  const [hide, setHide] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/traders/rank?period=${period}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: Rank) => { if (alive) { swrWrite(`rank:${period}`, d); setRes({ period, d }); setHide(false); } })
        .catch(() => { if (alive) setHide(true); }); // signed out, or the number could not be worked out: no row
    void load();
    window.addEventListener("wraith:refresh", load);
    return () => { alive = false; window.removeEventListener("wraith:refresh", load); };
  }, [period]);

  if (hide) return null;
  if (!res) return <div className="yr yr-sk" aria-hidden="true"><i /></div>;

  const { d } = res;
  const me = readHeaderProfile(); // (only read once the answer is here, which is after the page has loaded in the browser)
  const avatar = me?.avatar || defaultAvatar(me?.uid || me?.username || "wraith");
  const tone = d.pnlSol > 0 ? "up" : d.pnlSol < 0 ? "down" : "flat";
  // rounded down, and never "100%" unless you really are first (being 12th of 200,000 is ahead of 99%, not of everyone)
  const ahead = d.rank && d.of > 1 ? (d.rank === 1 ? 100 : Math.min(99, Math.floor((1 - (d.rank - 1) / d.of) * 100))) : null;
  const share = async () => {
    const text = d.rank ? `I'm #${d.rank.toLocaleString("en-US")} of ${d.of.toLocaleString("en-US")} traders on Wraith (${NAME[period]}).` : "Trading on Wraith.";
    const url = me?.username ? `https://www.wraith.farm/app/u/${encodeURIComponent(me.username)}` : "https://www.wraith.farm";
    try {
      if (navigator.share) await navigator.share({ title: "Wraith leaderboard", text, url });
      else await navigator.clipboard.writeText(`${text} ${url}`);
    } catch { /* cancelled */ }
  };

  // nobody has a rank until their first closed trade: that card is its own, simpler layout (no PnL column, no share button) so "Unranked" never wraps
  const unranked = !d.rank;
  // "Start trading" means the Market section: say so before the screen opens, or it opens on whatever section was open last (Intel) while the bottom bar still shows Traders
  const goMarket = () => {
    try { localStorage.setItem("wraith_home_view", "market"); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent("wraith:view", { detail: "market" }));
    window.dispatchEvent(new CustomEvent("wraith:view-changed", { detail: "market" }));
  };
  return (
    <section className={`yr${unranked ? " yr-new" : ""}${res.period !== period ? " stale" : ""}`} aria-label="Your rank">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="yr-av" src={avatar} alt="" draggable={false} />
      <div className="yr-who">
        <small>Your rank{d.rank ? ` · ${d.of.toLocaleString("en-US")} traders` : ""}</small>
        {d.rank ? <b><i>#</i>{d.rank.toLocaleString("en-US")}</b> : <b>Unranked</b>}
      </div>
      {!unranked && (
        <>
          <button type="button" className="yr-share" onClick={() => void share()} aria-label="Share your rank"><Share2 size={17} /></button>
          <div className="yr-pnl">
            <small>PnL · {NAME[period]}</small>
            <strong className={tone}>{money(d.pnlSol, true)}</strong>
          </div>
        </>
      )}
      {d.rank && ahead !== null ? (
        <div className="yr-note">
          <span className="yr-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, ahead)}%` }} /></span>
          <span className="yr-txt">
            <span>
              Ahead of {ahead}% of traders{d.topPct !== null && d.topPct <= 50 ? ` · top ${d.topPct}%` : ""}
              {d.winRate !== null ? ` · ${Math.round(d.winRate)}% win rate` : ""} · {d.closed} {d.closed === 1 ? "trade" : "trades"}
            </span>
            {!d.publicTrading && <em>Only you see this. <Link href="/app/profile">Show me on the board</Link></em>}
          </span>
        </div>
      ) : unranked ? (
        <div className="yr-note yr-go">
          <span className="yr-txt"><span>Close your first trade to get on the board. Paper trades count.</span></span>
          <Link href="/app" className="yr-cta" onClick={goMarket}>Start trading</Link>
        </div>
      ) : (
        <p className="yr-note"><span>You are the only trader on the board so far.</span></p>
      )}
    </section>
  );
}
