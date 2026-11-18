"use client";
// "Share this trade": a picture card for ONE position or closed trade. Token, the profit as the hero number, the price path from your entry
// to now (or to your exit) with the entry marked, three facts (entry, now / exit, time held) and your invite code. Drawn on a canvas, so the
// same drawing is the preview, the saved image, the copied image and the recorded video (the number counts up and the path draws itself).
// Everything comes from your own trade record plus the token's real chart; nothing is invented. No upload is needed or offered.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";

export type PositionCard = {
  symbol: string;
  mint: string;
  imageUrl?: string | null;
  chain?: string;
  entryMcap: number;
  /** market cap now (open position) or at your exit (closed trade) */
  endMcap: number;
  closed: boolean;
  /** what you put in, in display currency; null when unknown */
  invested: number | null;
  entryTs: number;
  exitTs?: number | null;
};
type Pt = { t: number; m: number };
const W = 1080, H = 1350;

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  if (!src) return res(null);
  const i = new Image();
  i.crossOrigin = "anonymous";
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});
const compact = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const held = (ms: number) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m}m` : m < 2880 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`; };

export default function PositionShare({ card, fmt, onClose }: { card: PositionCard; fmt: (n: number) => string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [prog, setProg] = useState(0);
  const [playKey, setPlayKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [imgs, setImgs] = useState<{ tok: HTMLImageElement | null; ghost: HTMLImageElement | null }>({ tok: null, ghost: null });
  const [path, setPath] = useState<Pt[] | null>(null);

  // an open position runs to now; a closed trade to its exit. When the exit time was not recorded there is no real path to draw, so it is a plain
  // entry-to-exit line and the time held is left out (nothing is guessed).
  const noExitTime = card.closed && !card.exitTs;
  const t1 = card.closed ? (card.exitTs ?? card.entryTs + 3600_000) : Date.now();
  const pct = card.entryMcap > 0 ? (card.endMcap / card.entryMcap - 1) * 100 : 0;
  const up = pct >= 0;
  const pnlUsd = card.invested !== null ? (card.invested * pct) / 100 : null;

  useEffect(() => {
    fetch("/api/quests").then((r) => r.json()).then((d: { me?: { refCode?: string } }) => setRef(d.me?.refCode ?? "")).catch(() => undefined);
    void Promise.all([loadImg(card.imageUrl ?? ""), loadImg("/logo.png")]).then(([tok, ghost]) => setImgs({ tok, ghost }));
  }, [card.imageUrl]);

  // the token's real price path between entry and now / exit, scaled so that it STARTS at your entry market cap and ENDS at the end market cap
  useEffect(() => {
    let on = true;
    if (noExitTime) { setPath([]); return () => { on = false; }; }
    (async () => {
      try {
        const url = card.chain && card.chain !== "solana"
          ? `/api/evm-chart?address=${encodeURIComponent(card.mint)}&chain=${encodeURIComponent(card.chain)}&tf=15m`
          : `/api/token-chart?address=${encodeURIComponent(card.mint)}&tf=15m`;
        const j = (await (await fetch(url, { cache: "no-store" })).json()) as { candles?: { t: number; c: number }[] };
        const cs = (j.candles ?? []).filter((x) => x.t >= card.entryTs - 20 * 60_000 && x.t <= t1 + 20 * 60_000 && x.c > 0);
        if (!on || cs.length < 3) { if (on) setPath([]); return; }
        const base = cs.reduce((a, b) => (Math.abs(b.t - card.entryTs) < Math.abs(a.t - card.entryTs) ? b : a)).c;
        const last = cs[cs.length - 1].c;
        const k = card.entryMcap / base;
        // small correction so the line really ends at the real end value (the chart's last candle can lag by a few minutes)
        const fix = last > 0 ? card.endMcap / (last * k) : 1;
        const pts = cs.map((x, i) => ({ t: x.t, m: x.c * k * (i === cs.length - 1 ? fix : 1) }));
        setPath(pts);
      } catch { if (on) setPath([]); }
    })();
    return () => { on = false; };
  }, [card.mint, card.chain, card.entryTs, card.entryMcap, card.endMcap, t1, noExitTime]);

  const series: Pt[] = useMemo(() => (path && path.length >= 3 ? path : [{ t: card.entryTs, m: card.entryMcap }, { t: t1, m: card.endMcap }]), [path, card, t1]);

  const draw = useCallback((c: HTMLCanvasElement, prog = 1) => {
    prog = Math.min(1, Math.max(0, Number.isFinite(prog) ? prog : 1)); // the first animation frame can read slightly below 0
    const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, prog)), 3);
    const g = c.getContext("2d");
    if (!g) return;
    c.width = W; c.height = H;
    const col = up ? "#37d58a" : "#ff5d4d";
    const colSoft = up ? "rgba(55,213,138," : "rgba(255,93,77,";
    // background: deep dark with a faint glow in the result colour (green for a win, red for a loss)
    g.fillStyle = "#08080a"; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.5, 0, 40, W * 0.5, 0, 950);
    glow.addColorStop(0, `${colSoft}.13)`); glow.addColorStop(1, `${colSoft}0)`);
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    if (imgs.ghost) { g.globalAlpha = 0.05; const gw = 700; g.drawImage(imgs.ghost, W - gw + 160, 330, gw, gw * (imgs.ghost.height / imgs.ghost.width)); g.globalAlpha = 1; }
    // header: token
    const ar = 58, ax = 88, ay = 84;
    g.save(); g.beginPath(); g.arc(ax + ar, ay + ar, ar, 0, 7); g.clip();
    if (imgs.tok) g.drawImage(imgs.tok, ax, ay, ar * 2, ar * 2);
    else { g.fillStyle = "#241711"; g.fillRect(ax, ay, ar * 2, ar * 2); g.fillStyle = "#ff7b3d"; g.font = "800 60px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText((card.symbol[0] ?? "?").toUpperCase(), ax + ar, ay + ar + 4); }
    g.restore();
    g.strokeStyle = "rgba(255,255,255,.2)"; g.lineWidth = 4; g.beginPath(); g.arc(ax + ar, ay + ar, ar + 3, 0, 7); g.stroke();
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#fff"; g.font = "800 58px sans-serif"; g.fillText(`$${card.symbol.slice(0, 12)}`, 240, 138);
    g.fillStyle = "rgba(255,255,255,.55)"; g.font = "600 30px sans-serif"; g.fillText(`${(card.chain ?? "solana").toUpperCase()} · ${new Date(card.entryTs).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`, 242, 184);
    const pill = card.closed ? "CLOSED" : "OPEN";
    g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.roundRect(W - 88 - 170, 100, 170, 52, 26); g.fill();
    g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "rgba(255,255,255,.85)"; g.font = "800 24px sans-serif"; g.textAlign = "center"; g.fillText(pill, W - 88 - 85, 135); g.textAlign = "left";
    // hero: the result
    g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 24;
    g.fillStyle = col; g.font = "800 190px sans-serif";
    const shownPct = pct * e;
    g.fillText(`${up ? "+" : "−"}${Math.abs(shownPct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`, 80, 430);
    g.shadowBlur = 0;
    if (pnlUsd !== null) {
      g.fillStyle = "#fff"; g.font = "800 62px sans-serif";
      g.fillText(`${pnlUsd >= 0 ? "+" : "−"}${fmt(Math.abs(pnlUsd * e))}`, 88, 520);
      const w = g.measureText(`${pnlUsd >= 0 ? "+" : "−"}${fmt(Math.abs(pnlUsd * e))}`).width;
      g.fillStyle = "rgba(255,255,255,.5)"; g.font = "600 36px sans-serif"; g.fillText(card.closed ? "realized" : "right now", 88 + w + 22, 516);
    } else {
      g.fillStyle = "rgba(255,255,255,.5)"; g.font = "600 36px sans-serif"; g.fillText(card.closed ? "closed at this result" : "since my entry", 88, 516);
    }
    // path
    const cx = 80, cy = 590, cw = W - 160, ch = 400;
    g.strokeStyle = "rgba(255,255,255,.06)"; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const y = cy + (ch / 3) * i; g.beginPath(); g.moveTo(cx, y); g.lineTo(cx + cw, y); g.stroke(); }
    const t0 = series[0].t, tN = series[series.length - 1].t, ts = tN - t0 || 1;
    const lo = Math.min(...series.map((p) => p.m), card.entryMcap), hi = Math.max(...series.map((p) => p.m), card.entryMcap), sp = hi - lo || 1;
    const X = (t: number) => cx + (cw * (t - t0)) / ts;
    const Y = (m: number) => cy + ch - ((m - lo) / sp) * (ch - 50) - 25;
    // entry line
    g.setLineDash([3, 14]); g.strokeStyle = "rgba(255,255,255,.28)"; g.lineWidth = 3; g.lineCap = "round";
    g.beginPath(); g.moveTo(cx, Y(card.entryMcap)); g.lineTo(cx + cw, Y(card.entryMcap)); g.stroke(); g.setLineDash([]);
    const line = new Path2D();
    series.forEach((p, i) => { if (i === 0) line.moveTo(X(p.t), Y(p.m)); else line.lineTo(X(p.t), Y(p.m)); });
    const area = new Path2D(line); area.lineTo(X(tN), cy + ch); area.lineTo(X(t0), cy + ch); area.closePath();
    const fg = g.createLinearGradient(0, cy, 0, cy + ch); fg.addColorStop(0, `${colSoft}.26)`); fg.addColorStop(1, "rgba(0,0,0,0)");
    g.save(); g.beginPath(); g.rect(cx - 20, cy - 40, (cw + 40) * Math.min(1, prog), ch + 80); g.clip();
    g.fillStyle = fg; g.fill(area);
    g.strokeStyle = col; g.lineWidth = 6; g.lineJoin = "round"; g.shadowColor = col; g.shadowBlur = 14; g.stroke(line); g.shadowBlur = 0;
    g.restore();
    // entry marker (always there) and the moving end dot
    const ex = X(series[0].t), ey = Y(series[0].m);
    g.fillStyle = "#0a0a0c"; g.beginPath(); g.arc(ex, ey, 22, 0, 7); g.fill();
    g.strokeStyle = "#ff7b3d"; g.lineWidth = 5; g.stroke();
    g.fillStyle = "#ff7b3d"; g.font = "800 22px sans-serif"; g.textAlign = "center"; g.fillText("IN", ex, ey + 8); g.textAlign = "left";
    const idx = Math.min(series.length - 1, Math.floor(Math.min(1, prog) * (series.length - 1)));
    const dx = X(series[idx].t), dy = Y(series[idx].m);
    g.fillStyle = col; g.beginPath(); g.arc(dx, dy, 13, 0, 7); g.fill();
    g.fillStyle = "rgba(255,255,255,.4)"; g.font = "600 26px sans-serif"; g.fillText(card.closed ? "Entry to exit" : "Entry to now", cx, cy + ch + 46);
    // three facts
    const bw = (cw - 48) / 3, by = cy + ch + 80, bh = 128;
    const facts: [string, string][] = [["ENTRY", compact(card.entryMcap)], [card.closed ? "EXIT" : "NOW", compact(card.endMcap)], ["HELD", noExitTime ? "—" : held(t1 - card.entryTs)]];
    facts.forEach(([label, val], i) => {
      const bx = cx + i * (bw + 24);
      g.fillStyle = "rgba(255,255,255,.06)"; g.beginPath(); g.roundRect(bx, by, bw, bh, 24); g.fill();
      g.strokeStyle = "rgba(255,255,255,.09)"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "rgba(255,255,255,.5)"; g.font = "700 22px sans-serif"; g.fillText(label, bx + 26, by + 44);
      g.fillStyle = "#fff"; g.font = "800 46px sans-serif"; g.fillText(val, bx + 26, by + 98, bw - 48);
    });
    // footer
    const fh = 150;
    const ff = g.createLinearGradient(0, H - fh, 0, H); ff.addColorStop(0, "rgba(10,10,12,0)"); ff.addColorStop(.25, "rgba(10,10,12,.92)"); ff.addColorStop(1, "rgba(10,10,12,1)");
    g.fillStyle = ff; g.fillRect(0, H - fh, W, fh);
    g.fillStyle = "rgba(255,123,61,.55)"; g.fillRect(80, H - fh + 38, W - 160, 2);
    if (imgs.ghost) { const lh = 64; g.drawImage(imgs.ghost, 80, H - 94, lh * (imgs.ghost.width / imgs.ghost.height), lh); }
    g.fillStyle = "#fff"; g.font = "400 60px Impact, 'Arial Narrow', sans-serif"; g.fillText("WRAITH", 150, H - 40);
    g.textAlign = "right";
    if (ref) { g.fillStyle = "rgba(255,255,255,.55)"; g.font = "600 24px sans-serif"; g.fillText("Join with my invite code", W - 80, H - 84); g.fillStyle = "#ff7b3d"; g.font = "800 50px monospace"; g.fillText(ref, W - 80, H - 34); }
    else { g.fillStyle = "rgba(255,255,255,.7)"; g.font = "700 32px sans-serif"; g.fillText("wraith.farm", W - 80, H - 46); }
    g.textAlign = "left";
  }, [imgs, card, up, pct, pnlUsd, series, t1, ref, fmt]);

  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => { const p = Math.min(1, (now - t0) / 6000); setProg(p); if (p < 1) raf = requestAnimationFrame(tick); };
    setProg(0); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playKey, path]);
  useEffect(() => { if (canvas.current) draw(canvas.current, prog); }, [draw, prog]);

  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(""), 2200); };
  const text = `${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}% on $${card.symbol}${ref ? ` · Trade with me on Wraith, code ${ref}` : ""}`;
  const toBlob = () => new Promise<Blob | null>((res) => { const c = document.createElement("canvas"); draw(c); try { c.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
  const saveImage = async () => {
    const blob = await toBlob();
    if (!blob) { flash("Could not make the image"); return; }
    const file = new File([blob], `wraith-${card.symbol}.png`, { type: "image/png" });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); return; } } catch { return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); flash("Saved the image");
  };
  const copyImage = async () => {
    const blob = await toBlob();
    try { if (blob && navigator.clipboard && "ClipboardItem" in window) { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); flash("Image copied"); return; } } catch { /* fall through */ }
    flash("This browser cannot copy images");
  };
  const saveVideo = async () => {
    if (saving) return;
    const c = document.createElement("canvas");
    if (!("MediaRecorder" in window) || !c.captureStream) { flash("This browser cannot record video"); return; }
    setSaving(true);
    try {
      draw(c, 0);
      const types = ["video/mp4", "video/webm;codecs=vp9", "video/webm"];
      const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(c.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      const done = new Promise<void>((res) => { rec.onstop = () => res(); });
      rec.start();
      const t0 = performance.now();
      await new Promise<void>((res) => { const f = (now: number) => { const p = Math.min(1, (now - t0) / 6000); draw(c, p); if (p < 1) requestAnimationFrame(f); else setTimeout(res, 800); }; requestAnimationFrame(f); });
      rec.stop(); await done;
      const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
      const file = new File([blob], `wraith-${card.symbol}.${blob.type.includes("mp4") ? "mp4" : "webm"}`, { type: blob.type });
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text }); setSaving(false); return; } } catch { setSaving(false); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); flash("Saved the video");
    } catch { flash("Could not record the video"); }
    setSaving(false);
  };

  return (
    <div className="ps-backdrop" role="dialog" aria-modal="true" aria-label="Share this trade" onClick={onClose}>
      <div className="ps" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ps-x" onClick={onClose} aria-label="Close"><X size={22} /></button>
        <div className="ps-card"><canvas ref={canvas} aria-label="Trade card preview" /></div>
        <div className="ps-play">
          <button type="button" onClick={() => setPlayKey((k) => k + 1)}>▶ Replay trade</button>
          <button type="button" onClick={() => void saveVideo()} disabled={saving}>{saving ? "Recording 6s…" : "Save video"}</button>
        </div>
        <div className="ps-acts">
          <button type="button" onClick={() => void saveImage()}><span><Share2 size={22} /></span>Save image</button>
          <button type="button" onClick={() => void copyImage()}><span><Copy size={22} /></span>Copy image</button>
        </div>
        {note && <div className="ps-note"><Check size={14} /> {note}</div>}
      </div>
    </div>
  );
}
