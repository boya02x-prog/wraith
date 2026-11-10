"use client";

import { defaultAvatar, defaultCover } from "@/lib/defaultArt";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import TraderFollowButton from "@/components/TraderFollowButton";
import FollowListModal from "@/components/FollowListModal";
import PnlChart from "@/components/PnlChart";
import TraderStats from "@/components/TraderStats";
import { useCash } from "@/lib/cash";
import TierGlyph from "@/components/TierGlyph";
import { GLYPH_PALETTE } from "@/lib/tierGlyph";
import { TIERS, type TierKey } from "@/lib/tiers";

type PublicPosition = {
  id?: string;
  symbol?: string;
  mint?: string;
  amountSol?: number;
  currentPnlPct?: number;
  entryMcap?: number;
  currentMcap?: number;
  ts?: number;
  imageUrl?: string;
};

type PublicTrade = {
  id?: string;
  symbol?: string;
  mint?: string;
  amountSol?: number;
  entryMcap?: number;
  exitMcap?: number;
  pnlPct?: number;
  imageUrl?: string;
  ts?: number;
  closedAt?: number;
};

type TraderDetails = {
  isSelf?: boolean;
  trader: {
    userId: string;
    username: string | null;
    displayName: string;
    bio: string;
    xHandle: string;
    avatarDataUrl: string;
    coverDataUrl?: string;
    followerCount: number;
    followingCount: number;
    tier?: TierKey;
  };
  openPositions: PublicPosition[];
  closedTrades: PublicTrade[];
};

function mcapLabel(value?: number) {
  if (!value || !Number.isFinite(value)) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function timeAgo(ts?: number) {
  if (!ts) return "—";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function PublicTraderPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [data, setData] = useState<TraderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<"followers" | "following">("followers");
  const { money } = useCash();
  const router = useRouter();
  // your own public page is just your profile: go there instead of showing yourself as a stranger with a Follow button
  useEffect(() => {
    if (data?.isSelf) router.replace("/app/profile");
  }, [data, router]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetch(`/api/traders/${encodeURIComponent(userId)}`)
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error ?? "Profile unavailable.");
        if (active) setData(payload);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Profile unavailable.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  const stats = useMemo(() => {
    if (!data) return null;
    const closed = data.closedTrades.filter((t) => typeof t.pnlPct === "number");
    const wins = closed.filter((t) => (t.pnlPct ?? 0) > 0).length;
    const winRate = closed.length ? (wins / closed.length) * 100 : null;
    const best = closed.reduce<PublicTrade | null>(
      (acc, t) => (!acc || (t.pnlPct ?? -Infinity) > (acc.pnlPct ?? -Infinity) ? t : acc),
      null,
    );
    const topCalls = [...closed]
      .sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0))
      .slice(0, 5);
    return { winRate, best, topCalls, closedCount: closed.length };
  }, [data]);

  const joinedLabel = useMemo(() => {
    if (!data) return null;
    const all = [
      ...data.closedTrades.map((t) => t.ts),
      ...data.openPositions.map((t) => t.ts),
    ].filter((ts): ts is number => typeof ts === "number");
    if (!all.length) return null;
    const oldest = Math.min(...all);
    return new Date(oldest).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }, [data]);

  const trader = data?.trader;

  if (loading) {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <div className="pub-loading">
          <div className="pub-loading-dot" />
          <div className="pub-loading-dot" />
          <div className="pub-loading-dot" />
        </div>
      </main>
    );
  }

  if (error || !trader) {
    return (
      <main className="wraith-dashboard profile-page">
        <Header />
        <div className="pub-error-shell">
          <div className="pub-error-icon">👤</div>
          <h1>Trader not found</h1>
          <p>{error || "This trader hasn't enabled public activity, or the handle doesn't exist."}</p>
          <Link href="/app/traders" className="pub-error-link">Browse traders →</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="pub-shell">

        {/* ── Hero (Fomo-style) ── */}
        <div className="pub-hero">
          <div
            className="pub-cover"
            style={
              { backgroundImage: `url("${trader.coverDataUrl || defaultCover(userId)}")`, backgroundSize: "cover", backgroundPosition: "center" }
            }
          />

          <div className="pub-identity">
            <div className="pub-avatar">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={trader.avatarDataUrl || defaultAvatar(userId)} alt="" className="pub-avatar-img" />
            </div>

            <div className="pub-id-name">
              <h1 className="pub-name" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {trader.displayName}
                {trader.tier && trader.tier !== "GHOST" && (
                  <span
                    title={`${trader.tier} tier (${TIERS[trader.tier].minTokens.toLocaleString("en-US")}+ OMEN)`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 10px 3px 6px",
                      borderRadius: 999,
                      border: `1px solid ${GLYPH_PALETTE[trader.tier].mid}66`,
                      background: `${GLYPH_PALETTE[trader.tier].mid}1a`,
                      color: GLYPH_PALETTE[trader.tier].mid,
                      fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: ".12em",
                    }}
                  >
                    <TierGlyph tier={trader.tier} size={20} />
                    {trader.tier}
                  </span>
                )}
              </h1>
              {trader.username && <p className="pub-handle">@{trader.username}</p>}
            </div>

            <div className="pub-id-right">
              <div className="pub-social">
                <button
                  type="button"
                  className="pub-social-count"
                  onClick={() => { setFollowModalTab("following"); setShowFollowModal(true); }}
                >
                  <strong>{trader.followingCount}</strong>
                  <span>Following</span>
                </button>
                <button
                  type="button"
                  className="pub-social-count"
                  onClick={() => { setFollowModalTab("followers"); setShowFollowModal(true); }}
                >
                  <strong>{trader.followerCount}</strong>
                  <span>Followers</span>
                </button>
              </div>
              <button
                type="button"
                className="pub-icon-btn"
                title={copied ? "Link copied" : "Copy profile link"}
                aria-label="Copy profile link"
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(window.location.href);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  } catch { /* ignore */ }
                }}
              >
                {copied ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                )}
              </button>
              <TraderFollowButton
                traderId={trader.userId}
                onChange={(_following, followers) => {
                  if (followers === undefined) return;
                  setData((d) => d ? { ...d, trader: { ...d.trader, followerCount: followers } } : d);
                }}
              />
            </div>

            {trader.bio && <p className="pub-bio">{trader.bio}</p>}

            <div className="pub-meta-bar">
              <span className="pub-meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                {data.closedTrades.length + data.openPositions.length} trades
              </span>
              {joinedLabel && (
                <span className="pub-meta-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Joined {joinedLabel}
                </span>
              )}
              {trader.xHandle && (
                <a
                  className="pub-meta-x pub-meta-item"
                  href={`https://x.com/${encodeURIComponent(trader.xHandle)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.632L18.244 2.25z" /></svg>
                  @{trader.xHandle}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ── Top calls: horizontal cards ── */}
        {stats && stats.topCalls.length > 0 && (
          <div className="pub-topcalls-wrap">
            <div className="pub-topcalls-head">
              <span className="pub-section-label">TOP CALLS</span>
              <span className="pub-topcalls-sub">{stats.closedCount} closed trades</span>
            </div>
            <div className="pub-topcalls-strip">
              {stats.topCalls.map((trade, i) => (
                <Link
                  key={trade.id ?? `${trade.mint}-${i}`}
                  href={`/app/token/${trade.mint}`}
                  className="pub-topcall-card"
                >
                  <div className="pub-topcall-rank">#{i + 1} Trade</div>
                  <div className="pub-topcall-img">
                    {trade.imageUrl ? (
                      <Image src={trade.imageUrl} alt="" width={36} height={36} unoptimized className="pub-topcall-photo" />
                    ) : (
                      <span className="pub-topcall-fallback">{trade.symbol?.slice(0, 1) ?? "?"}</span>
                    )}
                  </div>
                  <div className="pub-topcall-symbol">{trade.symbol ?? "TOKEN"}</div>
                  <div className={`pub-topcall-pnl${(trade.pnlPct ?? 0) >= 0 ? " is-positive" : " is-negative"}`}>
                    {(trade.pnlPct ?? 0) > 0 ? "+" : ""}{(trade.pnlPct ?? 0).toFixed(0)}%
                  </div>
                  <div className="pub-topcall-mcap">{mcapLabel(trade.entryMcap)} → {mcapLabel(trade.exitMcap)}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Stats strip ── */}
        <div className="pub-stats-strip">
          <div className="pub-stat">
            <span className="pub-stat-label">Win rate</span>
            <strong className={`pub-stat-value${stats?.winRate !== null ? (stats!.winRate! >= 50 ? " is-positive" : " is-negative") : ""}`}>
              {stats?.winRate !== null && stats?.winRate !== undefined ? `${stats.winRate.toFixed(0)}%` : "—"}
            </strong>
            <small>{stats?.closedCount ?? 0} closed</small>
          </div>
          <div className="pub-stat">
            <span className="pub-stat-label">Best call</span>
            <strong className="pub-stat-value is-positive">
              {stats?.best ? `+${(stats.best.pnlPct ?? 0).toFixed(0)}%` : "—"}
            </strong>
            <small>{stats?.best?.symbol ?? "no closes yet"}</small>
          </div>
          <div className="pub-stat">
            <span className="pub-stat-label">Open now</span>
            <strong className="pub-stat-value">{data.openPositions.length}</strong>
            <small>position{data.openPositions.length !== 1 ? "s" : ""}</small>
          </div>
          <div className="pub-stat">
            <span className="pub-stat-label">Total trades</span>
            <strong className="pub-stat-value">{data.closedTrades.length + data.openPositions.length}</strong>
            <small>live + closed</small>
          </div>
        </div>

        <TraderStats trades={data.closedTrades} money={money} title="Trader statistics" />

        {/* ── P&L sparkline ── */}
        <PnlChart trades={data.closedTrades} title="Realized P&L" />

        {/* ── Positions + History ── */}
        <div className="pub-activity">

          <div className="pub-panel">
            <div className="pub-panel-head">
              <span className="pub-section-label">OPEN NOW</span>
              <span className="pub-panel-count">{data.openPositions.length}</span>
            </div>
            {data.openPositions.length ? (
              <div className="pub-trade-list">
                {data.openPositions.map((pos, i) => (
                  <Link
                    key={pos.id ?? `${pos.mint}-${i}`}
                    href={`/app/token/${pos.mint}`}
                    className="pub-trade-row"
                  >
                    <div className="pub-trade-token">
                      {pos.imageUrl ? (
                        <Image src={pos.imageUrl} alt="" width={32} height={32} unoptimized />
                      ) : (
                        <span className="pub-trade-fallback">{pos.symbol?.slice(0, 1) ?? "?"}</span>
                      )}
                    </div>
                    <div className="pub-trade-info">
                      <strong>{pos.symbol ?? "TOKEN"}</strong>
                      <small>entry {mcapLabel(pos.entryMcap)} · now {mcapLabel(pos.currentMcap)}</small>
                    </div>
                    <span className={`pub-trade-pnl${(pos.currentPnlPct ?? 0) >= 0 ? " is-positive" : " is-negative"}`}>
                      {(pos.currentPnlPct ?? 0) > 0 ? "+" : ""}{(pos.currentPnlPct ?? 0).toFixed(1)}%
                    </span>
                    <span className="pub-trade-age">{timeAgo(pos.ts)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="pub-empty">No open positions right now</div>
            )}
          </div>

          <div className="pub-panel">
            <div className="pub-panel-head">
              <span className="pub-section-label">TRADE HISTORY</span>
              <span className="pub-panel-count">{data.closedTrades.length}</span>
            </div>
            {data.closedTrades.length ? (
              <div className="pub-trade-list">
                {data.closedTrades.slice(0, 30).map((trade, i) => (
                  <Link
                    key={trade.id ?? `${trade.mint}-${i}`}
                    href={`/app/token/${trade.mint}`}
                    className="pub-trade-row"
                  >
                    <div className="pub-trade-token">
                      {trade.imageUrl ? (
                        <Image src={trade.imageUrl} alt="" width={32} height={32} unoptimized />
                      ) : (
                        <span className="pub-trade-fallback">{trade.symbol?.slice(0, 1) ?? "?"}</span>
                      )}
                    </div>
                    <div className="pub-trade-info">
                      <strong>{trade.symbol ?? "TOKEN"}</strong>
                      <small>{mcapLabel(trade.entryMcap)} → {mcapLabel(trade.exitMcap)}</small>
                    </div>
                    <span className={`pub-trade-pnl${(trade.pnlPct ?? 0) >= 0 ? " is-positive" : " is-negative"}`}>
                      {(trade.pnlPct ?? 0) > 0 ? "+" : ""}{(trade.pnlPct ?? 0).toFixed(1)}%
                    </span>
                    <span className="pub-trade-age">{timeAgo(trade.ts)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="pub-empty">No closed trades shared yet</div>
            )}
          </div>
        </div>

      </div>

      {showFollowModal && trader && (
        <FollowListModal
          traderId={trader.userId}
          initialTab={followModalTab}
          followerCount={data.trader.followerCount}
          followingCount={data.trader.followingCount}
          onClose={() => setShowFollowModal(false)}
        />
      )}
    </main>
  );
}
