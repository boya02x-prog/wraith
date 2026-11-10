"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Users } from "lucide-react";
import Header from "@/components/Header";
import TraderFollowButton from "@/components/TraderFollowButton";
import PhotoViewer from "@/components/PhotoViewer";
import Radar from "@/components/Radar";
import { useCash } from "@/lib/cash";
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
const PERIODS: { key: Period; label: string; long: string }[] = [
  { key: "all", label: "All", long: "All-time" },
  { key: "d1", label: "24H", long: "Daily" },
  { key: "d7", label: "7D", long: "Weekly" },
  { key: "d30", label: "30D", long: "Monthly" },
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
  const [viewer, setViewer] = useState<string | null>(null);
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

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="profile-shell traders-shell">
        <section className="traders-heading">
          <span className="profile-eyebrow">WRAITH COMMUNITY</span>
          <h1>{periodMeta.long} ranking</h1>
          <p>Who is making money, and what they are good at.</p>
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
        {viewer && <PhotoViewer src={viewer} onClose={() => setViewer(null)} />}
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
          <div className={`traders-grid${layout === "list" ? " is-list" : ""}`}>
            {sorted.map((trader, index) => {
              const s = trader.stats;
              const pnl = gain(trader, period);
              const tone = pnl > 0 ? "up" : pnl < 0 ? "down" : "flat";
              const podium = index < 3 ? ` podium-${index + 1}` : "";
              return (
                <article className={`tc${podium}`} key={trader.userId}>
                  <Ghost className="tc-ghost" />
                  <div className="tc-main">
                    <span className="tc-rank">{index + 1}</span>
                    {trader.avatarDataUrl ? (
                      <Image className="tc-avatar wx-tappable" src={trader.avatarDataUrl} alt="" width={46} height={46} unoptimized onClick={() => setViewer(trader.avatarDataUrl)} />
                    ) : (
                      <span className="tc-avatar tc-avatar-fallback">{trader.displayName.slice(0, 1).toUpperCase()}</span>
                    )}
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
                      <small>{periodMeta.label} GAIN</small>
                      <strong className={tone}>{money(pnl, true)}</strong>
                      <Spark curve={s?.curve ?? []} />
                    </div>
                    <Radar values={s?.radar.map((p) => p.value) ?? [0, 0, 0, 0, 0, 0]} size={92} />
                  </div>

                  <div className="tc-foot">
                    <span><small>WIN</small><b>{s?.winRate == null ? "-" : `${s.winRate.toFixed(0)}%`}</b></span>
                    <span><small>TRADES</small><b>{trader.closedTradeCount}</b></span>
                    <span><small>BEST</small><b>{s && s.bestPct > 0 ? fmtMult(s.bestPct) : "-"}</b></span>
                    <span><small>HOLD</small><b>{fmtHold(s?.avgHoldMs ?? null)}</b></span>
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
          </div>
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
