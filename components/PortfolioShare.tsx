"use client";
// "Share my portfolio": a sheet with a picture card (avatar, value, change over 24h / 7d / 30d, the realized-profit curve and
// the invite code), drawn on a canvas so the same drawing is the preview, the shared PNG and the copied image.
// Numbers come from the profile page (real wallet + cash + closed trades); nothing is made up here. With no closed trades
// in the range the curve is a flat line, the same as the figure above it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, Link2, Share2, X } from "lucide-react";

export type ShareTrade = { ts: number; usd: number }; // realized profit (+) or loss (-) of one closed trade, in display currency
type Range = "24h" | "7d" | "30d";
const SPAN: Record<Range, number> = { "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };
const W = 1080, H = 1260;

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  if (!src) return res(null);
  const i = new Image();
  i.crossOrigin = "anonymous";
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

export default function PortfolioShare({
  name, username, avatar, value, trades, fmt, onClose,
}: {
  name: string;
  username: string | null;
  avatar: string;
  value: number | null; // portfolio value now, display currency
  trades: ShareTrade[];
  fmt: (n: number) => string; // money formatter (already in the display currency)
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>("24h");
  const [asPct, setAsPct] = useState(false);
  const [showRef, setShowRef] = useState(true);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const [prog, setProg] = useState(0);
  const [playKey, setPlayKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [imgs, setImgs] = useState<{ av: HTMLImageElement | null; ghost: HTMLImageElement | null }>({ av: null, ghost: null });

  useEffect(() => {
    fetch("/api/quests").then((r) => r.json()).then((d: { me?: { refCode?: string } }) => setRef(d.me?.refCode ?? "")).catch(() => undefined);
    void Promise.all([loadImg(avatar), loadImg("/logo.png")]).then(([av, ghost]) => setImgs({ av, ghost }));
  }, [avatar]);

  // cumulative realized profit inside the range -> points for the curve
  const stats = useMemo(() => {
    const now = Date.now();
    const rows = trades.filter((t) => t.ts >= now - SPAN[range]).sort((a, b) => a.ts - b.ts);
    let acc = 0;
    const pts: number[] = [0];
    for (const t of rows) { acc += t.usd; pts.push(acc); }
    const start = value !== null ? value - acc : null;
    return { pts, change: acc, pct: start && start > 0 ? (acc / start) * 100 : null, n: rows.length };
  }, [trades, range, value]);

  const draw = useCallback((c: HTMLCanvasElement, prog = 1) => {
    const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, prog)), 3); // ease-out: fast start, settles at the end
    const g = c.getContext("2d");
    if (!g) return;
    c.width = W; c.height = H;
    const accent = "#ff7b3d";
    // background
    g.fillStyle = "#0a0a0c"; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.5, 0, 40, W * 0.5, 0, 900);
    glow.addColorStop(0, "rgba(255,123,61,.34)"); glow.addColorStop(1, "rgba(255,123,61,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,.045)";
    for (let y = 18; y < H - 190; y += 26) for (let x = (y / 26) % 2 ? 18 : 31; x < W; x += 26) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); }
    // ghost watermark
    if (imgs.ghost) { g.globalAlpha = 0.07; const gw = 620; g.drawImage(imgs.ghost, W - gw + 120, 120, gw, gw * (imgs.ghost.height / imgs.ghost.width)); g.globalAlpha = 1; }
    // identity
    const ax = 96, ay = 96, ar = 62;
    g.save(); g.beginPath(); g.arc(ax + ar, ay + ar, ar, 0, 7); g.clip();
    if (imgs.av) g.drawImage(imgs.av, ax, ay, ar * 2, ar * 2);
    else { g.fillStyle = "#2a1a12"; g.fillRect(ax, ay, ar * 2, ar * 2); g.fillStyle = accent; g.font = "800 64px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText((name[0] ?? "W").toUpperCase(), ax + ar, ay + ar + 4); }
    g.restore();
    g.strokeStyle = accent; g.lineWidth = 5; g.beginPath(); g.arc(ax + ar, ay + ar, ar + 4, 0, 7); g.stroke();
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#fff"; g.font = "800 54px sans-serif"; g.fillText(name.slice(0, 18), 252, 140);
    g.fillStyle = "rgba(255,255,255,.55)"; g.font = "600 34px sans-serif"; g.fillText(username ? `@${username}` : "Wraith trader", 254, 188);
    // pill
    g.fillStyle = "rgba(255,123,61,.18)"; g.beginPath(); g.roundRect(W - 96 - 214, 108, 214, 56, 28); g.fill();
    g.fillStyle = "#ff9a66"; g.font = "800 26px sans-serif"; g.textAlign = "center"; g.fillText("PORTFOLIO", W - 96 - 107, 145); g.textAlign = "left";
    // value + change
    g.fillStyle = "#fff"; g.font = "800 150px sans-serif"; const startVal = value !== null ? value - stats.change : null;
    g.fillText(value !== null && startVal !== null ? fmt(startVal + (value - startVal) * e) : "—", 92, 440);
    const shown = stats.change * e;
    const up = stats.change >= 0;
    const col = up ? "#37d58a" : "#ff5d4d";
    g.fillStyle = col; g.font = "800 56px sans-serif";
    const chg = asPct ? (stats.pct !== null ? `${up ? "+" : ""}${(stats.pct * e).toFixed(1)}%` : "—") : `${up ? "+" : "−"}${fmt(Math.abs(shown))}`;
    g.fillText(chg, 96, 524);
    const cw = g.measureText(chg).width;
    g.fillStyle = "rgba(255,255,255,.5)"; g.font = "600 40px sans-serif"; g.fillText(range, 96 + cw + 22, 522);
    // curve
    const cx = 80, cy = 590, cwid = W - 160, chei = 440;
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const y = cy + (chei / 3) * i; g.beginPath(); g.moveTo(cx, y); g.lineTo(cx + cwid, y); g.stroke(); }
    const pts = stats.pts.length > 1 ? stats.pts : [0, 0];
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const X = (i: number) => cx + (cwid * i) / (pts.length - 1);
    const Y = (v: number) => (hi === lo ? cy + chei / 2 : cy + chei - ((v - lo) / span) * (chei - 40) - 20);
    const path = new Path2D();
    pts.forEach((v, i) => { if (i === 0) path.moveTo(X(i), Y(v)); else { path.lineTo(X(i), Y(pts[i - 1])); path.lineTo(X(i), Y(v)); } });
    path.lineTo(X(pts.length - 1) + 0, Y(pts[pts.length - 1]));
    const fill = new Path2D(path); fill.lineTo(cx + cwid, cy + chei); fill.lineTo(cx, cy + chei); fill.closePath();
    const fg = g.createLinearGradient(0, cy, 0, cy + chei); fg.addColorStop(0, up ? "rgba(55,213,138,.30)" : "rgba(255,93,77,.30)"); fg.addColorStop(1, "rgba(0,0,0,0)");
    g.save(); g.beginPath(); g.rect(cx - 10, cy - 30, (cwid + 20) * Math.min(1, prog), chei + 60); g.clip();
    g.fillStyle = fg; g.fill(fill);
    g.strokeStyle = col; g.lineWidth = 7; g.lineJoin = "round"; g.shadowColor = col; g.shadowBlur = 24; g.stroke(path); g.shadowBlur = 0;
    g.restore();
    const pi = Math.min(pts.length - 1, Math.floor(Math.min(1, prog) * (pts.length - 1)));
    const ex = cx + cwid * Math.min(1, prog), ey = Y(pts[pi]);
    g.fillStyle = col; g.beginPath(); g.arc(ex, ey, 13, 0, 7); g.fill();
    g.fillStyle = "rgba(255,255,255,.4)"; g.font = "600 28px sans-serif";
    g.fillText(stats.n ? `${stats.n} closed trade${stats.n === 1 ? "" : "s"}` : "No closed trades in this range", cx, cy + chei + 56);
    // footer band
    g.fillStyle = accent; g.fillRect(0, H - 170, W, 170);
    g.fillStyle = "#1a0d05"; g.font = "400 78px Impact, 'Arial Narrow', sans-serif"; g.fillText("WRAITH", 80, H - 62);
    g.textAlign = "right";
    if (showRef && ref) {
      g.fillStyle = "rgba(26,13,5,.75)"; g.font = "700 30px sans-serif"; g.fillText("Join with my invite code", W - 80, H - 98);
      g.fillStyle = "#1a0d05"; g.font = "800 62px monospace"; g.fillText(ref, W - 80, H - 40);
    } else { g.fillStyle = "#1a0d05"; g.font = "800 36px sans-serif"; g.fillText("wraith.farm", W - 80, H - 62); }
    g.textAlign = "left";
  }, [imgs, name, username, value, stats, asPct, range, showRef, ref, fmt]);

  // the journey: the curve draws itself and the numbers count up over 10 seconds (plays on open, Replay plays it again)
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => { const p = Math.min(1, (now - t0) / 10000); setProg(p); if (p < 1) raf = requestAnimationFrame(tick); };
    setProg(0); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playKey, range]);
  useEffect(() => { if (canvas.current) draw(canvas.current, prog); }, [draw, prog]);

  const toBlob = () => new Promise<Blob | null>((res) => { const c = document.createElement("canvas"); draw(c); try { c.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(""), 2200); };
  const link = `https://www.wraith.farm/app/u/${encodeURIComponent(username ?? name)}`;

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
      await new Promise<void>((res) => { const f = (now: number) => { const p = Math.min(1, (now - t0) / 10000); draw(c, p); if (p < 1) requestAnimationFrame(f); else setTimeout(res, 700); }; requestAnimationFrame(f); });
      rec.stop(); await done;
      const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `wraith-portfolio.${ext}`, { type: blob.type });
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: ref ? `Trade with me on Wraith. Code ${ref}` : "My Wraith portfolio" }); setSaving(false); return; } } catch { setSaving(false); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); flash("Saved the video");
    } catch { flash("Could not record the video"); }
    setSaving(false);
  };

  const share = async () => {
    const blob = await toBlob();
    if (blob) {
      const file = new File([blob], "wraith-portfolio.png", { type: "image/png" });
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: ref ? `Trade with me on Wraith. Code ${ref}` : "My Wraith portfolio", url: link }); return; } } catch { return; /* sheet closed */ }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "wraith-portfolio.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); flash("Saved the image");
    } else flash("Could not make the image");
  };
  const copyLink = async () => { try { await navigator.clipboard.writeText(ref ? `${link}?ref=${ref}` : link); flash("Link copied"); } catch { flash("Could not copy"); } };
  const copyImage = async () => {
    const blob = await toBlob();
    try { if (blob && navigator.clipboard && "ClipboardItem" in window) { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); flash("Image copied"); return; } } catch { /* fall through */ }
    flash("This browser cannot copy images");
  };

  return (
    <div className="ps-backdrop" role="dialog" aria-modal="true" aria-label="Share my portfolio" onClick={onClose}>
      <div className="ps" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ps-x" onClick={onClose} aria-label="Close"><X size={22} /></button>
        <div className="ps-card"><canvas ref={canvas} aria-label="Portfolio card preview" /></div>
        <div className="ps-opts">
          <div className="ps-seg">{(["24h", "7d", "30d"] as Range[]).map((r) => <button key={r} type="button" className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>)}</div>
          <div className="ps-seg"><button type="button" className={!asPct ? "on" : ""} onClick={() => setAsPct(false)}>$</button><button type="button" className={asPct ? "on" : ""} onClick={() => setAsPct(true)}>%</button></div>
          <button type="button" className={`ps-ref${showRef ? " on" : ""}`} onClick={() => setShowRef((v) => !v)} disabled={!ref}>{showRef ? <Eye size={16} /> : <EyeOff size={16} />} Ref code</button>
        </div>
        <div className="ps-play">
          <button type="button" onClick={() => setPlayKey((k) => k + 1)}>▶ Replay journey</button>
          <button type="button" onClick={() => void saveVideo()} disabled={saving}>{saving ? "Recording 10s…" : "Save video"}</button>
        </div>
        <div className="ps-acts">
          <button type="button" onClick={() => void share()}><span><Share2 size={22} /></span>Share</button>
          <button type="button" onClick={() => void copyLink()}><span><Link2 size={22} /></span>Copy link</button>
          <button type="button" onClick={() => void copyImage()}><span><Copy size={22} /></span>Copy image</button>
        </div>
        {note && <div className="ps-note"><Check size={14} /> {note}</div>}
      </div>
    </div>
  );
}
