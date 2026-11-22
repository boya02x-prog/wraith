"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Users } from "lucide-react";
import Header from "@/components/HeaderSlot";
import DiscoverNav from "@/components/DiscoverNav";
import TraderFollowButton from "@/components/TraderFollowButton";
import HotShots from "@/components/HotShots";
import TraderBoards from "@/components/TraderBoards";
import YourRank from "@/components/YourRank";
import Frame, { frameGlow } from "@/components/Frame";
import Radar from "@/components/Radar";
import { useCash } from "@/lib/cash";
import { defaultAvatar } from "@/lib/defaultArt";
import PetStill from "@/components/PetStill";
import { readLast, writeLast } from "@/lib/lastGood";
import { fmtHold, fmtMult, type TraderStatsResult } from "@/lib/traderStats";

type Trader = {
  isFollowing?: boolean;
  userId: string;
  username?: string | null;
  displayName: string;
  bio: string;
  xHandle: string;
  avatarDataUrl: string;
  frame?: string;
  petClaimed?: boolean;
  hasCover?: boolean;
  closedTradeCount: number;
  openPositionCount: number;
  profitSol: number;
  stats?: TraderStatsResult;
  openPositions: {
    symbol?: string;
    mint?: string;
  }[];
};

type Period = "d1" | "d7" | "d30" | "all";
const PERIODS: { key: Period; label: string; long: string; when: string }[] = [
  { key: "all", label: "All", long: "All-time", when: "of all time" },
  { key: "d1", label: "24H", long: "Daily", when: "today" },
  { key: "d7", label: "7D", long: "Weekly", when: "this week" },
  { key: "d30", label: "30D", long: "Monthly", when: "this month" },
];

function Ghost({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 80" aria-hidden="true">
      <path d="M32 4C16 4 6 16 6 34v38l9-7 8 8 9-8 9 8 8-8 9 7V34C58 16 48 4 32 4Z" fill="currentColor" />
      <ellipse cx="22" cy="34" rx="6" ry="3.2" fill="#000" opacity=".55" />
      <ellipse cx="42" cy="34" rx="6" ry="3.2" fill="#000" opacity=".55" />
    </svg>
  );
}

function Spark({ curve }: { curve: number[] }) {
  if (curve.length < 2) return <svg className="tc-spark tone-flat" viewBox="0 0 100 28" preserveAspectRatio="none"><line x1="0" x2="100" y1="14" y2="14" /></svg>;
  const min = Math.min(...curve), max = Math.max(...curve);
  const span = max - min || 1;
  const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * 100},${26 - ((v - min) / span) * 24}`).join(" ");
  const tone = curve[curve.length - 1] >= 0 ? "up" : "down";
  return (
    <svg className={`tc-spark tone-${tone}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function TradersPage() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [sort, setSort] = useState<"pnl" | "active" | "open" | "following">("pnl");
  const [period, setPeriod] = useState<Period>("d7");
  const [layout, setLayout] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem("wraith:traders-layout") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const pickLayout = (v: "grid" | "list") => { setLayout(v); try { localStorage.setItem("wraith:traders-layout", v); } catch { /* optional */ } };
  const { money } = useCash();

  const gain = (t: Trader, p: Period) => t.stats?.pnlSol[p] ?? (p === "all" ? t.profitSol : 0);

  const sorted = useMemo(() => {
    const list = sort === "following" ? traders.filter((t) => t.isFollowing === true) : [...traders];
    if (sort === "active") list.sort((a, b) => b.closedTradeCount + b.openPositionCount - (a.closedTradeCount + a.openPositionCount));
    else if (sort === "open") list.sort((a, b) => b.openPositionCount - a.openPositionCount || gain(b, period) - gain(a, period));
    else list.sort((a, b) => gain(b, period) - gain(a, period));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traders, sort, period]);

  useEffect(() => {
    let active = true;
    // show the last saved ranking instantly (and when offline), then refresh in the background
    const saved = readLast<Trader[]>("traders");
    if (saved?.length) { setTraders(saved); setLoading(false); }
    const load = () =>
      fetch("/api/traders")
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Could not load traders.");
          if (!active) return;
          const list: Trader[] = payload.traders ?? [];
          setTraders(list);
          setError("");
          setStale(false);
          writeLast("traders", list);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          // keep whatever is already on screen; only show an error when there is nothing to show
          setStale(true);
          setTraders((cur) => {
            if (!cur.length) setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "No connection. Pull down to retry.");
            return cur;
          });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    void load();
    const onBack = () => void load();
    window.addEventListener("online", onBack);
    window.addEventListener("wraith:refresh", onBack);
    return () => {
      active = false;
      window.removeEventListener("online", onBack);
      window.removeEventListener("wraith:refresh", onBack);
    };
  }, []);

  const periodMeta = PERIODS.find((p) => p.key === period)!;
  // the banner shows the period's five best (whatever chip is chosen, except Following); on the Top gains list those five are not repeated in the cards
  const byGain = useMemo(() => [...traders].sort((a, b) => gain(b, period) - gain(a, period)), [traders, period]);
  const bannerOn = sort !== "following" && byGain.length > 0;
  const bannerN = Math.min(5, byGain.length);
  const skipTop = bannerOn && sort === "pnl" ? bannerN : 0;
  // the Most followed / Top earners boards sit between the banner and the cards: whoever is on show there is not listed a second time below
  // (the cards keep their real rank number, so a gap just means "that one is above")
  const [boardIds, setBoardIds] = useState<string[]>([]);
  const inBoards = useMemo(() => new Set(boardIds), [boardIds]);
  const rankOf = useMemo(() => new Map(sorted.map((t, i) => [t.userId, i] as const)), [sorted]);
  const rest = skipTop ? sorted.slice(skipTop).filter((t) => !inBoards.has(t.userId)) : sorted;

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <DiscoverNav active="traders" />
      <div className="profile-shell traders-shell">
        <section className="traders-heading">
          <h1>Leaderboard</h1>
          <div className="tc-bar">
          <div className="tc-periods" role="tablist" aria-label="Ranking period">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" role="tab" aria-selected={period === p.key} className={period === p.key ? "on" : ""} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="tc-layout" role="group" aria-label="Layout">
            <button type="button" aria-label="Grid view" aria-pressed={layout === "grid"} className={layout === "grid" ? "on" : ""} onClick={() => pickLayout("grid")}><LayoutGrid size={15} /></button>
            <button type="button" aria-label="List view" aria-pressed={layout === "list"} className={layout === "list" ? "on" : ""} onClick={() => pickLayout("list")}><List size={15} /></button>
          </div>
          </div>
          <div className="trader-tabs" role="tablist">
            {([["pnl", "Top gains"], ["active", "Most active"], ["open", "Live now"], ["following", `Following${traders.some((t) => t.isFollowing === true) ? ` ${traders.filter((t) => t.isFollowing === true).length}` : ""}`]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={sort === key} className={sort === key ? "on" : ""} onClick={() => setSort(key)}>{label}</button>
            ))}
          </div>
        </section>
        <YourRank period={period} />
        {stale && traders.length > 0 && <div className="profile-message" style={{ fontSize: 12 }}>Offline: showing the last saved ranking.</div>}
        {error && !traders.length && <div className="profile-message is-error">{error}</div>}
        {loading ? (
          <div className="traders-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="trader-card trader-card-skeleton" key={index} />
            ))}
          </div>
        ) : sort === "following" && sorted.length === 0 ? (
          <div className="profile-panel traders-empty">
            <Users size={22} />
            <h2>You are not following anyone yet</h2>
            <p>Tap Follow on a trader to see them here and get alerts when they trade.</p>
          </div>
        ) : traders.length ? (
          <>
          {bannerOn && <HotShots list={byGain} when={periodMeta.when} gainLabel={periodMeta.key === "all" ? "all-time gain" : `${periodMeta.label.toLowerCase()} gain`} pnlOf={(t) => gain(t as Trader, period)} money={money} />}
          {bannerOn && <TraderBoards onShown={setBoardIds} />}
          {skipTop > 0 && rest.length > 0 && (
            <header className="tl-head">
              <h3>More traders</h3>
              <small>ranked by {periodMeta.key === "all" ? "all-time" : periodMeta.label.toLowerCase()} gain</small>
            </header>
          )}
          {rest.length > 0 && <div className={`traders-grid${layout === "list" ? " is-list" : ""}`}>
            {rest.map((trader, i) => {
              const index = rankOf.get(trader.userId) ?? i + skipTop;
              const s = trader.stats;
              const pnl = gain(trader, period);
              const tone = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";
              const podium = index < 3 ? ` podium-${index + 1}` : "";
              return (
                <article className={`tc${podium}`} key={trader.userId} style={frameGlow(trader.frame)}>
                  <Ghost className="tc-ghost" />
                  <div className="tc-main">
                    <span className="tc-rank">{index + 1}</span>
                    <Frame id={trader.frame} thick={2.5}>
                      {/* the same default picture as the banner, the boards and the profile (it used to be a letter here) */}
                      <Image className="tc-avatar" data-zoom src={trader.avatarDataUrl || defaultAvatar(trader.userId)} alt="" width={46} height={46} unoptimized />
                    </Frame>
                    <Link className="tc-id" href={`/app/u/${encodeURIComponent(trader.username ?? trader.userId)}`}>
                      <strong>{trader.displayName}</strong>
                      <span className="tc-tags">
                        {(s?.tags.length ? s.tags : ["Unrated"]).map((t) => (
                          <i key={t}>{t}</i>
                        ))}
                      </span>
                    </Link>
                    <span className="trader-follow"><TraderFollowButton traderId={trader.userId} compact initialFollowing={trader.isFollowing === true} statusKnown={typeof trader.isFollowing === "boolean"} /></span>
                  </div>

                  <div className="tc-body">
                    <div className="tc-pnl">
                      <small>{periodMeta.key === "all" ? "All-time gain" : `${periodMeta.label.toLowerCase()} gain`}</small>
                      <strong className={tone}>{money(pnl, true)}</strong>
                      <Spark curve={s?.curve ?? []} />
                    </div>
                    {trader.petClaimed ? <PetStill seed={trader.userId} size={62} stats={{ closed: trader.closedTradeCount, winRate: s?.winRate ?? null, pnlSol: s?.pnlSol.d7 ?? 0, bestPct: s?.bestPct ?? 0, topPct: null, rank: index < 10 ? index + 1 : null, of: 0, cashUsd: null }} /> : null}
                    <Radar values={s?.radar.map((p) => p.value) ?? [0, 0, 0, 0, 0, 0]} size={92} />
                  </div>

                  <div className="tc-foot">
                    <span><small>Win rate</small><b>{s?.winRate == null ? "-" : `${s.winRate.toFixed(0)}%`}</b></span>
                    <span><small>Trades</small><b>{trader.closedTradeCount}</b></span>
                    <span><small>Best</small><b>{s && s.bestPct > 0 ? fmtMult(s.bestPct) : "-"}</b></span>
                    <span><small>Avg hold</small><b>{fmtHold(s?.avgHoldMs ?? null)}</b></span>
                  </div>

                  {trader.openPositions.length > 0 && (
                    <div className="tc-live">
                      <i className="tc-live-dot" />
                      <span>LIVE</span>
                      {trader.openPositions.slice(0, 3).map((position) => (
                        <em key={position.mint}>{position.symbol || "Token"}</em>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>}
          </>
        ) : (
          <div className="profile-panel traders-empty">
            <Users size={22} />
            <h2>No public trader profiles yet</h2>
            <p>
              Turn on “Share my trading activity” in your profile settings to
              appear here.
            </p>
            <Link href="/app/profile">Open my profile</Link>
          </div>
        )}
      </div>
    </main>
  );
}
