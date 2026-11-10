"use client";

// Patterns view: what the scanner has learned from its own track record. Everything shown here is measured from real,
// matured calls (did the token reach 2x from the price it was flagged at?). Nothing is a promise about the future.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brain, Copy, ExternalLink, FlaskConical, ShieldAlert, Target, Wallet } from "lucide-react";
import { fmtUsd, type MarketToken } from "@/lib/market";
import { swrRead, swrWrite } from "@/lib/swrCache";
import { TokenIcon } from "@/components/TokenIcon";
import WalletAvatar from "@/components/WalletAvatar";
import { asKind, KIND_INFO, walletName } from "@/lib/walletIdentity";

// What the user had open (the wallets list, which tab) is remembered for the visit, so opening a wallet profile and
// pressing Back lands on the same spot instead of a collapsed list.
const SS_OPEN = "wraith_pt_wallets_open";
const SS_TAB = "wraith_pt_wallets_tab";
const SS_ROW = "wraith_pt_row";
const ssGet = (k: string): string | null => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } };

interface PatternStat { id: string; label: string; hint: string; trap: boolean; calls: number; wins: number; rate: number | null; lift: number | null }
interface Learning {
  model: null | {
    n: number; wins: number; base: number; trainedAt: number; active: boolean;
    holdout: { n: number; auc: number; baseRate: number; topQuartileRate: number; bottomQuartileRate: number; folds?: number[] };
    top: { name: string; w: number }[];
  };
  patterns: PatternStat[];
  coverage: { calls: number; withIntel: number; withIntelPct: number };
  history?: { at: number; calls: number; auc: number | null; active: boolean; rugAuc: number | null }[];
}

/** Is it learning? Each dot is one retrain: its score on calls it never saw, against a coin flip (the dashed line). */
function LearningCurve({ h }: { h: NonNullable<Learning["history"]> }) {
  const pts = h.filter((p) => p.auc !== null);
  if (pts.length < 2) return null;
  const W = 300, H = 74, pad = 8;
  const lo = Math.min(0.45, ...pts.map((p) => p.auc as number)), hi = Math.max(0.7, ...pts.map((p) => p.auc as number));
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.auc as number).toFixed(1)}`).join(" ");
  const first = pts[0], last = pts[pts.length - 1];
  return (
    <div className="pc-curve">
      <div className="pc-curve-head"><b>Is it learning?</b><span>{first.calls.toLocaleString()} → {last.calls.toLocaleString()} calls · score {(first.auc as number).toFixed(2)} → {(last.auc as number).toFixed(2)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score on unseen calls after each retrain">
        <line x1={pad} x2={W - pad} y1={y(0.5)} y2={y(0.5)} stroke="currentColor" strokeOpacity=".25" strokeDasharray="4 4" />
        <path d={d} fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={p.at} cx={x(i)} cy={y(p.auc as number)} r="2.6" fill={p.active ? "var(--orange)" : "var(--text-dim)"} />)}
      </svg>
      <p>Each dot is one retrain, scored only on calls it had never seen. The dashed line is a coin flip (0.50). Dots that are grey were not good enough to change any scores.</p>
    </div>
  );
}
interface Sig { token: MarketToken; score: number; tier: "HOT" | "WATCH"; tags: string[]; risks: string[]; patterns?: string[]; odds?: number }

interface WalletRow { wallet: string; calls: number; wins: number; dumps: number; winRate: number; dumpRate: number; kind: string; holdPct: number | null; flipPct: number | null; medOffsetS: number | null; avgSol: number | null }
interface WalletBoard { proven: WalletRow[]; holders: WalletRow[]; dumpers: WalletRow[]; counts: { tracked: number; proven: number; dumpers: number } }
type WTab = "proven" | "holders" | "dumpers";
const WTABS: { key: WTab; label: string; hint: string }[] = [
  { key: "proven", label: "Proven", hint: "Early in 3+ calls and in a winner (2x) at least 30% of the time, without ending in a big loss most of the time. Being early in winners does not always mean skill: some are bots." },
  { key: "holders", label: "Holders", hint: "Proven wallets that are usually still holding 30 minutes after buying, instead of selling quickly." },
  { key: "dumpers", label: "Wall of shame", hint: "Early in 4+ calls and ended in a 50%+ loss in at least 75% of them. If these are in a token you are about to buy, be careful." },
];
const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function Wallets() {
  // The panel is only ever drawn in the browser (the scanner loads client-side), so reading storage in the first render is safe.
  const [open, setOpenState] = useState(() => ssGet(SS_OPEN) === "1");
  const [tab, setTabState] = useState<WTab>(() => { const v = ssGet(SS_TAB); return v === "holders" || v === "dumpers" ? v : "proven"; });
  const [d, setD] = useState<WalletBoard | null>(() => swrRead<WalletBoard>("wallet-board", 15 * 60_000) ?? null);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const setOpen = (v: boolean) => { setOpenState(v); ssSet(SS_OPEN, v ? "1" : "0"); };
  const setTab = (v: WTab) => { setTabState(v); ssSet(SS_TAB, v); };
  // Always refresh when opened, but keep showing the last list meanwhile so Back from a profile is instant and keeps its scroll spot.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/wallet-board").then((r) => (r.ok ? r.json() : Promise.reject())).then((j: WalletBoard) => { swrWrite("wallet-board", j); if (alive) { setD(j); setErr(false); } }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [open]);
  const rows = d ? (d[tab] ?? []) : [];
  const copy = (w: string) => { void navigator.clipboard.writeText(w).then(() => { setCopied(w); window.setTimeout(() => setCopied(null), 1200); }).catch(() => undefined); };
  return (
    <div className="pw">
      <button type="button" className="pw-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Wallet size={15} />
        <span><b>Wallets behind the patterns</b><em>{d ? `${d.counts.proven.toLocaleString()} proven · ${d.counts.dumpers.toLocaleString()} repeat dumpers · ${d.counts.tracked.toLocaleString()} tracked` : "Proven wallets and repeat dumpers the scanner tracks"}</em></span>
        <i>{open ? "Hide" : "Show"}</i>
      </button>
      {open && (
        <div className="pw-body">
          <div className="pw-tabs" role="tablist">
            {WTABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <p className="pw-hint">{WTABS.find((t) => t.key === tab)?.hint}</p>
          {!d && err ? <div className="pt-note">Could not load wallets right now.</div> : !d ? <div className="pt-note">Loading…</div> : rows.length === 0 ? <div className="pt-note">{tab === "holders" ? "No wallets typed as holders yet." : "None yet."}</div> : (
            <div className="pw-list">
              {rows.map((r, i) => {
                const kind = asKind(r.kind);
                const info = KIND_INFO[kind];
                const shame = tab === "dumpers";
                return (
                  <div key={r.wallet} className="pw-card">
                    <span className="pw-rank">{i + 1}</span>
                    <Link href={`/app/w/${r.wallet}`} aria-label={`Open ${walletName(r.wallet)}`}><WalletAvatar address={r.wallet} kind={kind} size={44} /></Link>
                    <div className="pw-main">
                      <div className="pw-title"><Link href={`/app/w/${r.wallet}`} className="pw-name"><b>{walletName(r.wallet)}</b></Link><code title={r.wallet}>{shortAddr(r.wallet)}</code></div>
                      <div className="pw-tags">
                        <span className="pw-kind" style={{ color: info.color, borderColor: info.color }} title={info.blurb}>{info.label}</span>
                        {r.holdPct !== null && <span>holds {r.holdPct}%</span>}
                        {r.medOffsetS !== null && <span>buys at ~{r.medOffsetS}s</span>}
                        {r.avgSol !== null && <span>{r.avgSol} SOL avg</span>}
                      </div>
                      <div className="pw-bar" title={shame ? `${r.dumps} of ${r.calls} ended in a 50%+ loss` : `${r.wins} of ${r.calls} reached 2x`}>
                        <i className={shame ? "bad" : "good"} style={{ width: `${Math.max(4, Math.round((shame ? r.dumpRate : r.winRate) * 100))}%` }} />
                      </div>
                      <div className="pw-rec">{shame ? <><b>{r.dumps}</b> dumps in {r.calls} calls · {Math.round(r.dumpRate * 100)}%</> : <><b>{r.wins}</b> wins in {r.calls} calls · {Math.round(r.winRate * 100)}% · {Math.round(r.dumpRate * 100)}% ended in a loss</>}</div>
                    </div>
                    <div className="pw-act">
                      <button type="button" onClick={() => copy(r.wallet)} aria-label="Copy wallet address">{copied === r.wallet ? "Copied" : <Copy size={14} />}</button>
                      <a href={`https://solscan.io/account/${r.wallet}`} target="_blank" rel="noopener noreferrer" aria-label="Open on Solscan"><ExternalLink size={14} /></a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(d)}%`);
const ago = (t: number) => { const h = Math.round((Date.now() - t) / 3_600_000); return h < 1 ? "under an hour ago" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export default function PatternsPanel({ signals, onOpen }: { signals: Sig[]; onOpen: (s: Sig) => void }) {
  // last answer first (instant when coming back from a wallet or token), fresh answer right behind it
  const [data, setData] = useState<Learning | null>(() => swrRead<Learning>("signal-learning", 15 * 60_000) ?? null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/signal-learning", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Learning) => { swrWrite("signal-learning", d); if (alive) { setData(d); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  const m = data?.model ?? null;
  const nowCount = (id: string) => signals.filter((s) => s.patterns?.includes(id)).length;
  const matching = (id: string) => signals.filter((s) => s.patterns?.includes(id)).slice(0, 6);
  // which pattern row is expanded is remembered too, so the page is the same height when you come back to it
  const [open, setOpenRow] = useState<string | null>(() => ssGet(SS_ROW) || null);
  const setOpen = (v: string | null) => { setOpenRow(v); ssSet(SS_ROW, v ?? ""); };

  return (
    <div className="pt-wrap">
      {!data && err ? (
        <div className="pt-note">Could not load what the scanner has learned right now.</div>
      ) : !data ? (
        <div className="pt-note">Loading…</div>
      ) : (
        <>
          <div className="pt-cards">
            <div className="pt-card">
              <Brain size={15} /><small>Learning from</small>
              <b>{(m?.n ?? data.coverage.calls).toLocaleString()} calls</b>
              <span>{m ? `${m.wins.toLocaleString()} reached 2x (${pct(m.base)}) · retrained ${ago(m.trainedAt)}` : "Not enough finished calls yet"}</span>
            </div>
            <div className="pt-card">
              <FlaskConical size={15} /><small>Score on unseen calls</small>
              <b>{m ? `${m.holdout.auc.toFixed(2)} AUC` : "n/a"}</b>
              <span>{m ? `0.50 is a coin flip. Tested on later calls it never trained on: the top quarter of picks hit ${pct(m.holdout.topQuartileRate, 0)} vs ${pct(m.holdout.bottomQuartileRate, 0)} for the bottom (${m.holdout.n} calls, ${m.holdout.folds?.length ?? 1} rounds).` : "Needs 300+ finished calls"}</span>
            </div>
            <div className="pt-card">
              <Target size={15} /><small>Model status</small>
              <b className={m?.active ? "ok" : "off"}>{m?.active ? "Active" : "Learning"}</b>
              <span>{m?.active ? "Beats chance on later calls it never saw, so it nudges scores by up to ±6 and shows win odds. The edge is modest: treat it as a tilt, not a guarantee." : "Not better than chance yet, so it is NOT changing any scores. It retrains daily as calls finish."}</span>
            </div>
          </div>

          {data.history && <LearningCurve h={data.history} />}

          {data.coverage.calls > 0 && data.coverage.withIntelPct < 40 && (
            <div className="pt-note">
              Only {data.coverage.withIntelPct}% of past calls recorded smart-wallet, buyer-flow and dev-history data, so the strongest signals have little to learn from yet. That share grows with every new call.
            </div>
          )}

          <div className="pt-table" role="table" aria-label="Pattern track record">
            <div className="pt-row head" role="row">
              <span>Pattern</span><span>Calls</span><span>Hit 2x</span><span>vs avg</span><span>Now</span>
            </div>
            {data.patterns.map((p) => {
              const n = nowCount(p.id);
              const good = p.lift !== null && p.lift >= 1.15;
              const bad = p.lift !== null && p.lift <= 0.85;
              return (
                <div key={p.id} className="pt-item">
                  <button type="button" className="pt-row" role="row" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                    <span className="pt-name"><span className="pt-title">{p.trap ? <ShieldAlert size={14} /> : null}<span>{p.label}</span></span><em>{p.hint}</em></span>
                    <span>{p.calls.toLocaleString()}</span>
                    <span>{p.rate === null ? <i className="mut" title="Needs 15 or more finished calls before a hit rate means anything">too few</i> : pct(p.rate)}</span>
                    <span className={good ? "up" : bad ? "down" : ""}>{p.lift === null ? "n/a" : `${p.lift.toFixed(2)}×`}</span>
                    <span className={n ? "now" : "mut"}>{n || "–"}</span>
                  </button>
                  {open === p.id && (
                    <div className="pt-match">
                      {matching(p.id).length ? matching(p.id).map((s) => (
                        <button key={s.token.address} type="button" onClick={() => onOpen(s)}>
                          <TokenIcon contractAddress={s.token.address} imageUrl={s.token.imageUrl} symbol={s.token.symbol} size={20} />
                          <b>{s.token.symbol}</b><span>{fmtUsd(s.token.mcap)}</span><i>{s.score}{s.odds !== undefined ? ` · ${s.odds}%` : ""}</i>
                        </button>
                      )) : <span className="mut">No token matches this right now.</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Wallets />
          <p className="pt-foot">Hit rates are measured on finished calls, never assumed. A pattern marked a trap that still wins often means that rule needs rethinking, and the scanner will keep showing the real number.</p>
        </>
      )}
    </div>
  );
}
