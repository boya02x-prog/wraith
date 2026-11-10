"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import { MemeTrend } from "@/app/app/page";
import {
  Flame,
  Rocket,
  Bell,
  Trash2,
  Undo2,
  Star,
  Send,
  ExternalLink,
  RefreshCw,
  Check,
  AlertTriangle,
  DollarSign,
} from "lucide-react";
import {
  saveHistory,
  fetchCurrentMcap,
  fetchTokenMeta,
  HISTORY_KEY,
} from "./MemeScanner";

interface McapSnapshot {
  ts: number;
  mcap: number;
}
interface HistoryEntry {
  keyword: string;
  displayName?: string;
  tokenSymbol?: string;
  tokenImageUrl?: string;
  seenAt: number;
  contractAddress?: string;
  celebMention?: string;
  aiContext?: string;
  platforms: string[];
  initialMcap: number;
  peakMcap: number;
  peakMcapTs: number;
  pendingPeakMcap?: number;
  pendingPeakTs?: number;
  currentMcap: number;
  snapshots: McapSnapshot[];
  lastChecked: number;
  tookProfitAt?: number;
  aiScore?: number;
  aiTier?: "HOT" | "WATCH" | "SKIP";
  twoXTier?: string;
}
interface Props {
  onSelectMeme?: (meme: MemeTrend) => void;
  onCountChange?: (count: number) => void;
}

const MONO = {
  fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" as const,
  fontVariantNumeric: "tabular-nums" as const,
};

const STALE_NOTIFIED_KEY = "wraith_stale_notified_keys";
const AUTO_REFRESH_MS = 60_000;
const UNDO_TIMEOUT_MS = 10_000;
const BOUGHT_KEY = "wraith_bought_keys";
const DISMISSED_KEY = "wraith_dismissed_keys";
const NOTIFIED_KEY = "wraith_notified_keys";
const WIN_NOTIFIED_KEY = "wraith_win_notified_keys";
const PEAK_GRACE_MS = 5 * 60 * 1000;
const DEAD_THRESHOLD = 0.1;
const DEAD_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_HISTORY_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const EARNED_MCAP_MULTIPLIER = 1.5;
const MIN_MCAP = 2_000;
const MAX_MCAP = 100_000;

import { C, SPACE, RADIUS as RADIUS_SCALE, FONT, CARD_BASE } from "@/lib/theme";
// Local alias — WinsPanel used a flat RADIUS=16 number everywhere before;
// keep that name working so the rest of this file doesn't need a mass
// find/replace, while the actual value now comes from the shared scale.
const RADIUS = RADIUS_SCALE.lg;

function passesSignalFilter(e: HistoryEntry): boolean {
  if (!e.contractAddress) return false;
  const mcap = e.initialMcap ?? 0;
  if (mcap > 0 && mcap < MIN_MCAP) return false;
  if (mcap > MAX_MCAP) return false;
  const platforms = Array.isArray(e.platforms) ? e.platforms : [];
  const tier = e.twoXTier ?? null;
  const aiTier = e.aiTier ?? null;
  const celeb = e.celebMention || null;
  const hasOnchain = platforms.some((p) =>
    ["pumpfun", "dexscreener", "birdeye"].includes(p),
  );
  if (!hasOnchain && !celeb) return false;
  if (aiTier === "SKIP") return false;
  if (!celeb) {
    if (!tier || ["SKIP", "LOW", "MEDIUM"].includes(tier)) return false;
  } else {
    if (tier === "SKIP") return false;
    if (!hasOnchain && (tier === "LOW" || tier === "MEDIUM")) return false;
  }
  return true;
}

function safeSnapshots(raw: unknown): McapSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is McapSnapshot =>
      s !== null &&
      typeof s === "object" &&
      typeof (s as Record<string, unknown>).ts === "number" &&
      typeof (s as Record<string, unknown>).mcap === "number",
  );
}
function safeEntry(key: string, raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  try {
    const seenAt = typeof r.seenAt === "number" ? r.seenAt : Date.now();
    return {
      keyword: typeof r.keyword === "string" ? r.keyword : key,
      displayName:
        typeof r.displayName === "string" ? r.displayName : undefined,
      tokenSymbol:
        typeof r.tokenSymbol === "string" ? r.tokenSymbol : undefined,
      tokenImageUrl:
        typeof r.tokenImageUrl === "string" ? r.tokenImageUrl : undefined,
      seenAt,
      contractAddress:
        typeof r.contractAddress === "string" ? r.contractAddress : undefined,
      celebMention:
        typeof r.celebMention === "string" ? r.celebMention : undefined,
      aiContext: typeof r.aiContext === "string" ? r.aiContext : undefined,
      platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
      initialMcap: typeof r.initialMcap === "number" ? r.initialMcap : 0,
      peakMcap: typeof r.peakMcap === "number" ? r.peakMcap : 0,
      peakMcapTs:
        typeof r.peakMcapTs === "number" && r.peakMcapTs !== seenAt
          ? r.peakMcapTs
          : 0,
      currentMcap: typeof r.currentMcap === "number" ? r.currentMcap : 0,
      snapshots: safeSnapshots(r.snapshots),
      lastChecked:
        typeof r.lastChecked === "number" ? r.lastChecked : Date.now(),
      tookProfitAt:
        typeof r.tookProfitAt === "number" ? r.tookProfitAt : undefined,
      aiScore: typeof r.aiScore === "number" ? r.aiScore : undefined,
      aiTier:
        r.aiTier === "HOT" || r.aiTier === "WATCH" || r.aiTier === "SKIP"
          ? r.aiTier
          : undefined,
      twoXTier: typeof r.twoXTier === "string" ? r.twoXTier : undefined,
    };
  } catch {
    return null;
  }
}
function loadSafeHistory(): Record<string, HistoryEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    const out: Record<string, HistoryEntry> = {};
    for (const [k, v] of Object.entries(raw)) {
      const e = safeEntry(k, v);
      if (e) out[k] = e;
    }
    return out;
  } catch {
    return {};
  }
}
function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}
function saveSet(key: string, s: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {}
}
function isGarbage(kw: string): boolean {
  if (kw.length > 14) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{10,}$/.test(kw)) return true;
  if (/\d{4,}/.test(kw)) return true;
  if (kw.length >= 8 && (kw.match(/[aeiou]/gi) || []).length === 0) return true;
  return false;
}
function isDeadEntry(e: HistoryEntry, nowMs: number): boolean {
  const age = nowMs - e.seenAt;
  if (age > MAX_HISTORY_AGE_MS) return true;
  if (
    e.initialMcap > 0 &&
    age > DEAD_MIN_AGE_MS &&
    e.currentMcap / e.initialMcap < DEAD_THRESHOLD
  )
    return true;
  return false;
}
function purgeDead(
  h: Record<string, HistoryEntry>,
): Record<string, HistoryEntry> {
  const now = Date.now();
  const out: Record<string, HistoryEntry> = {};
  for (const [k, e] of Object.entries(h)) {
    if (!isDeadEntry(e, now)) out[k] = e;
  }
  return out;
}
function countDead(h: Record<string, HistoryEntry>): number {
  const now = Date.now();
  return Object.values(h).filter((e) => isDeadEntry(e, now)).length;
}

function isPeakEarned(e: HistoryEntry): boolean {
  if (e.peakMcapTs > e.seenAt + PEAK_GRACE_MS) return true;
  if (
    e.initialMcap > 0 &&
    e.currentMcap >= e.initialMcap * EARNED_MCAP_MULTIPLIER
  )
    return true;
  if (
    e.peakMcapTs > 0 &&
    e.initialMcap > 0 &&
    e.peakMcap >= e.initialMcap * EARNED_MCAP_MULTIPLIER
  )
    return true;
  return false;
}

function fmtMcap(n: number): string {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtAgo(ts: number, now: number): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function calcX(init: number, cur: number): number {
  return !init ? 0 : cur / init;
}

// ─── SOUND ────────────────────────────────────────────────────────────────────
function playWinSound() {
  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    )();
    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };
    beep(880, 0, 0.12);
    beep(1100, 0.18, 0.12);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* silent */
  }
}

// ─── BROWSER NOTIFICATIONS ────────────────────────────────────────────────────
async function requestNotifPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window))
    return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function showWinNotif(entry: HistoryEntry, xNow: number) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const sym = (entry.tokenSymbol ?? entry.keyword).toUpperCase();
  const xStr = xNow >= 10 ? `${xNow.toFixed(1)}x` : `${xNow.toFixed(2)}x`;
  const n = new Notification(`✅ WRAITH WIN — ${sym} ${xStr}`, {
    body: `Spotted ${fmtMcap(entry.initialMcap)} → Now ${fmtMcap(entry.currentMcap)}${entry.celebMention ? `\n⭐ ${entry.celebMention}` : ""}`,
    icon: entry.tokenImageUrl ?? "/favicon.ico",
    tag: `wraith-win-${entry.keyword}`,
    requireInteraction: false,
  });
  n.onclick = () => {
    if (entry.contractAddress)
      window.open(
        `https://dexscreener.com/solana/${entry.contractAddress}`,
        "_blank",
      );
    n.close();
  };
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
async function sendTelegramWinAlert(entry: HistoryEntry, xNow: number) {
  try {
    await fetch("/api/alert/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "win",
        symbol: (entry.tokenSymbol ?? entry.keyword).toUpperCase(),
        keyword: entry.keyword,
        initialMcap: entry.initialMcap,
        currentMcap: entry.currentMcap,
        xNow,
        contractAddress: entry.contractAddress,
        celebMention: entry.celebMention,
        seenAt: entry.seenAt,
        platforms: entry.platforms,
        aiScore: entry.aiScore,
      }),
    });
  } catch {
    /* silent */
  }
}

async function sendTelegramStaleAlert(entry: HistoryEntry) {
  try {
    await fetch("/api/telegram/stale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: (entry.tokenSymbol ?? entry.keyword).toUpperCase(),
        keyword: entry.keyword,
        initialMcap: entry.initialMcap,
        currentMcap: entry.currentMcap,
        contractAddress: entry.contractAddress,
        seenAt: entry.seenAt,
      }),
    });
  } catch {
    /* silent */
  }
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────
function Avatar({
  imageUrl,
  symbol,
  size = 40,
}: {
  imageUrl?: string;
  symbol: string;
  size?: number;
}) {
  const [err, setErr] = useState(false);
  const letter = (symbol || "?").charAt(0).toUpperCase();
  if (imageUrl && !err)
    return (
      <img
        src={imageUrl}
        alt={symbol}
        width={size}
        height={size}
        onError={() => setErr(true)}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: `1px solid ${C.border}`,
        }}
      />
    );
  const palette = [C.orange, C.purple, C.blue, C.green, C.yellow, "#ff4500"];
  const bg = palette[letter.charCodeAt(0) % palette.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `${bg}1a`,
        border: `1px solid ${bg}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: bg,
        fontSize: size * 0.38,
        fontWeight: 900,
        ...MONO,
      }}
    >
      {letter}
    </div>
  );
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
let sparkIdCounter = 0;
function Spark({ snaps }: { snaps: McapSnapshot[] }) {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) idRef.current = sparkIdCounter++;
  const safe = safeSnapshots(snaps);
  if (safe.length < 2) return null;
  const vals = safe.map((s) => s.mcap);
  const min = Math.min(...vals),
    max = Math.max(...vals),
    range = max - min || 1;
  const W = 200,
    H = 40;
  const pts = safe
    .map(
      (s, i) =>
        `${((i / (safe.length - 1)) * W).toFixed(1)},${(H - ((s.mcap - min) / range) * (H - 4) - 2).toFixed(1)}`,
    )
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  const col = up ? C.green : C.red;
  const uid = `sg${idRef.current}${up ? "u" : "d"}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height: 40, overflow: "visible" }}
    >
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.22" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${uid})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={col}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ─── AI SCORE BADGE ───────────────────────────────────────────────────────────
function AiScoreBadge({
  score,
  tier,
}: {
  score: number;
  tier?: "HOT" | "WATCH" | "SKIP";
}) {
  const isHot = tier === "HOT" || score >= 70;
  const isWatch = !isHot && (tier === "WATCH" || score >= 40);
  const color = isHot ? C.hot : isWatch ? C.amber : C.dim;
  const bg = isHot ? "var(--surface-2)" : isWatch ? "var(--surface)" : "var(--bg)";
  const filled = Math.round(score / 20);
  return (
    <div
      title={`AI Score: ${score}/100`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: bg,
        border: `1px solid ${color}33`,
        borderRadius: 3,
        padding: "2px 6px",
        flexShrink: 0,
      }}
    >
      <span style={{ color, fontSize: 7, fontWeight: 800, ...MONO }}>AI</span>
      <div style={{ display: "flex", gap: 1.5 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height: 8,
              borderRadius: 1,
              background: i < filled ? color : `${color}22`,
            }}
          />
        ))}
      </div>
      <span style={{ color, fontSize: 8, fontWeight: 700, ...MONO }}>
        {score}
      </span>
    </div>
  );
}

// ─── X BADGE ──────────────────────────────────────────────────────────────────
function XBadge({
  xNow,
  xPeak,
  updating,
  peakEarned,
}: {
  xNow: number;
  xPeak: number;
  updating: boolean;
  peakEarned: boolean;
}) {
  const isMega = peakEarned && xPeak >= 5;
  const isWin = peakEarned && xPeak >= 2;
  const isDead = xNow < 0.3;
  const col = isMega
    ? C.yellow
    : isWin
      ? C.green
      : xNow >= 1.2
        ? C.amber
        : isDead
          ? C.red
          : C.dim;
  const str =
    !updating && xNow >= 0.01
      ? xNow >= 100
        ? `${xNow.toFixed(0)}x`
        : xNow >= 10
          ? `${xNow.toFixed(1)}x`
          : `${xNow.toFixed(2)}x`
      : null;
  return (
    <div
      style={{
        flexShrink: 0,
        width: 64,
        height: 54,
        background: isMega
          ? "#120c00"
          : isWin
            ? "#001610"
            : isDead
              ? "#120000"
              : C.bgCard,
        border: `1px solid ${col}33`,
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
      }}
    >
      <div
        style={{
          color: C.muted,
          fontSize: 7,
          letterSpacing: "0.12em",
          ...MONO,
        }}
      >
        NOW
      </div>
      <div
        style={{
          color: updating ? C.dim : col,
          fontSize: (str || "").length > 5 ? 13 : 16,
          fontWeight: 900,
          lineHeight: 1,
          ...MONO,
        }}
      >
        {updating ? "···" : str || "—"}
      </div>
      {peakEarned && xPeak > xNow * 1.15 && !updating && (
        <div
          style={{ color: `${C.yellow}55`, fontSize: 7, ...MONO, marginTop: 1 }}
        >
          pk {xPeak >= 10 ? xPeak.toFixed(1) : xPeak.toFixed(2)}x
        </div>
      )}
      {!peakEarned && xNow < 1.5 && (
        <div
          style={{
            color: `${C.red}55`,
            fontSize: 6,
            ...MONO,
            marginTop: 1,
            textAlign: "center",
          }}
        >
          pre-spot
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function WinsPanel({ onSelectMeme, onCountChange }: Props) {
  const [history, setHistory] = useState<Record<string, HistoryEntry>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [nextIn, setNextIn] = useState(AUTO_REFRESH_MS / 1000);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [boughtKeys, setBoughtKeys] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [undoSnap, setUndoSnap] = useState<Record<string, HistoryEntry> | null>(
    null,
  );
  const [undoCD, setUndoCD] = useState(0);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [deadCount, setDeadCount] = useState(0);
  const [purgeDismissed, setPurgeDismissed] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgStatus, setTgStatus] = useState<"idle" | "sending" | "ok" | "err">(
    "idle",
  );

  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoCD_ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const rfTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const backfillRunning = useRef(false);
  const winNotifiedRef = useRef<Set<string>>(new Set());
  const staleNotifiedRef = useRef<Set<string>>(loadSet(STALE_NOTIFIED_KEY));

  useEffect(() => {
    const t = visibleInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setBoughtKeys(loadSet(BOUGHT_KEY));
    setDismissed(loadSet(DISMISSED_KEY));
    const oldNotified = loadSet(NOTIFIED_KEY);
    const winNotified = loadSet(WIN_NOTIFIED_KEY);
    winNotifiedRef.current = new Set([...oldNotified, ...winNotified]);
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifEnabled(Notification.permission === "granted");
    }
    fetch("/api/alert/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _ping: true }),
    })
      .then((r) => {
        if (r.status !== 503) setTgEnabled(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key === BOUGHT_KEY) setBoughtKeys(loadSet(BOUGHT_KEY));
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);
  useEffect(() => {
    // only touch state when the set really changed: a fresh Set every 5s re-rendered this whole panel for nothing
    const t = visibleInterval(() => setBoughtKeys((cur) => { const next = loadSet(BOUGHT_KEY); return next.size === cur.size && [...next].every((k) => cur.has(k)) ? cur : next; }), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = loadSafeHistory();
    const filtered: Record<string, HistoryEntry> = {};
    for (const [k, e] of Object.entries(h)) {
      if (isGarbage(k)) continue;
      if (!e.contractAddress && e.initialMcap === 0) continue;
      if (e.initialMcap === 0 && e.currentMcap === 0 && e.peakMcap === 0)
        continue;
      filtered[k] = e;
    }
    const dead = countDead(filtered);
    if (dead > 0) setDeadCount(dead);
    setHistory(filtered);
    backfill(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function backfill(h: Record<string, HistoryEntry>) {
    if (backfillRunning.current) return;
    backfillRunning.current = true;
    const toFill = Object.values(h).filter(
      (e) => e.contractAddress && !e.tokenImageUrl,
    );
    if (!toFill.length) {
      backfillRunning.current = false;
      return;
    }
    const upd = { ...h };
    for (let i = 0; i < toFill.length; i += 8) {
      await Promise.all(
        toFill.slice(i, i + 8).map(async (e) => {
          const meta = await fetchTokenMeta(e.contractAddress!);
          if (meta && upd[e.keyword]) {
            upd[e.keyword] = {
              ...upd[e.keyword],
              displayName: upd[e.keyword].displayName || meta.name,
              tokenSymbol: upd[e.keyword].tokenSymbol || meta.symbol,
              tokenImageUrl: meta.imageUrl,
            };
          }
        }),
      );
    }
    saveHistory(upd);
    setHistory((prev) => ({ ...prev, ...upd }));
    backfillRunning.current = false;
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && undoSnap) doUndo();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSnap]);

  const fireWinAlerts = useCallback(
    (newWins: HistoryEntry[]) => {
      for (const entry of newWins) {
        const xNow = calcX(entry.initialMcap, entry.currentMcap);
        playWinSound();
        if (notifEnabled) showWinNotif(entry, xNow);
        if (tgEnabled) {
          setTgStatus("sending");
          sendTelegramWinAlert(entry, xNow)
            .then(() => {
              setTgStatus("ok");
              setTimeout(() => setTgStatus("idle"), 3_000);
            })
            .catch(() => {
              setTgStatus("err");
              setTimeout(() => setTgStatus("idle"), 3_000);
            });
        }
        winNotifiedRef.current.add(entry.keyword);
        saveSet(WIN_NOTIFIED_KEY, winNotifiedRef.current);
      }
    },
    [notifEnabled, tgEnabled],
  );

  const startUndo = (snap: Record<string, HistoryEntry>) => {
    setUndoSnap(snap);
    let s = UNDO_TIMEOUT_MS / 1000;
    setUndoCD(s);
    if (undoCD_ref.current) clearInterval(undoCD_ref.current);
    undoCD_ref.current = setInterval(() => {
      s -= 1;
      setUndoCD(s);
      if (s <= 0) {
        clearInterval(undoCD_ref.current!);
        setUndoSnap(null);
      }
    }, 1_000);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setUndoSnap(null);
      setUndoCD(0);
    }, UNDO_TIMEOUT_MS);
  };
  const doUndo = () => {
    if (!undoSnap) return;
    saveHistory(undoSnap);
    setHistory({ ...undoSnap });
    setUndoSnap(null);
    setUndoCD(0);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (undoCD_ref.current) clearInterval(undoCD_ref.current);
  };
  const markBought = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set([...boughtKeys, kw]);
    setBoughtKeys(next);
    saveSet(BOUGHT_KEY, next);
  };
  const markSold = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set([...boughtKeys].filter((k) => k !== kw));
    setBoughtKeys(next);
    saveSet(BOUGHT_KEY, next);
  };
  const dismissEntry = (kw: string) => {
    const next = new Set([...dismissed, kw]);
    setDismissed(next);
    saveSet(DISMISSED_KEY, next);
  };
  const delToken = (kw: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cur = loadSafeHistory();
    startUndo({ ...cur });
    delete cur[kw];
    saveHistory(cur);
    setHistory({ ...cur });
    if (selKey === kw) setSelKey(null);
  };
  const clearAll = () => {
    startUndo(loadSafeHistory());
    localStorage.removeItem(HISTORY_KEY);
    setHistory({});
    setSelKey(null);
  };
  const confirmPurge = () => {
    const cur = loadSafeHistory();
    startUndo({ ...cur });
    const cleaned = purgeDead(cur);
    saveHistory(cleaned);
    setHistory(cleaned);
    setDeadCount(0);
    setPurgeDismissed(false);
    if (selKey && !cleaned[selKey]) setSelKey(null);
  };
  const openInPanel = (entry: HistoryEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSelectMeme) return;
    onSelectMeme({
      keyword: entry.tokenSymbol || entry.keyword,
      score: 0,
      posts: 1,
      source: entry.platforms?.join(",") || "history",
      hasTicker: !!entry.contractAddress,
      crossPlatforms: entry.platforms?.length || 1,
      isNewCoin: false,
      // Persisted values describe a past snapshot, not a current quote.
      // TokenPanel will request the current validated market data on open.
      mcap: undefined,
      platforms: entry.platforms,
      tokenImageUrl: entry.tokenImageUrl,
      contractAddress: entry.contractAddress,
      celebMention: entry.celebMention,
      aiContext: entry.aiContext,
    } as MemeTrend);
  };
  const enableNotifications = async () => {
    const granted = await requestNotifPermission();
    setNotifEnabled(granted);
  };

  // ─── REFRESH ──────────────────────────────────────────────────────────────
  const runRefresh = useCallback(
    async (h: Record<string, HistoryEntry>) => {
      const entries = Object.values(h).filter((e) => e.contractAddress);
      if (!entries.length) return h;
      setRefreshing(true);
      setUpdating(new Set(entries.map((e) => e.keyword)));
      const updates: Record<string, HistoryEntry> = {};
      // Batch instead of firing all N requests at once — with 80+ tracked
      // tokens this was flooding DexScreener/Jupiter concurrently and
      // starving out the chart fetch and scanner requests entirely.
      const BATCH_SIZE = 16; // DexScreener held up fine at 8x — trying more headroom
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (entry) => {
            try {
              const mcap = await fetchCurrentMcap(entry.contractAddress!, true); // bulk=true skips Jupiter overlay for background refresh
              if (!mcap || mcap <= 0) return;
              const nowMs = Date.now();
              // Sanity-check against the last known GOOD reading and the
              // last ACTUAL poll time — not the last snapshot. Snapshots
              // only get appended when price moves >5% or 30min pass, so
              // a flat/stable token's lastSnap can be many minutes stale
              // even while polling itself is running fine every 60s. That
              // used to let the 5-minute staleness escape hatch fire on
              // every quiet token, disabling the outlier guard entirely —
              // one bad DexScreener read (wrong pair picked, stale cache,
              // momentary bad liquidity sort) would then get locked in as
              // a permanent, wildly wrong peakMcap. entry.currentMcap and
              // entry.lastChecked are updated on every single poll, so
              // they reflect reality regardless of how "boring" the token
              // has been.
              const prevMcap = entry.currentMcap || entry.initialMcap;
              const prevCheckedAt = entry.lastChecked || entry.seenAt;
              const e: HistoryEntry = {
                ...entry,
                snapshots: safeSnapshots(entry.snapshots),
              };
              e.currentMcap = mcap;
              e.lastChecked = nowMs;
              // A single read jumping >3x from the last poll is treated as
              // an unconfirmed spike (bad pair pick, thin-liquidity single
              // trade, stale cache) rather than committed straight to
              // peakMcap. It only gets promoted to the real peak once the
              // NEXT poll also lands within ~30% of it — i.e. two polls in
              // a row agree the price is actually up there. One bad tick on
              // an illiquid coin can no longer permanently corrupt peak.
              const SPIKE_MULTIPLE = 3;
              const isDirectRead =
                !prevMcap || mcap <= prevMcap * SPIKE_MULTIPLE;

              if (mcap > e.peakMcap && isDirectRead) {
                // Normal, believable move — commit directly.
                e.peakMcap = mcap;
                e.peakMcapTs = nowMs;
                e.pendingPeakMcap = undefined;
                e.pendingPeakTs = undefined;
              } else if (mcap > e.peakMcap) {
                // Suspicious spike (>3x prior read). Don't trust it yet.
                if (
                  e.pendingPeakMcap &&
                  Math.abs(mcap - e.pendingPeakMcap) / e.pendingPeakMcap < 0.3
                ) {
                  // Second poll agrees with the first spike — confirmed real.
                  e.peakMcap = mcap;
                  e.peakMcapTs = nowMs;
                  e.pendingPeakMcap = undefined;
                  e.pendingPeakTs = undefined;
                } else {
                  // First sighting of this spike, or it doesn't match the
                  // last pending one — hold it, don't commit.
                  e.pendingPeakMcap = mcap;
                  e.pendingPeakTs = nowMs;
                }
              } else if (
                e.pendingPeakMcap &&
                nowMs - (e.pendingPeakTs || 0) > 600_000
              ) {
                // Pending spike never got confirmed within 10 minutes — drop it.
                e.pendingPeakMcap = undefined;
                e.pendingPeakTs = undefined;
              }
              const snaps = e.snapshots;
              const last = snaps[snaps.length - 1];
              if (!last) {
                if (e.initialMcap === 0) e.initialMcap = mcap;
                e.snapshots = [{ ts: nowMs, mcap }];
              } else if (
                nowMs - last.ts > 1_800_000 ||
                Math.abs(mcap - last.mcap) / (last.mcap || 1) > 0.05
              ) {
                e.snapshots = [...snaps, { ts: nowMs, mcap }];
                if (e.snapshots.length > 48) e.snapshots.shift();
              }
              updates[entry.keyword] = e;
            } catch {
              /* skip */
            }
          }),
        );
      }

      setHistory((prev) => {
        const merged = { ...prev, ...updates };
        saveHistory(merged);
        setDeadCount(countDead(merged));

        // Win alerts
        const newWins = Object.values(merged).filter((e) => {
          if (winNotifiedRef.current.has(e.keyword)) return false;
          if (!passesSignalFilter(e)) return false;
          const xNow = calcX(e.initialMcap, e.currentMcap);
          const xPeak = calcX(e.initialMcap, e.peakMcap);
          return (isPeakEarned(e) && xPeak >= 2 && xNow >= 1.5) || xNow >= 2;
        });
        if (newWins.length > 0) fireWinAlerts(newWins);

        // Stale alerts — tokens 20+ mins old, below 1.5x, not already notified
        if (tgEnabled) {
          const staleTokens = Object.values(merged).filter((e) => {
            if (staleNotifiedRef.current.has(e.keyword)) return false;
            if (!passesSignalFilter(e)) return false;
            if (winNotifiedRef.current.has(e.keyword)) return false;
            const ageMs = Date.now() - e.seenAt;
            const xNow = calcX(e.initialMcap, e.currentMcap);
            return ageMs >= 20 * 60 * 1000 && xNow < 1.5;
          });
          for (const entry of staleTokens) {
            staleNotifiedRef.current.add(entry.keyword);
            saveSet(STALE_NOTIFIED_KEY, staleNotifiedRef.current);
            sendTelegramStaleAlert(entry);
          }
        }

        return merged;
      });

      setRefreshing(false);
      setUpdating(new Set());
      setLastAt(new Date().toLocaleTimeString());
      return { ...h, ...updates };
    },
    [fireWinAlerts, tgEnabled],
  );

  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      let s = AUTO_REFRESH_MS / 1000;
      setNextIn(s);
      if (cdTimer.current) clearInterval(cdTimer.current);
      cdTimer.current = setInterval(() => {
        s -= 1;
        if (!cancelled) setNextIn(Math.max(s, 0));
      }, 1_000);
      rfTimer.current = setTimeout(async () => {
        if (cancelled) return;
        await runRefresh(loadSafeHistory());
        if (!cancelled) schedule();
      }, AUTO_REFRESH_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (rfTimer.current) clearTimeout(rfTimer.current);
      if (cdTimer.current) clearInterval(cdTimer.current);
    };
  }, [runRefresh]);

  // ─── LIST ─────────────────────────────────────────────────────────────────
  const list = useMemo(
    () =>
      Object.values(history)
        .filter((e) => {
          if (!passesSignalFilter(e)) return false;
          const xNow = calcX(e.initialMcap, e.currentMcap);
          const xPeak = calcX(e.initialMcap, e.peakMcap);
          const earned = isPeakEarned(e);
          return (earned && xPeak >= 2) || xNow >= 2;
        })
        .sort((a, b) => {
          const aHot = a.aiTier === "HOT" ? 1 : 0;
          const bHot = b.aiTier === "HOT" ? 1 : 0;
          const ax = isPeakEarned(a)
            ? calcX(a.initialMcap, a.peakMcap)
            : calcX(a.initialMcap, a.currentMcap);
          const bx = isPeakEarned(b)
            ? calcX(b.initialMcap, b.peakMcap)
            : calcX(b.initialMcap, b.currentMcap);
          if (Math.abs(ax - bx) > 0.5) return bx - ax;
          return bHot - aHot;
        }),
    [history],
  );

  useEffect(() => {
    onCountChange?.(list.length);
  }, [list.length, onCountChange]);

  const { bestX, bestTok } = useMemo(() => {
    const bx = list.reduce((acc, e) => {
      const x = isPeakEarned(e)
        ? calcX(e.initialMcap, e.peakMcap)
        : calcX(e.initialMcap, e.currentMcap);
      return Math.max(acc, x);
    }, 0);
    return {
      bestX: bx,
      bestTok: list.find((e) => {
        const x = isPeakEarned(e)
          ? calcX(e.initialMcap, e.peakMcap)
          : calcX(e.initialMcap, e.currentMcap);
        return x === bx;
      }),
    };
  }, [list]);

  const hotWins = useMemo(
    () => list.filter((e) => e.aiTier === "HOT").length,
    [list],
  );

  const tpAlerts = useMemo(
    () =>
      list.filter(
        (e) =>
          calcX(e.initialMcap, e.currentMcap) >= 2 &&
          boughtKeys.has(e.keyword) &&
          !dismissed.has(e.keyword),
      ),
    [list, boughtKeys, dismissed],
  );
  const showPurgeBanner = deadCount > 0 && !purgeDismissed;

  return (
    <div className="wx-board" style={{ background: "var(--bg)", height: "100%" }}>
      <style>{`
        @keyframes dpulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes aglow{0%,100%{box-shadow:0 0 8px #ffd70022}50%{box-shadow:0 0 18px #ffd70055}}
        @keyframes tgsend{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
        @keyframes hotpulse{0%,100%{box-shadow:0 0 0 0 #ff7b3d00}50%{box-shadow:0 0 8px 2px #ff7b3d33}}
.wc{cursor:pointer;transition:background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease;position:relative}
        .wc:hover{background:var(--surface-3)!important;transform:translateY(-1px);box-shadow:0 8px 24px -12px rgba(0,0,0,0.55)}
        .wdel{opacity:0;transition:opacity .12s}
        .wc:hover .wdel{opacity:1}
        .tpb{animation:aglow 2s ease-in-out infinite}
        .tgsending{animation:tgsend .8s ease-in-out infinite}
       .hotcard{animation:hotpulse 3s ease-in-out infinite}
        .wc-strip{scrollbar-width:none}
        .wc-strip::-webkit-scrollbar{display:none}
      `}</style>

      {/* HEADER */}
      <div className="wx-board-bar">
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="wx-kicker" style={{ color: "var(--accent-text)", letterSpacing: "0.16em" }}>WIN TRACKER</span>
          <span className="wx-live">
            <i className={refreshing ? "stale" : ""} />
          </span>
          {tpAlerts.length > 0 && (
            <span className="wx-badge tpb" style={{ fontSize: 9, color: "#ffd700", background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.22)" }}>
              <DollarSign size={9} /> {tpAlerts.length}× TAKE PROFIT
            </span>
          )}
          {hotWins > 0 && (
            <span className="wx-badge" style={{ fontSize: 9, color: "var(--accent-text)", background: "rgba(var(--accent-rgb),0.1)", border: "1px solid rgba(var(--accent-rgb),0.22)" }}>
              <Flame size={9} /> {hotWins} HOT WIN{hotWins !== 1 ? "S" : ""}
            </span>
          )}
          <span style={{ color: "var(--text-dim)", fontSize: 9, fontFamily: "var(--font-mono), monospace", display: "inline-flex", alignItems: "center", gap: 3 }}>
            {refreshing ? "refreshing…" : <><RefreshCw size={9} /> {nextIn}s</>}
          </span>
          {tgEnabled && tgStatus !== "idle" && (
            <span className={tgStatus === "sending" ? "tgsending" : ""} style={{ fontSize: 9, fontFamily: "var(--font-mono), monospace", color: tgStatus === "ok" ? "var(--win)" : tgStatus === "err" ? "var(--loss)" : "var(--text-muted)" }}>
              {tgStatus === "sending" ? "TG ···" : tgStatus === "ok" ? "TG ✓" : "TG ✗"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
          <button
            type="button"
            className="wx-icon-btn"
            onClick={notifEnabled ? undefined : enableNotifications}
            style={{ color: notifEnabled ? "var(--win)" : "var(--text-dim)", cursor: notifEnabled ? "default" : "pointer" }}
            title={notifEnabled ? "Browser notifications on" : "Click to enable notifications"}
          >
            <Bell size={13} />
          </button>
          {tgEnabled && (
            <span className="wx-icon-btn" style={{ color: "var(--text-dim)" }} title="Telegram alerts on">
              <Send size={12} />
            </span>
          )}
          <button type="button" className="wx-btn" onClick={() => runRefresh(loadSafeHistory())} disabled={refreshing} style={{ fontSize: 10, color: "var(--win)" }}>
            {refreshing ? "···" : <><RefreshCw size={10} /> NOW</>}
          </button>
          <button type="button" className="wx-btn" onClick={clearAll} style={{ fontSize: 10 }}>CLR</button>
        </div>
      </div>

      {/* STATS BAR */}
      {list.length > 0 && (
        <div
          className="wins-panel-stats"
          style={{
            background: "var(--surface)",
            borderBottom: `1px solid ${C.border}`,
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            gap: 0,
            flexShrink: 0,
          }}
        >
          {(
            [
              {
                label: "TRACKED",
                value: Object.keys(history).length.toString(),
                color: C.orange,
              },
              {
                label: "2X+ WINS",
                value: list.length.toString(),
                color: C.green,
              },
              {
                label: "BEST",
                value:
                  bestX >= 1
                    ? bestX >= 10
                      ? `${bestX.toFixed(1)}x`
                      : `${bestX.toFixed(2)}x`
                    : "—",
                color: C.yellow,
                sub:
                  bestTok && bestX >= 1.5
                    ? (bestTok.tokenSymbol || bestTok.keyword).toUpperCase()
                    : undefined,
              },
              {
                label: "HOT WINS",
                value: hotWins > 0 ? `${hotWins}/${list.length}` : "—",
                color: C.hot,
              },
              { label: "REFRESH", value: lastAt || "—", color: C.muted },
            ] as { label: string; value: string; color: string; sub?: string }[]
          ).map((s, i, arr) => (
            <div
              key={i}
              style={{
                flex: i === 4 ? 1 : "0 0 auto",
                minWidth: 0,
                display: "flex",
                alignItems: "baseline",
                gap: 5,
                padding: "0 12px",
                borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : "none",
              }}
            >
              <span
                style={{
                  color: C.label,
                  fontSize: 8,
                  letterSpacing: "0.12em",
                  whiteSpace: "nowrap",
                  ...MONO,
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  color: s.color,
                  fontSize: i === 4 ? 11 : 15,
                  fontWeight: 800,
                  ...MONO,
                  lineHeight: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.value}
                {s.sub && (
                  <span style={{ color: `${C.yellow}88`, fontSize: 8, marginLeft: 3, ...MONO }}>
                    {s.sub}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* DEAD PURGE BANNER */}
      {showPurgeBanner && (
        <div
          style={{
            background: "var(--bg)",
            borderBottom: `1px solid ${C.amber}22`,
            padding: "9px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            gap: 8,
          }}
        >
          <div>
            <div
              style={{ color: C.amber, fontSize: 10, fontWeight: 700, ...MONO }}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Trash2 size={11} />
                {deadCount} dead / stale token{deadCount !== 1 ? "s" : ""}{" "}
                detected
              </span>
            </div>
            <div style={{ color: C.dim, fontSize: 8, ...MONO, marginTop: 2 }}>
              Down {(DEAD_THRESHOLD * 100).toFixed(0)}%+ from entry or older
              than 3 days
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={confirmPurge}
              style={{
                background: "var(--surface-2)",
                border: `1px solid ${C.amber}44`,
                color: C.amber,
                fontSize: 9,
                fontWeight: 700,
                ...MONO,
                padding: "5px 10px",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              PURGE
            </button>
            <button
              onClick={() => setPurgeDismissed(true)}
              style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                color: C.dim,
                fontSize: 9,
                ...MONO,
                padding: "5px 8px",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              KEEP
            </button>
          </div>
        </div>
      )}

      {/* UNDO BANNER */}
      {undoSnap && undoCD > 0 && (
        <div
          style={{
            background: "var(--bg)",
            borderBottom: `1px solid ${C.orange}22`,
            padding: "9px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                color: C.orange,
                fontSize: 10,
                fontWeight: 700,
                ...MONO,
                letterSpacing: "0.1em",
              }}
            >
              CLEARED — undo in {undoCD}s
            </div>
            <div
              style={{
                height: 2,
                background: C.border,
                borderRadius: 1,
                marginTop: 5,
                width: 120,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(undoCD / (UNDO_TIMEOUT_MS / 1000)) * 100}%`,
                  background: C.orange,
                  borderRadius: 1,
                  transition: "width 1s linear",
                }}
              />
            </div>
          </div>
          <button
            onClick={doUndo}
            style={{
              background: C.orange,
              border: "none",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              ...MONO,
              padding: "6px 14px",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Undo2 size={11} /> UNDO
            </span>
          </button>
        </div>
      )}

      {/* EMPTY STATE */}
      {list.length === 0 && !undoSnap && (
        <div className="wx-empty">
          <span className="wx-kicker" style={{ fontSize: 18, opacity: 0.1, letterSpacing: "0.4em" }}>WRAITH</span>
          <strong>No wins yet</strong>
          <span>Only HIGH/ULTRA signals that hit 2× appear here</span>
        </div>
      )}

      {/* CARD LIST */}
      <div className="wx-wins" style={{ padding: "6px 8px" }}>
        {list.map((entry) => {
          const snaps = safeSnapshots(entry.snapshots);
          const xNow = calcX(entry.initialMcap, entry.currentMcap);
          const xPeak = calcX(entry.initialMcap, entry.peakMcap);
          const earned = isPeakEarned(entry);
          const isMega = earned && xPeak >= 5;
          const isWin = earned && xPeak >= 2;
          const isDead = xNow < 0.3;
          const hasDumped = xNow < 0.7 && earned && xPeak >= 1.5;
          const drop =
            earned && entry.peakMcap > 0
              ? ((entry.peakMcap - entry.currentMcap) / entry.peakMcap) * 100
              : 0;
          const isCeleb = !!entry.celebMention;
          const isUpd = updating.has(entry.keyword);
          const isSel = selKey === entry.keyword;
          const hasBought = boughtKeys.has(entry.keyword);
          const showTP =
            xNow >= 2 && hasBought && !dismissed.has(entry.keyword);
          const isHot = entry.aiTier === "HOT";
          const accent = isMega
            ? C.yellow
            : isWin
              ? C.green
              : xNow >= 1.2
                ? C.amber
                : isDead
                  ? C.red
                  : C.border;
          const sym = (entry.tokenSymbol || entry.keyword).toUpperCase();
          const dispName =
            entry.displayName &&
            entry.displayName.toLowerCase() !== entry.keyword.toLowerCase()
              ? entry.displayName
              : null;

          return (
            <div
              key={entry.keyword}
              className={`wc${isHot ? " hotcard" : ""}${isSel ? " selected" : ""}`}
              onClick={() => {
                setSelKey(entry.keyword);
                if (onSelectMeme)
                  openInPanel(entry, {
                    stopPropagation: () => {},
                  } as React.MouseEvent);
              }}
              style={{
                marginBottom: 8,
                borderRadius: 16,
                overflow: "hidden",
                border: `1px solid ${isSel ? "rgba(var(--accent-rgb),0.35)" : "var(--border)"}`,
                background: "var(--surface)",
                cursor: "pointer",
                transition: "border-color 0.15s ease, transform 0.16s ease, box-shadow 0.16s ease",
              }}
            >
              {showTP && (
                <div
                  style={{
                    borderBottom: `1px solid ${C.yellow}22`,
                    padding: `${SPACE.sm}px ${SPACE.lg}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "var(--surface)",
                    gap: 8,
                  }}
                >
                  <div>
                    <div
                      style={{
                        color: C.yellow,
                        fontSize: 9,
                        fontWeight: 900,
                        letterSpacing: "0.12em",
                        ...MONO,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        {xNow >= 5 ? (
                          <AlertTriangle size={11} />
                        ) : (
                          <DollarSign size={11} />
                        )}
                        TAKE PROFIT —{" "}
                        {xNow >= 10
                          ? `${xNow.toFixed(1)}x`
                          : `${xNow.toFixed(2)}x`}
                      </span>
                    </div>
                    <div
                      style={{
                        color: `${C.yellow}77`,
                        fontSize: 8,
                        ...MONO,
                        marginTop: 2,
                      }}
                    >
                      bought at ~{fmtMcap(entry.initialMcap)} → now{" "}
                      {fmtMcap(entry.currentMcap)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    {entry.contractAddress && (
                      <a
                        href={`https://dexscreener.com/solana/${entry.contractAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 9,
                          color: C.blue,
                          border: `1px solid ${C.blue}33`,
                          padding: "5px 10px",
                          borderRadius: 3,
                          textDecoration: "none",
                          ...MONO,
                        }}
                      >
                        DEX↗
                      </a>
                    )}
                    <button
                      onClick={(e) => markSold(entry.keyword, e)}
                      style={{
                        background: C.green,
                        border: "none",
                        color: "#000",
                        fontSize: 9,
                        fontWeight: 900,
                        ...MONO,
                        padding: "5px 10px",
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        SOLD <Check size={10} strokeWidth={3} />
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissEntry(entry.keyword);
                      }}
                      style={{
                        background: "transparent",
                        border: `1px solid ${C.yellow}22`,
                        color: `${C.yellow}77`,
                        fontSize: 9,
                        ...MONO,
                        padding: "5px 8px",
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              <div
                style={{
                  padding: SPACE.lg,
                  opacity: isUpd ? 0.5 : 1,
                  transition: "opacity .3s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <Avatar
                    imageUrl={entry.tokenImageUrl}
                    symbol={sym}
                    size={40}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        flexWrap: "wrap",
                        marginBottom: 3,
                      }}
                    >
                      <span
                        style={{
                          color: isMega
                            ? C.yellow
                            : isWin
                              ? C.green
                              : C.primary,
                          fontSize: 15,
                          fontWeight: 900,
                          ...MONO,
                        }}
                      >
                        {sym}
                      </span>
                      {dispName && (
                        <span
                          style={{
                            color: C.muted,
                            fontSize: 9,
                            ...MONO,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 100,
                          }}
                        >
                          {dispName}
                        </span>
                      )}
                      {hasBought && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.green,
                            border: `1px solid ${C.green}33`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                            background: `${C.green}0f`,
                          }}
                        >
                          <Check
                            size={9}
                            strokeWidth={3}
                            style={{ verticalAlign: -1 }}
                          />{" "}
                          IN
                        </span>
                      )}
                      {isMega && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.yellow,
                            border: `1px solid ${C.yellow}33`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                            background: `${C.yellow}1a`,
                          }}
                        >
                          <Rocket size={9} style={{ verticalAlign: -1 }} /> MEGA
                        </span>
                      )}
                      {!isMega && isWin && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.green,
                            border: `1px solid ${C.green}22`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          <Check
                            size={9}
                            strokeWidth={3}
                            style={{ verticalAlign: -1 }}
                          />{" "}
                          WIN
                        </span>
                      )}
                      {hasDumped && (
                        <span
                          style={{
                            fontSize: 8,
                            color: "#ff6644",
                            border: "1px solid #ff664422",
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          ↓ {drop.toFixed(0)}%
                        </span>
                      )}
                      {isDead && !hasDumped && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.red,
                            border: `1px solid ${C.red}22`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          DEAD
                        </span>
                      )}
                      {isCeleb && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.yellow,
                            border: `1px solid ${C.yellow}22`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                        >
                          <Star size={9} style={{ verticalAlign: -1 }} />{" "}
                          {entry.celebMention?.split(" ")[0]}
                        </span>
                      )}
                      {!earned && xNow < 1.5 && xPeak < 1.5 && (
                        <span
                          style={{
                            fontSize: 8,
                            color: C.red,
                            border: `1px solid ${C.red}22`,
                            padding: "2px 5px",
                            borderRadius: 2,
                            ...MONO,
                          }}
                          title="Peak happened before your scanner spotted this"
                        >
                          PRE-SPOT
                        </span>
                      )}
                      {typeof entry.aiScore === "number" && (
                        <AiScoreBadge
                          score={entry.aiScore}
                          tier={entry.aiTier}
                        />
                      )}
                    </div>
                    {entry.aiContext && (
                      <div
                        style={{
                          color: C.muted,
                          fontSize: 9,
                          ...MONO,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginBottom: 4,
                          maxWidth: "95%",
                        }}
                      >
                        {entry.aiContext.slice(0, 60)}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          background: "#0a0a0a",
                          border: `1px solid ${C.border}`,
                          borderRadius: 3,
                          padding: "3px 8px",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            color: C.label,
                            fontSize: 7,
                            ...MONO,
                            letterSpacing: "0.1em",
                          }}
                        >
                          SPOTTED
                        </span>
                        <span
                          style={{
                            color: C.orange,
                            fontSize: 10,
                            fontWeight: 700,
                            ...MONO,
                          }}
                        >
                          {fmtTime(entry.seenAt)}
                        </span>
                        <span style={{ color: C.dim, fontSize: 8, ...MONO }}>
                          · {fmtAgo(entry.seenAt, now)}
                        </span>
                      </div>
                      {earned && entry.peakMcapTs > entry.seenAt && (
                        <div
                          style={{
                            background: "#0a0a0a",
                            border: `1px solid ${C.yellow}22`,
                            borderRadius: 3,
                            padding: "3px 8px",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span
                            style={{
                              color: C.label,
                              fontSize: 7,
                              ...MONO,
                              letterSpacing: "0.1em",
                            }}
                          >
                            PEAK AT
                          </span>
                          <span
                            style={{
                              color: C.yellow,
                              fontSize: 10,
                              fontWeight: 700,
                              ...MONO,
                            }}
                          >
                            {fmtTime(entry.peakMcapTs)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {(
                        [
                          {
                            label: hasBought ? "BOUGHT" : "SPOTTED",
                            value: fmtMcap(entry.initialMcap),
                            color: C.muted,
                          },
                          null,
                          {
                            label: "NOW",
                            value: isUpd ? "···" : fmtMcap(entry.currentMcap),
                            color: isUpd ? C.dim : accent,
                          },
                          ...(earned && entry.peakMcap > entry.currentMcap * 1.1
                            ? [
                                null,
                                {
                                  label: "PEAK",
                                  value: fmtMcap(entry.peakMcap),
                                  color: `${C.yellow}99`,
                                },
                              ]
                            : []),
                        ] as ({
                          label: string;
                          value: string;
                          color: string;
                        } | null)[]
                      ).map((item, i) =>
                        item === null ? (
                          <span
                            key={i}
                            style={{ color: C.dim, fontSize: 10, ...MONO }}
                          >
                            →
                          </span>
                        ) : (
                          <div
                            key={i}
                            style={{
                              background: C.bgCard,
                              border: `1px solid ${C.border}`,
                              borderRadius: 3,
                              padding: "3px 7px",
                            }}
                          >
                            <div
                              style={{
                                color: C.label,
                                fontSize: 7,
                                ...MONO,
                                marginBottom: 1,
                              }}
                            >
                              {item.label}
                            </div>
                            <div
                              style={{
                                color: item.color,
                                fontSize: 11,
                                fontWeight: 700,
                                ...MONO,
                              }}
                            >
                              {item.value}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                  <XBadge
                    xNow={xNow}
                    xPeak={earned ? xPeak : xNow}
                    updating={isUpd}
                    peakEarned={earned}
                  />
                </div>
                {snaps.length >= 2 && (
                  <div style={{ marginBottom: 8, marginTop: 4 }}>
                    <Spark snaps={snaps} />
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", gap: 5 }}>
                    {entry.platforms.slice(0, 2).map((p) => (
                      <span
                        key={p}
                        style={{
                          fontSize: 8,
                          color: C.dim,
                          border: `1px solid ${C.border}`,
                          padding: "1px 5px",
                          borderRadius: 2,
                          ...MONO,
                        }}
                      >
                        {p.toUpperCase()}
                      </span>
                    ))}
                  </div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 5 }}
                  >
                    {hasBought && (
                      <span
                        style={{
                          color: xNow >= 1 ? `${C.green}aa` : `${C.red}aa`,
                          fontSize: 9,
                          fontWeight: 700,
                          ...MONO,
                        }}
                      >
                        {xNow >= 1
                          ? `+${((xNow - 1) * 100).toFixed(0)}%`
                          : `-${((1 - xNow) * 100).toFixed(0)}%`}
                      </span>
                    )}
                    {entry.contractAddress && onSelectMeme && (
                      <button
                        onClick={(e) => openInPanel(entry, e)}
                        style={{
                          background: "transparent",
                          border: `1px solid ${C.orange}33`,
                          color: C.orange,
                          fontSize: 8,
                          padding: "2px 7px",
                          borderRadius: 2,
                          cursor: "pointer",
                          ...MONO,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          CHART <ExternalLink size={9} />
                        </span>
                      </button>
                    )}
                    {entry.contractAddress && (
                      <>
                        <a
                          href={`https://dexscreener.com/solana/${entry.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 8,
                            color: C.blue,
                            border: `1px solid ${C.blue}33`,
                            padding: "2px 6px",
                            borderRadius: 2,
                            textDecoration: "none",
                            ...MONO,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            DEX <ExternalLink size={9} />
                          </span>
                        </a>
                        <a
                          href={`https://pump.fun/${entry.contractAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 8,
                            color: C.purple,
                            border: `1px solid ${C.purple}33`,
                            padding: "2px 6px",
                            borderRadius: 2,
                            textDecoration: "none",
                            ...MONO,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            PUMP <ExternalLink size={9} />
                          </span>
                        </a>
                      </>
                    )}
                    <button
                      onClick={(e) =>
                        hasBought
                          ? markSold(entry.keyword, e)
                          : markBought(entry.keyword, e)
                      }
                      style={{
                        background: hasBought ? `${C.green}15` : "transparent",
                        border: `1px solid ${hasBought ? C.green + "44" : C.border}`,
                        color: hasBought ? C.green : C.dim,
                        fontSize: 8,
                        ...MONO,
                        padding: "2px 7px",
                        borderRadius: 2,
                        cursor: "pointer",
                        fontWeight: hasBought ? 700 : 400,
                      }}
                    >
                      {hasBought ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Check size={9} strokeWidth={3} /> IN
                        </span>
                      ) : (
                        "BUY?"
                      )}
                    </button>
                    <button
                      className="wdel"
                      onClick={(e) => delToken(entry.keyword, e)}
                      style={{
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        color: C.dim,
                        fontSize: 8,
                        padding: "2px 7px",
                        borderRadius: 2,
                        cursor: "pointer",
                        ...MONO,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "#1a0000";
                        (e.currentTarget as HTMLElement).style.color = C.red;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                        (e.currentTarget as HTMLElement).style.color = C.dim;
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
