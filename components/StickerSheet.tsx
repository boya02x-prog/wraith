"use client";

// TikTok-style reaction sheet for comments: built-in Wraith stickers (always on) and GIFs (when a GIPHY key is set).
// A chosen sticker or GIF is turned into a small data URL and attached to the comment.
import { useEffect, useRef, useState } from "react";
import { Search, Smile, TrendingUp, X } from "lucide-react";
import { renderAllStickers } from "@/lib/stickers";

interface Gif { id: string; title: string; url: string; thumb: string }
const QUICK = ["Trending", "Pump", "Rekt", "LFG", "Lol", "Cry", "Wow", "Money"];

export default function StickerSheet({ onPick, onClose }: { onPick: (dataUrl: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"stickers" | "gifs">("stickers");
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [gifState, setGifState] = useState<"idle" | "loading" | "ready" | "off" | "error">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [stickers, setStickers] = useState<{ id: string; text: string; src: string }[]>([]);
  useEffect(() => {
    let alive = true;
    void renderAllStickers((s) => { if (alive) setStickers((list) => (list.some((x) => x.id === s.id) ? list : [...list, s])); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  useEffect(() => {
    if (tab !== "gifs") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setGifState("loading");
      try {
        const query = q === "Trending" ? "" : q;
        const r = await fetch(`/api/gifs?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const j = (await r.json()) as { enabled?: boolean; gifs?: Gif[] };
        if (j.enabled === false) { setGifState("off"); return; }
        if (!r.ok) { setGifState("error"); return; }
        setGifs(j.gifs ?? []);
        setGifState("ready");
      } catch { setGifState("error"); }
    }, q ? 350 : 0);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, tab]);

  const chooseGif = async (g: Gif) => {
    if (busy) return;
    setBusy(g.id);
    try {
      const blob = await (await fetch(g.url)).blob();
      const data = await new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = () => rej(new Error("read")); f.readAsDataURL(blob); });
      if (data.length > 430_000) throw new Error("big");
      onPick(data);
    } catch { setGifState("error"); } finally { setBusy(null); }
  };

  return (
    <div className="ss-sheet" ref={boxRef} role="dialog" aria-label="Stickers and GIFs">
      <div className="ss-head">
        <div className="ss-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "stickers"} className={tab === "stickers" ? "on" : ""} onClick={() => setTab("stickers")}><Smile size={15} /> Stickers</button>
          <button type="button" role="tab" aria-selected={tab === "gifs"} className={tab === "gifs" ? "on" : ""} onClick={() => setTab("gifs")}><TrendingUp size={15} /> GIFs</button>
        </div>
        <button type="button" className="ss-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>

      {tab === "stickers" ? (
        <>
          <p className="ss-label">Wraith stickers</p>
          <div className="ss-grid">
            {stickers.map((s) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <button key={s.id} type="button" onClick={() => onPick(s.src)} title={s.text}><img src={s.src} alt={s.text} /></button>
            ))}
            {Array.from({ length: Math.max(0, 16 - stickers.length) }).map((_, i) => <span key={`sk${i}`} className="ss-skel" />)}
          </div>
        </>
      ) : gifState === "off" ? (
        <p className="ss-note">GIFs are not switched on yet. Add a free GIPHY key as <code>GIPHY_API_KEY</code> in the server settings. Stickers work without it.</p>
      ) : (
        <>
          <div className="ss-search"><Search size={14} /><input value={q === "Trending" ? "" : q} onChange={(e) => setQ(e.target.value)} placeholder="Search GIFs" /></div>
          <div className="ss-chips">{QUICK.map((k) => <button key={k} type="button" className={(q || "Trending") === k ? "on" : ""} onClick={() => setQ(k === "Trending" ? "" : k)}>{k}</button>)}</div>
          {gifState === "error" ? <p className="ss-note">Could not load GIFs. Try again in a moment.</p> : (
            <div className={`ss-grid gifs${gifState === "loading" ? " busy" : ""}`}>
              {gifs.map((g) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <button key={g.id} type="button" onClick={() => void chooseGif(g)} disabled={!!busy} title={g.title}><img src={g.thumb} alt={g.title} loading="lazy" /></button>
              ))}
              {gifState === "ready" && !gifs.length && <p className="ss-note">No GIFs found.</p>}
            </div>
          )}
          <small className="ss-credit">Powered by GIPHY</small>
        </>
      )}
    </div>
  );
}
