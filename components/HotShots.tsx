"use client";

// The banner at the top of the Leaderboard: the "hot shots" of the period as big posters (cover picture, photo with the border they picked, the
// gain in large type). On a phone the posters swipe sideways; from tablet up the first one is large and the next four sit beside it.
import Link from "next/link";
import { Crown, Flame } from "lucide-react";
import Frame, { frameGlow } from "@/components/Frame";
import TraderFollowButton from "@/components/TraderFollowButton";
import { defaultAvatar, defaultCover } from "@/lib/defaultArt";
import { fmtMult, type TraderStatsResult } from "@/lib/traderStats";

export type HotTrader = {
  userId: string;
  username?: string | null;
  displayName: string;
  avatarDataUrl: string;
  frame?: string;
  hasCover?: boolean;
  isFollowing?: boolean;
  closedTradeCount: number;
  stats?: TraderStatsResult;
};

type Money = (sol: number, signed?: boolean) => string;

function Poster({ t, rank, pnl, money, gainLabel }: { t: HotTrader; rank: number; pnl: number; money: Money; gainLabel: string }) {
  const tone = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";
  const art = t.hasCover ? `/api/traders/${t.userId}/cover` : defaultCover(t.userId);
  const photo = t.avatarDataUrl || defaultAvatar(t.userId);
  const s = t.stats;
  const tag = s?.tags?.[0] ?? (t.username ? `@${t.username}` : "Trader");
  return (
    <article className={`hs-card r${rank}`} style={frameGlow(t.frame)}>
      <div className="hs-art" style={{ backgroundImage: `url("${art}")` }} aria-hidden="true" />
      <div className="hs-shade" aria-hidden="true" />
      <Link className="hs-hit" href={`/app/u/${encodeURIComponent(t.username ?? t.userId)}`} aria-label={`${t.displayName}, number ${rank}`} />
      <span className="hs-rank">{rank === 1 && <Crown size={15} aria-hidden="true" />}#{rank}</span>
      <div className="hs-top">
        <Frame id={t.frame} thick={rank === 1 ? 4 : 3} className="hs-av">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-zoom src={photo} alt="" draggable={false} />
        </Frame>
        <div className="hs-id">
          <b>{t.displayName}</b>
          <small>{tag}</small>
        </div>
      </div>
      <div className="hs-foot">
        <div className="hs-gain">
          <strong className={tone}>{money(pnl, true)}</strong>
          <small>{gainLabel}</small>
        </div>
        <ul className="hs-stats">
          <li><b>{s?.winRate == null ? "-" : `${s.winRate.toFixed(0)}%`}</b><small>win rate</small></li>
          <li><b>{t.closedTradeCount}</b><small>trades</small></li>
          <li><b>{s && s.bestPct > 0 ? fmtMult(s.bestPct) : "-"}</b><small>best</small></li>
        </ul>
        <span className="hs-follow"><TraderFollowButton traderId={t.userId} compact initialFollowing={t.isFollowing === true} statusKnown={typeof t.isFollowing === "boolean"} /></span>
      </div>
    </article>
  );
}

export default function HotShots({ list, when, gainLabel, pnlOf, money }: { list: HotTrader[]; when: string; gainLabel: string; pnlOf: (t: HotTrader) => number; money: Money }) {
  const top = list.slice(0, 5);
  if (!top.length) return null;
  return (
    <section className="hs" aria-label={`Hot shots ${when}`}>
      <header className="hs-head">
        <Flame size={18} aria-hidden="true" />
        <h2>Hot shots <em>{when}</em></h2>
      </header>
      <div className={`hs-rail hs-n${top.length}`}>
        {top.map((t, i) => <Poster key={t.userId} t={t} rank={i + 1} pnl={pnlOf(t)} money={money} gainLabel={gainLabel} />)}
      </div>
    </section>
  );
}
