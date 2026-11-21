"use client";

// The card that appears when you rest the mouse on a call or a token on a computer, like the one Fomo shows over a token in its list: the price,
// market cap and move, volume, liquidity, age, the contract with a copy button, and, on a call, where it was called and where it stands now.
// One host serves the whole app: any element with data-hover-mint="<solana mint>" gets it (optionally data-hover-called="<market cap when called>" and
// data-hover-at="<time called, ms>"). It does nothing on a touch screen (there is no hover there) and reads the token's numbers only when a card is shown.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy } from "lucide-react";
import { TokenIcon } from "@/components/TokenIcon";
import { SOLANA_MINT_RE } from "@/lib/market";
import { ageShort, priceShort, usdShort } from "@/lib/tokenFmt";

type Snap = {
  symbol?: string; name?: string; imageUrl?: string | null; priceUsd?: number; marketCap?: number | null; liquidity?: number; volume24h?: number;
  priceChange?: { h1?: number | null; h24?: number | null }; buys24h?: number; sells24h?: number; pairCreatedAt?: number | null;
};
type Shown = { mint: string; x: number; y: number; called?: number; at?: number };

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

export default function TokenHoverHost() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [snap, setSnap] = useState<Snap | null | undefined>(undefined); // undefined = loading
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const shownRef = useRef<Shown | null>(null);
  useEffect(() => { shownRef.current = shown; }, [shown]); // read by the pointer handler below, which runs between renders

  useEffect(() => {
    let ok = false;
    try { ok = window.matchMedia("(hover: hover) and (pointer: fine)").matches; } catch { /* old browser */ }
    if (!ok) return;
    let showT = 0, hideT = 0, current: Element | null = null, px = 0, py = 0;
    const hide = () => { window.clearTimeout(showT); window.clearTimeout(hideT); current = null; setShown(null); };
    const over = (e: PointerEvent) => {
      px = e.clientX; py = e.clientY;
      const t = e.target as Element | null;
      if (card.current && t && card.current.contains(t)) { window.clearTimeout(hideT); return; } // the pointer went onto the card (to copy the contract)
      const el = t?.closest?.("[data-hover-mint]") ?? null;
      if (el === current) { window.clearTimeout(hideT); return; }
      window.clearTimeout(showT); window.clearTimeout(hideT);
      current = el;
      if (!el) { hideT = window.setTimeout(hide, 160); return; }
      const mint = el.getAttribute("data-hover-mint") ?? "";
      if (!SOLANA_MINT_RE.test(mint)) return;
      showT = window.setTimeout(() => {
        setShown({ mint, x: px, y: py, called: Number(el.getAttribute("data-hover-called")) || undefined, at: Number(el.getAttribute("data-hover-at")) || undefined });
      }, shownRef.current ? 90 : 360); // moving from one token to the next is quick, the first one waits a moment
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    document.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(showT); window.clearTimeout(hideT);
      document.removeEventListener("pointerover", over); window.removeEventListener("scroll", hide, true); window.removeEventListener("blur", hide); document.removeEventListener("keydown", key);
    };
  }, []);

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

  if (!shown || typeof document === "undefined") return null;
  const s = snap ?? null;
  const ch = s?.priceChange?.h24 ?? null;
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
            <TokenIcon contractAddress={shown.mint} imageUrl={s.imageUrl ?? undefined} symbol={s.symbol ?? "T"} size={42} />
            <div className="th-name"><b>{s.symbol ? `$${s.symbol.replace(/^\$/, "")}` : "Token"}</b><small>{s.name ?? ""}</small></div>
            <div className="th-mc"><b>{usd(now)} MC</b>{ch !== null && <small className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "▲" : "▼"} {Math.abs(ch).toFixed(2)}%</small>}</div>
          </div>
          <div className="th-px">{price(s.priceUsd)}</div>
          <div className="th-rows">
            <div className="th-row"><span>Volume 24h</span><i /><b>{usd(s.volume24h)}</b></div>
            <div className="th-row"><span>Liquidity</span><i /><b>{usd(s.liquidity)}</b></div>
            <div className="th-row"><span>Buys / sells 24h</span><i /><b>{(s.buys24h ?? 0).toLocaleString("en-US")} / {(s.sells24h ?? 0).toLocaleString("en-US")}</b></div>
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
