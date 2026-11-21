"use client";

// The card that appears when you rest the mouse on a call or a token on a computer, like the one Fomo shows over a token in its list: the price,
// market cap and move, volume, liquidity, age, the contract with a copy button, and, on a call, where it was called and where it stands now.
// One host serves the whole app: any element with data-hover-mint="<solana mint>" gets it (optionally data-hover-called="<market cap when called>",
// data-hover-at="<time called, ms>" and data-hover-img="<the token's picture>"). It does nothing on a touch screen (there is no hover there) and
// reads the token's numbers only when a card is shown.
// The card must never outstay the pointer, so it goes away on every one of these: the pointer moves onto something else, leaves the window, presses
// (a click opens the token), the page scrolls or changes, the tab loses focus, Esc, or the element it belongs to is gone or no longer under the pointer
// (a watchdog checks that while a card is up, because a list that re-renders or a page that changes under a still mouse sends no pointer event at all).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { SOLANA_MINT_RE } from "@/lib/market";
import { ageShort, priceShort, usdShort } from "@/lib/tokenFmt";

type Snap = {
  symbol?: string; name?: string; imageUrl?: string | null; priceUsd?: number; marketCap?: number | null; liquidity?: number; volume24h?: number;
  priceChange?: { h1?: number | null; h24?: number | null }; buys24h?: number; sells24h?: number; pairCreatedAt?: number | null;
};
type Shown = { mint: string; x: number; y: number; path: string; called?: number; at?: number; img?: string };

const cache = new Map<string, { at: number; v: Snap | null }>();
const inflight = new Map<string, Promise<Snap | null>>();
function snapshot(mint: string): Promise<Snap | null> {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 20_000) return Promise.resolve(hit.v);
  let p = inflight.get(mint);
  if (!p) {
    p = fetch(`/api/token-price?mint=${encodeURIComponent(mint)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Snap>) : null))
      .catch(() => null)
      .then((v) => { cache.set(mint, { at: Date.now(), v }); inflight.delete(mint); return v; });
    inflight.set(mint, p);
  }
  return p;
}

const usd = usdShort, price = priceShort, age = ageShort;
const W = 330;
const SEL = "[data-hover-mint]";

export default function TokenHoverHost() {
  const pathname = usePathname();
  const [shown, setShown] = useState<Shown | null>(null);
  const [snap, setSnap] = useState<Snap | null | undefined>(undefined); // undefined = loading
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const cur = useRef<Element | null>(null); // the element the card (or the card about to show) belongs to
  const pt = useRef({ x: 0, y: 0, known: false }); // where the pointer last was
  const shownRef = useRef<Shown | null>(null);
  const pathRef = useRef(pathname);
  useEffect(() => { shownRef.current = shown; }, [shown]); // read by the pointer handler below, which runs between renders
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  useEffect(() => {
    let ok = false;
    try { ok = window.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch { /* old browser */ }
    if (!ok) return;
    let showT = 0, hideT = 0;
    const hide = () => { window.clearTimeout(showT); window.clearTimeout(hideT); cur.current = null; setShown(null); };
    const onCard = (t: Element | null) => !!(card.current && t && card.current.contains(t));
    const over = (e: PointerEvent) => {
      pt.current = { x: e.clientX, y: e.clientY, known: true };
      const t = e.target as Element | null;
      if (onCard(t)) { window.clearTimeout(hideT); return; } // the pointer went onto the card (to copy the contract)
      const el = t?.closest?.(SEL) ?? null;
      if (el === cur.current) { window.clearTimeout(hideT); return; }
      window.clearTimeout(showT); window.clearTimeout(hideT);
      cur.current = el;
      if (!el) { hideT = window.setTimeout(hide, 160); return; }
      const mint = el.getAttribute("data-hover-mint") ?? "";
      if (!SOLANA_MINT_RE.test(mint)) return;
      showT = window.setTimeout(() => {
        setShown({
          mint, x: pt.current.x, y: pt.current.y, path: pathRef.current,
          called: Number(el.getAttribute("data-hover-called")) || undefined, at: Number(el.getAttribute("data-hover-at")) || undefined,
          img: el.getAttribute("data-hover-img") || undefined,
        });
      }, shownRef.current ? 90 : 360); // moving from one token to the next is quick, the first one waits a moment
    };
    const move = (e: PointerEvent) => { pt.current = { x: e.clientX, y: e.clientY, known: true }; };
    // a press is a click on the token (it opens): the card has done its job. A press on the card itself (the copy button) keeps it.
    const down = (e: PointerEvent) => { if (!onCard(e.target as Element | null)) hide(); };
    // the pointer left the window (no element receives "over" then, which is how the card used to be left behind)
    const out = (e: PointerEvent) => { if (!e.relatedTarget) { window.clearTimeout(hideT); hideT = window.setTimeout(hide, 120); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    const vis = () => { if (document.hidden) hide(); };
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerout", out, { passive: true });
    document.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(showT); window.clearTimeout(hideT);
      document.removeEventListener("pointerover", over); document.removeEventListener("pointermove", move); document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerout", out); document.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("scroll", hide, true); window.removeEventListener("blur", hide);
    };
  }, []);

  // the watchdog: while a card is up, check that what it belongs to is still there and still under the pointer
  useEffect(() => {
    if (!shown) return;
    const timer = window.setInterval(() => {
      const el = cur.current;
      let gone = !el || !el.isConnected || shown.path !== pathRef.current;
      if (!gone && pt.current.known) {
        const under = document.elementFromPoint(pt.current.x, pt.current.y);
        gone = !under || !((card.current && card.current.contains(under)) || under.closest(SEL) === el);
      }
      if (gone) { cur.current = null; setShown(null); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [shown]);

  const mint = shown?.mint;
  useEffect(() => {
    if (!mint) return;
    let alive = true;
    void snapshot(mint).then((v) => { if (alive) setSnap(v); });
    return () => { alive = false; setSnap(undefined); setCopied(false); };
  }, [mint]);

  // keep the card inside the window: to the right of and below the pointer, flipped when there is no room
  useLayoutEffect(() => {
    if (!shown || !card.current) { setPos(null); return; }
    const h = card.current.offsetHeight;
    const left = shown.x + 18 + W + 8 <= window.innerWidth ? shown.x + 18 : Math.max(8, shown.x - 18 - W);
    const top = Math.max(8, Math.min(shown.y + 16, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [shown, snap]);

  if (!shown || shown.path !== pathname || typeof document === "undefined") return null;
  const s = snap ?? null;
  // A brand-new token's best pool on the price source is sometimes a stub (a dollar of volume, cents of liquidity) whose 24h move and volume
  // say nothing true about the token, and can contradict the token page. Those figures are left out instead of showing a wrong move.
  const thin = !!s && (s.liquidity ?? 0) < 100;
  const ch = thin ? null : s?.priceChange?.h24 ?? null;
  const now = s?.marketCap ?? null;
  const x = shown.called && now ? now / shown.called : null;
  const copy = () => { void navigator.clipboard.writeText(shown.mint).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }).catch(() => undefined); };
  return createPortal(
    <div ref={card} className="th" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, opacity: pos ? 1 : 0 }} role="tooltip">
      {snap === undefined ? (
        <div className="th-sk" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /><i className="c" /><i className="c" /></div>
      ) : !s ? (
        <p className="th-none">No market data for this token yet.</p>
      ) : (
        <>
          <div className="th-top">
            <TokenIcon contractAddress={shown.mint} imageUrl={s.imageUrl ?? shown.img ?? undefined} symbol={s.symbol ?? "T"} size={42} />
            <div className="th-name"><b>{s.symbol ? `$${s.symbol.replace(/^\$/, "")}` : "Token"}</b><small>{s.name ?? ""}</small></div>
            <div className="th-mc"><b>{usd(now)} MC</b>{ch !== null && <small className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "▲" : "▼"} {Math.abs(ch).toFixed(2)}%</small>}</div>
          </div>
          <div className="th-px">{price(s.priceUsd)}</div>
          {thin && <p className="th-thin">Its pool is too thin, or still being indexed, for volume and 24h figures.</p>}
          <div className="th-rows">
            {thin ? (
              <div className="th-row"><span>Liquidity</span><i /><b>Under $100</b></div>
            ) : (
              <>
                <div className="th-row"><span>Volume 24h</span><i /><b>{usd(s.volume24h)}</b></div>
                <div className="th-row"><span>Liquidity</span><i /><b>{usd(s.liquidity)}</b></div>
                <div className="th-row"><span>Buys / sells 24h</span><i /><b>{(s.buys24h ?? 0).toLocaleString("en-US")} / {(s.sells24h ?? 0).toLocaleString("en-US")}</b></div>
              </>
            )}
            <div className="th-row"><span>Age</span><i /><b>{age(s.pairCreatedAt)}</b></div>
            <div className="th-row"><span>Contract</span><i /><b className="th-ca">{shown.mint.slice(0, 4)}…{shown.mint.slice(-4)}<button type="button" onClick={copy} aria-label="Copy the contract address">{copied ? <Check size={14} /> : <Copy size={14} />}</button></b></div>
          </div>
          {shown.called ? (
            <div className="th-call">
              <span>Called at <b>{usd(shown.called)}</b>{shown.at ? ` · ${age(shown.at)} ago` : ""}</span>
              {x !== null && <em className={x >= 1 ? "up" : "down"}>{x >= 10 ? x.toFixed(1) : x.toFixed(2)}x now</em>}
            </div>
          ) : null}
        </>
      )}
    </div>,
    document.body,
  );
}
