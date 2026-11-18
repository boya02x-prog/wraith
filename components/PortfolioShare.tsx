"use client";
// "Share my portfolio": a sheet with a picture card (avatar, value, change over 24h / 7d / 30d, the realized-profit curve, three stat boxes and
// the invite code), drawn on a canvas so the same drawing is the preview, the shared PNG, the copied image and the recorded video.
// The background can be YOUR photo or a short video clip of a trade or your account (picked from the device, never uploaded anywhere).
// Numbers come from the profile page (real wallet + cash + closed trades); nothing is made up here. With no closed trades
// in the range the curve is a flat line, the same as the figure above it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, ImagePlus, Link2, Share2, Trash2, X } from "lucide-react";

export type ShareTrade = { ts: number; usd: number }; // realized profit (+) or loss (-) of one closed trade, in display currency
type Range = "24h" | "7d" | "30d";
type Bg = { kind: "image"; el: HTMLImageElement } | { kind: "video"; el: HTMLVideoElement };
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

/** Draws a photo or video frame so it fills the whole card (centered, cropped), like background-size: cover. */
function cover(g: CanvasRenderingContext2D, el: HTMLImageElement | HTMLVideoElement) {
  const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!sw || !sh) return false;
  const k = Math.max(W / sw, H / sh);
  const dw = sw * k, dh = sh * k;
  g.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return true;
}

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [prog, setProg] = useState(0);
  const progRef = useRef(0);
  const [playKey, setPlayKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [imgs, setImgs] = useState<{ av: HTMLImageElement | null; ghost: HTMLImageElement | null }>({ av: null, ghost: null });
  const [bg, setBg] = useState<Bg | null>(null);
  const bgUrl = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/quests").then((r) => r.json()).then((d: { me?: { refCode?: string } }) => setRef(d.me?.refCode ?? "")).catch(() => undefined);
    void Promise.all([loadImg(avatar), loadImg("/logo.png")]).then(([av, ghost]) => setImgs({ av, ghost }));
  }, [avatar]);
  useEffect(() => () => { if (bgUrl.current) URL.revokeObjectURL(bgUrl.current); }, []);

  // cumulative realized profit inside the range -> points for the curve, plus the numbers for the stat boxes
  const stats = useMemo(() => {
    const now = Date.now();
    const rows = trades.filter((t) => t.ts >= now - SPAN[range]).sort((a, b) => a.ts - b.ts);
    let acc = 0;
    const pts: number[] = [0];
    for (const t of rows) { acc += t.usd; pts.push(acc); }
    const start = value !== null ? value - acc : null;
    const wins = rows.filter((t) => t.usd > 0).length;
    const best = rows.reduce((m, t) => Math.max(m, t.usd), 0);
    return { pts, change: acc, pct: start && start > 0 ? (acc / start) * 100 : null, n: rows.length, wins, best };
  }, [trades, range, value]);

  const draw = useCallback((c: HTMLCanvasElement, prog = 1) => {
    const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, prog)), 3); // ease-out: fast start, settles at the end
    const g = c.getContext("2d");
    if (!g) return;
    c.width = W; c.height = H;
    const accent = "#ff7b3d";
    // background: your photo / video, or a deep dark base with a faint warm glow
    g.fillStyle = "#08080a"; g.fillRect(0, 0, W, H);
    const hasBg = bg ? cover(g, bg.el) : false;
    if (hasBg) {
      // keep the picture, but dark enough that every number stays easy to read
      g.fillStyle = "rgba(6,6,8,.52)"; g.fillRect(0, 0, W, H);
      const v = g.createLinearGradient(0, 0, 0, H); v.addColorStop(0, "rgba(6,6,8,.55)"); v.addColorStop(.45, "rgba(6,6,8,.12)"); v.addColorStop(1, "rgba(6,6,8,.9)");
      g.fillStyle = v; g.fillRect(0, 0, W, H);
    } else {
      const glow = g.createRadialGradient(W * 0.5, 0, 40, W * 0.5, 0, 900);
      glow.addColorStop(0, "rgba(255,123,61,.13)"); glow.addColorStop(1, "rgba(255,123,61,0)");
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,.03)";
      for (let y = 18; y < H - 170; y += 26) for (let x = (y / 26) % 2 ? 18 : 31; x < W; x += 26) { g.beginPath(); g.arc(x, y, 1.5, 0, 7); g.fill(); }
      if (imgs.ghost) { g.globalAlpha = 0.06; const gw = 620; g.drawImage(imgs.ghost, W - gw + 120, 120, gw, gw * (imgs.ghost.height / imgs.ghost.width)); g.globalAlpha = 1; }
    }
    // identity
    const ax = 88, ay = 88, ar = 58;
    g.save(); g.beginPath(); g.arc(ax + ar, ay + ar, ar, 0, 7); g.clip();
    if (imgs.av) g.drawImage(imgs.av, ax, ay, ar * 2, ar * 2);
    else { g.fillStyle = "#241711"; g.fillRect(ax, ay, ar * 2, ar * 2); g.fillStyle = accent; g.font = "800 60px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText((name[0] ?? "W").toUpperCase(), ax + ar, ay + ar + 4); }
    g.restore();
    g.strokeStyle = "rgba(255,255,255,.22)"; g.lineWidth = 4; g.beginPath(); g.arc(ax + ar, ay + ar, ar + 3, 0, 7); g.stroke();
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 12;
    g.fillStyle = "#fff"; g.font = "800 52px sans-serif"; g.fillText(name.slice(0, 18), 240, 134);
    g.fillStyle = "rgba(255,255,255,.62)"; g.font = "600 32px sans-serif"; g.fillText(username ? `@${username}` : "Wraith trader", 242, 180);
    g.shadowBlur = 0;
    // pill
    g.fillStyle = "rgba(255,255,255,.08)"; g.beginPath(); g.roundRect(W - 88 - 200, 104, 200, 52, 26); g.fill();
    g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "rgba(255,255,255,.85)"; g.font = "800 24px sans-serif"; g.textAlign = "center"; g.fillText("PORTFOLIO", W - 88 - 100, 138); g.textAlign = "left";
    // value + change
    g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 24;
    g.fillStyle = "#fff"; g.font = "800 148px sans-serif"; const startVal = value !== null ? value - stats.change : null;
    g.fillText(value !== null && startVal !== null ? fmt(startVal + (value - startVal) * e) : "—", 84, 420);
    g.shadowBlur = 0;
    const shown = stats.change * e;
    const up = stats.change >= 0;
    const col = up ? "#37d58a" : "#ff5d4d";
    g.fillStyle = col; g.font = "800 54px sans-serif";
    const chg = asPct ? (stats.pct !== null ? `${up ? "+" : ""}${(stats.pct * e).toFixed(1)}%` : "—") : `${up ? "+" : "−"}${fmt(Math.abs(shown))}`;
    g.fillText(chg, 88, 500);
    const cw = g.measureText(chg).width;
    g.fillStyle = "rgba(255,255,255,.55)"; g.font = "600 38px sans-serif"; g.fillText(range, 88 + cw + 20, 498);
    // curve
    const cx = 80, cy = 548, cwid = W - 160, chei = 330;
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
    const fg = g.createLinearGradient(0, cy, 0, cy + chei); fg.addColorStop(0, up ? "rgba(55,213,138,.26)" : "rgba(255,93,77,.26)"); fg.addColorStop(1, "rgba(0,0,0,0)");
    g.save(); g.beginPath(); g.rect(cx - 10, cy - 30, (cwid + 20) * Math.min(1, prog), chei + 60); g.clip();
    g.fillStyle = fg; g.fill(fill);
    g.strokeStyle = col; g.lineWidth = 6; g.lineJoin = "round"; g.shadowColor = col; g.shadowBlur = 16; g.stroke(path); g.shadowBlur = 0;
    g.restore();
    const pi = Math.min(pts.length - 1, Math.floor(Math.min(1, prog) * (pts.length - 1)));
    const ex = cx + cwid * Math.min(1, prog), ey = Y(pts[pi]);
    g.fillStyle = col; g.beginPath(); g.arc(ex, ey, 12, 0, 7); g.fill();
    // three stat boxes
    const bw = (cwid - 48) / 3, by = cy + chei + 36, bh = 128;
    const winRate = stats.n ? Math.round((stats.wins / stats.n) * 100) : null;
    const boxes: [string, string][] = [
      ["CLOSED TRADES", String(stats.n)],
      ["WIN RATE", winRate !== null ? `${winRate}%` : "—"],
      ["BEST TRADE", stats.best > 0 ? `+${fmt(stats.best)}` : "—"],
    ];
    boxes.forEach(([label, val], i) => {
      const bx = cx + i * (bw + 24);
      g.fillStyle = "rgba(255,255,255,.06)"; g.beginPath(); g.roundRect(bx, by, bw, bh, 24); g.fill();
      g.strokeStyle = "rgba(255,255,255,.09)"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "rgba(255,255,255,.5)"; g.font = "700 22px sans-serif"; g.fillText(label, bx + 26, by + 44);
      g.fillStyle = "#fff"; g.font = "800 46px sans-serif"; g.fillText(val, bx + 26, by + 98, bw - 48);
    });
    // footer: dark, with a thin warm line (no bright band)
    const fh = 150;
    const ff = g.createLinearGradient(0, H - fh, 0, H); ff.addColorStop(0, "rgba(10,10,12,.0)"); ff.addColorStop(.25, "rgba(10,10,12,.92)"); ff.addColorStop(1, "rgba(10,10,12,1)");
    g.fillStyle = ff; g.fillRect(0, H - fh, W, fh);
    g.fillStyle = "rgba(255,123,61,.55)"; g.fillRect(80, H - fh + 38, W - 160, 2);
    if (imgs.ghost) { const lh = 64; g.drawImage(imgs.ghost, 80, H - 94, lh * (imgs.ghost.width / imgs.ghost.height), lh); }
    g.fillStyle = "#fff"; g.font = "400 60px Impact, 'Arial Narrow', sans-serif"; g.fillText("WRAITH", 150, H - 40);
    g.textAlign = "right";
    if (showRef && ref) {
      g.fillStyle = "rgba(255,255,255,.55)"; g.font = "600 24px sans-serif"; g.fillText("Join with my invite code", W - 80, H - 84);
      g.fillStyle = accent; g.font = "800 50px monospace"; g.fillText(ref, W - 80, H - 34);
    } else { g.fillStyle = "rgba(255,255,255,.7)"; g.font = "700 32px sans-serif"; g.fillText("wraith.farm", W - 80, H - 46); }
    g.textAlign = "left";
  }, [imgs, name, username, value, stats, asPct, range, showRef, ref, fmt, bg]);

  // the journey: the curve draws itself and the numbers count up over 10 seconds (plays on open, Replay plays it again)
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => { const p = Math.min(1, (now - t0) / 10000); progRef.current = p; setProg(p); if (p < 1) raf = requestAnimationFrame(tick); };
    progRef.current = 0; setProg(0); raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playKey, range]);
  useEffect(() => { if (canvas.current) draw(canvas.current, prog); }, [draw, prog]);
  // a video background needs a fresh frame every tick, even after the journey has finished
  useEffect(() => {
    if (bg?.kind !== "video") return;
    let raf = 0;
    const loop = () => { if (canvas.current) draw(canvas.current, progRef.current); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [bg, draw]);

  const flash = (m: string) => { setNote(m); window.setTimeout(() => setNote(""), 2200); };
  const pickBg = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 60 * 1024 * 1024) { flash("That file is too big (60 MB max)"); return; }
    if (bgUrl.current) URL.revokeObjectURL(bgUrl.current);
    const url = URL.createObjectURL(f); bgUrl.current = url;
    if (f.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
      try { await v.play(); setBg({ kind: "video", el: v }); } catch { flash("Could not play that video"); }
    } else if (f.type.startsWith("image/")) {
      const i = await loadImg(url);
      if (i) setBg({ kind: "image", el: i }); else flash("Could not open that photo");
    } else flash("Pick a photo or a video");
  };

  const toBlob = () => new Promise<Blob | null>((res) => { const c = document.createElement("canvas"); draw(c); try { c.toBlob((b) => res(b), "image/png"); } catch { res(null); } });
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
        <div className="ps-opts">
          <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { void pickBg(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="ps-ref on" onClick={() => fileRef.current?.click()}><ImagePlus size={16} /> {bg ? "Change photo / video" : "Add a photo or video"}</button>
          {bg && <button type="button" className="ps-ref" onClick={() => { if (bgUrl.current) { URL.revokeObjectURL(bgUrl.current); bgUrl.current = null; } setBg(null); }}><Trash2 size={16} /> Remove</button>}
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
