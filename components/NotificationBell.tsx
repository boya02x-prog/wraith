"use client";

// Notification center: watches the things the user cares about and collects them in one bell.
//  - traders you follow (new buys / closes)
//  - callouts from people you follow
//  - tokens you saved (big price moves)
//  - fresh HOT calls from the Wraith scanner
// Everything is polled while the app is open (once a minute) and kept on this device.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { usePresence } from "@/lib/usePresence";
import { readTokenFavorites } from "@/lib/tokenFavorites";
import PushToggle from "@/components/PushToggle";
import { enablePush, isStandalone, pushAvailable } from "@/lib/pushClient";
import { pushState, restoreState, watchFavorites } from "@/lib/userStateSync";

type Kind = "trader" | "callout" | "saved" | "signal";
interface Notif { id: string; kind: Kind; title: string; body: string; href: string; ts: number; img?: string }
interface Prefs { trader: boolean; callout: boolean; saved: boolean; signal: boolean }

const KEY = "wraith_notifs_v1";
const SEEN = "wraith_notifs_seen_v1";
const KNOWN = "wraith_notifs_known_v1";
const BASE = "wraith_notifs_pxbase_v1";
const POLL_MS = 60_000;
const SAVED_MOVE = 0.25; // alert when a saved token moves 25% from its last alert price
const SOL_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DEFAULT_PREFS: Prefs = { trader: true, callout: true, saved: true, signal: true };

function read<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full / blocked */ }
}
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}
function k(n?: number | null) {
  if (!n || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function ago(ts: number) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

type FeedItem = { traderId: string; traderName?: string; avatarDataUrl?: string; type: "open" | "closed"; mint: string; symbol?: string; entryMcap?: number; pnlPct?: number; ts?: number; id?: string };
type CalloutItem = { id?: string; _id?: string; userId: string; displayName?: string; avatarDataUrl?: string; avatarUrl?: string; text?: string; mint?: string; createdAt?: number | string };
type CallItem = { address: string; symbol: string; spottedAt: number; spottedMcap: number; tier: "HOT" | "WATCH"; score: number; shadow?: boolean; imageUrl?: string; chain?: string };

export default function NotificationBell() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const pres = usePresence(open);
  const [badImgs, setBadImgs] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Notif[]>([]);
  const [seen, setSeen] = useState(0);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS); // everything is on; no filters
  const busy = useRef(false);

  useEffect(() => {
    setMounted(true);
    setItems(read<Notif[]>(KEY, []));
    setSeen(read<number>(SEEN, 0));
    // After a reinstall this device is empty: bring the history and saved tokens back from the account.
    void restoreState().then((filled) => {
      if (filled) { setItems(read<Notif[]>(KEY, [])); setSeen(read<number>(SEEN, 0)); }
    });
    return watchFavorites();
  }, []);

  // Installed app: ask "Allow notifications?" by itself on the first tap, like other apps do.
  useEffect(() => {
    if (!mounted) return;
    const ask = () => {
      window.removeEventListener("pointerdown", ask);
      try {
        if (!pushAvailable() || !isStandalone() || Notification.permission !== "default") return;
        if (localStorage.getItem("wraith_push_asked")) return;
        localStorage.setItem("wraith_push_asked", "1");
        void enablePush(DEFAULT_PREFS).catch(() => undefined);
      } catch { /* not supported */ }
    };
    window.addEventListener("pointerdown", ask);
    return () => window.removeEventListener("pointerdown", ask);
  }, [mounted]);

  const poll = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const p = prefsRef.current;
      const firstRun = localStorage.getItem(KNOWN) === null;
      const known = new Set<string>(read<string[]>(KNOWN, []));
      const fresh: Notif[] = [];
      const add = (n: Notif) => {
        if (known.has(n.id)) return;
        known.add(n.id);
        if (!firstRun) fresh.push(n); // first run only learns what already exists, so you are not flooded
      };

      const jobs: Promise<void>[] = [];

      if (p.trader) jobs.push(getJson<{ callouts?: FeedItem[] }>("/api/traders/feed").then((d) => {
        for (const c of d?.callouts ?? []) {
          if (!c.mint) continue;
          const ts = c.ts ?? Date.now();
          const opened = c.type === "open";
          add({
            id: `t:${c.traderId}:${c.mint}:${c.type}:${ts}`, kind: "trader", ts, img: c.avatarDataUrl,
            title: `${c.traderName || "A trader you follow"} ${opened ? "bought" : "closed"} ${c.symbol ? `$${c.symbol}` : "a token"}`,
            body: opened ? `In at ${k(c.entryMcap)} market cap` : `${(c.pnlPct ?? 0) >= 0 ? "+" : ""}${Math.round(c.pnlPct ?? 0)}% result`,
            href: `/app/token/${c.mint}`,
          });
        }
      }));

      if (p.callout) jobs.push(getJson<{ callouts?: CalloutItem[] }>("/api/callouts?following=1&limit=15").then((d) => {
        for (const c of d?.callouts ?? []) {
          const id = c.id ?? c._id;
          if (!id) continue;
          const ts = typeof c.createdAt === "number" ? c.createdAt : c.createdAt ? Date.parse(c.createdAt) || Date.now() : Date.now();
          add({
            id: `c:${id}`, kind: "callout", ts, img: c.avatarDataUrl || c.avatarUrl,
            title: `${c.displayName || "Someone you follow"} posted intel`,
            body: (c.text || "").slice(0, 110),
            href: c.mint ? `/app/token/${c.mint}` : `/app/u/${encodeURIComponent(c.userId)}`,
          });
        }
      }));

      if (p.signal) jobs.push(getJson<{ calls?: CallItem[] }>("/api/signal-calls").then((d) => {
        const cutoff = Date.now() - 3 * 3600_000;
        for (const c of d?.calls ?? []) {
          if (c.shadow || c.tier !== "HOT" || c.spottedAt < cutoff) continue;
          add({
            id: `s:${c.address}`, kind: "signal", ts: c.spottedAt, img: c.imageUrl,
            title: `Fresh call: $${c.symbol}`,
            body: `Spotted at ${k(c.spottedMcap)} · score ${Math.round(c.score)}`,
            href: `/app/token/${c.address}`,
          });
        }
      }));

      if (p.saved) jobs.push((async () => {
        const favs = readTokenFavorites().filter((f) => f.contractAddress && SOL_MINT.test(f.contractAddress) && !f.contractAddress.startsWith("0x")).slice(0, 40);
        if (!favs.length) return;
        const ids = favs.map((f) => f.contractAddress).join(",");
        const d = await getJson<Record<string, { usdPrice?: number }>>(`/api/price?ids=${ids}`);
        if (!d) return;
        const base = read<Record<string, number>>(BASE, {});
        for (const f of favs) {
          const mint = f.contractAddress as string;
          const px = d[mint]?.usdPrice;
          if (!(px && px > 0)) continue;
          const b = base[mint];
          if (!b) { base[mint] = px; continue; }
          const move = px / b - 1;
          if (Math.abs(move) >= SAVED_MOVE) {
            add({
              id: `p:${mint}:${Math.floor(Date.now() / 3600_000)}`, kind: "saved", ts: Date.now(),
              title: `$${f.keyword} is ${move > 0 ? "up" : "down"} ${Math.abs(Math.round(move * 100))}%`,
              body: "A token you saved just moved",
              href: `/app/token/${mint}`,
            });
            base[mint] = px;
          }
        }
        write(BASE, base);
      })());

      await Promise.all(jobs);

      write(KNOWN, [...known].slice(-400));
      pushState();
      if (fresh.length) {
        setItems((prev) => {
          const next = [...fresh, ...prev].sort((a, b) => b.ts - a.ts).slice(0, 60);
          write(KEY, next);
          return next;
        });
        try { navigator.vibrate?.(40); } catch { /* not supported */ }
      }
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const first = setTimeout(() => void poll(), 2500);
    const t = setInterval(() => void poll(), POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(first); clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [mounted, poll]);

  const unread = items.filter((n) => n.ts > seen).length;

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (next) { const now = Date.now(); setSeen(now); write(SEEN, now); pushState(); }
      return next;
    });
  };
  const clearAll = () => { setItems([]); write(KEY, []); pushState(); };
  const go = (n: Notif) => { setOpen(false); router.push(n.href); };

  if (!mounted) return null;

  return (
    <>
      <button type="button" className="wx-bell" onClick={toggle} aria-label={unread ? `${unread} new notifications` : "Notifications"} aria-expanded={open}>
        <Bell size={18} strokeWidth={1.9} />
        {unread > 0 && <i>{unread > 9 ? "9+" : unread}</i>}
      </button>
      {pres.mounted && createPortal(
        <div className={`wx-notif-back${pres.out ? " out" : ""}`} onClick={() => setOpen(false)}>
          <div className={`wx-notif${pres.out ? " out" : ""}`} role="dialog" aria-label="Notifications" onClick={(e) => e.stopPropagation()}>
            <div className="wx-notif-grab" aria-hidden="true" />
            <header>
              <strong>Notifications</strong>
              <span>
                {items.length > 0 && <button type="button" onClick={clearAll}>Clear</button>}
                <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
              </span>
            </header>
            <PushToggle prefs={DEFAULT_PREFS} />
            <div className="wx-notif-list">
              {items.length === 0 ? (
                <p className="wx-notif-empty">Nothing yet. You will see buys from traders you follow, their intel, big moves on tokens you saved, and fresh scanner calls here.</p>
              ) : items.map((n) => (
                <button key={n.id} type="button" className={`wx-notif-row${n.ts > seen - 1 && n.ts > (read<number>(SEEN, 0) - 1) ? "" : ""}`} onClick={() => go(n)}>
                  <span className={`wx-notif-ico ${n.kind}`}>
                    {n.img && !badImgs[n.img] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={n.img} alt="" onError={() => setBadImgs((m) => ({ ...m, [n.img as string]: true }))} />
                    ) : (
                      <Bell size={15} />
                    )}
                  </span>
                  <span className="wx-notif-txt">
                    <b>{n.title}</b>
                    {n.body && <small>{n.body}</small>}
                  </span>
                  <em>{ago(n.ts)}</em>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
