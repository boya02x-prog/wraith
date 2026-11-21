"use client";

// The saved-token bar on a computer, like the watchlist Fomo keeps along the top: every token you saved (the bookmark on any token row) sits in
// a bar under the top bar with its live market cap and 24h move. Click one and the chart window opens under it (components/TokenPeek.tsx);
// the little x that shows on hover takes it off the list. Nothing here shows on a phone or a touch screen, and with nothing saved there is no bar.
// While the bar is up it puts "wx-strip" on <html>, which makes the empty block every screen keeps under the top bar (.wx-header-spacer)
// that much taller, so no screen has to know about it.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Star, X } from "lucide-react";
import type { MemeTrend } from "@/app/app/page";
import { TokenIcon } from "@/components/TokenIcon";
import { SOLANA_MINT_RE } from "@/lib/market";
import { cacheTokenNav } from "@/lib/tokenNav";
import { parseTokenFavorites, toggleTokenFavorite, TOKEN_FAVORITES_EVENT, TOKEN_FAVORITES_KEY } from "@/lib/tokenFavorites";
import { pctShort, usdShort } from "@/lib/tokenFmt";

// the chart library is a separate download that only arrives the first time a window is opened
const TokenPeek = dynamic(() => import("@/components/TokenPeek"), { ssr: false });

type Px = { mcap: number; symbol?: string; imageUrl?: string; change24h?: number | null };
const DESK = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

function onDesk(cb: () => void) {
  const mq = window.matchMedia(DESK);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function onFavs(cb: () => void) {
  window.addEventListener(TOKEN_FAVORITES_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(TOKEN_FAVORITES_EVENT, cb); window.removeEventListener("storage", cb); };
}
function favsText(): string {
  try { return localStorage.getItem(TOKEN_FAVORITES_KEY) ?? "[]"; } catch { return "[]"; }
}

export default function SavedStrip() {
  const router = useRouter();
  const desk = useSyncExternalStore(onDesk, () => window.matchMedia(DESK).matches, () => false);
  const raw = useSyncExternalStore(onFavs, favsText, () => "[]");
  const favs = useMemo(() => parseTokenFavorites(raw), [raw]);
  const [px, setPx] = useState<Record<string, Px>>({});
  const [open, setOpen] = useState<{ token: MemeTrend; left: number; top: number } | null>(null);
  const [more, setMore] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const on = desk && favs.length > 0;

  // the Solana ones get live numbers (30 is the most the price lookup takes at once)
  const key = useMemo(() => favs.map((f) => f.contractAddress ?? "").filter((m) => SOLANA_MINT_RE.test(m)).slice(0, 30).join(","), [favs]);
  useEffect(() => {
    if (!desk || !key) return;
    let alive = true;
    const pull = () => {
      fetch(`/api/signal-prices?mints=${key}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ prices?: Record<string, Px> }>) : null))
        .then((j) => { if (alive && j?.prices) setPx(j.prices); })
        .catch(() => undefined);
    };
    pull();
    const t = window.setInterval(() => { if (!document.hidden) pull(); }, 20_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [desk, key]);

  // every screen keeps a block under the top bar: make it taller by the bar's height while the bar is up
  useEffect(() => {
    document.documentElement.classList.toggle("wx-strip", on);
    return () => document.documentElement.classList.remove("wx-strip");
  }, [on]);

  // a soft fade at the right end only when there are more saved tokens than fit
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const check = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 6);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, [on, favs.length, px]);

  if (!on) return null;
  const openAddr = open?.token.contractAddress;
  const pick = (f: MemeTrend, el: HTMLElement) => {
    const addr = f.contractAddress ?? "";
    if (!SOLANA_MINT_RE.test(addr)) { // other chains have no chart window: straight to the token's own page
      cacheTokenNav(f);
      router.push(`/app/token/${encodeURIComponent(addr)}`);
      return;
    }
    const r = el.getBoundingClientRect();
    setOpen((cur) => (cur?.token.contractAddress === addr ? null : { token: f, left: r.left, top: r.bottom + 12 }));
  };

  return (
    <>
      <div className="sv" role="toolbar" aria-label="Saved tokens">
        <span className="sv-label"><Star size={14} fill="currentColor" />Saved</span>
        <div
          className="sv-track"
          ref={track}
          data-more={more ? "1" : undefined}
          onWheel={(e) => { if (track.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) track.current.scrollLeft += e.deltaY; }}
        >
          {favs.map((f) => {
            const addr = f.contractAddress ?? "";
            const p = px[addr];
            const sym = (f.keyword || p?.symbol || "").replace(/^\$/, "");
            const mc = p?.mcap ?? f.mcap;
            const ch = p?.change24h ?? null;
            return (
              <div key={addr} className={`sv-chip${openAddr === addr ? " on" : ""}`}>
                <button type="button" className="sv-open" onClick={(e) => pick(f, e.currentTarget)} aria-expanded={openAddr === addr}>
                  <TokenIcon contractAddress={addr} imageUrl={f.tokenImageUrl ?? p?.imageUrl} symbol={sym || "T"} size={22} />
                  <b>${sym || "token"}</b>
                  {mc ? <span>{usdShort(mc)}</span> : null}
                  {ch !== null && Number.isFinite(ch) ? <em className={ch >= 0 ? "up" : "down"}>{pctShort(ch)}</em> : null}
                </button>
                <button type="button" className="sv-x" aria-label={`Remove ${sym || "token"} from saved`} title="Remove from saved" onClick={() => toggleTokenFavorite(f)}><X size={11} /></button>
              </div>
            );
          })}
        </div>
      </div>
      {open && <TokenPeek token={open.token} anchor={{ left: open.left, top: open.top }} onClose={() => setOpen(null)} />}
    </>
  );
}
