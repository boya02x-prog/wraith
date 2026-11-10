"use client";

import { safetyBand } from "@/lib/scoreBand";
import { useEffect, useMemo, useRef, useState } from "react";
import { visibleInterval } from "@/lib/visibleInterval";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ExternalLink, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { TokenCallouts } from "@/components/TokenCallouts";
import SignalsTab from "@/components/SignalsTab";

const TABS = ["Swaps", "Holders", "Signals", "Analysis", "Traders Intel"] as const;
type Tab = (typeof TABS)[number];

export interface TradeRow {
  ageLabel: string;
  type: "Buy" | "Sell";
  amountUsd: number;
  tokens: number;
  mcapAtTrade: number;
  traderShort: string;
  wallet?: string;
}

export interface IntelLink {
  url: string;
  platform: string;
  title: string;
}

export interface AnalysisEntry {
  ts: number;
  mcap: number;
  safetyScore: number;
  prediction: string;
  predictionReason: string;
  safetyBreakdown: { label: string; pass: boolean; detail: string }[];
}

export interface TokenDetailTabsProps {
  thread?: AnalysisEntry[];
  trades?: TradeRow[];
  mint?: string;
  intelLinks?: IntelLink[];
  intelSummary?: string;
  safetyScore?: number;
  safetyBreakdown?: { label: string; pass: boolean; detail: string }[];
  currentMcap?: number | null;
}

type Holder = { wallet: string; quantity: number; share: number };
type WUser = { userId: string; displayName: string; username: string | null; avatar: string; tier: string };
type Trader = {
  userId: string; displayName: string; username: string | null; avatar: string; lastSide: "buy" | "sell"; lastAt: number; count: number;
  holding: { entryMcap: number; currentMcap: number; pnlPct: number } | null;
};

const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(n >= 100 ? 0 : 2)}`);
const qty = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const short = (w: string) => (w.length > 11 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w);
const ago = (ms: number) => { const m = Math.max(1, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

interface WalletIntelData {
  dev: null | { creator: string; created: number; graduated: number; dead: number; recent7d: number; coins: { mint: string; symbol: string; status: "graduated" | "dead" | "live"; mcap: number; ageH: number }[]; bought: boolean };
  buyers: number; proven: number; dumpers: number;
  familiar: { wallet: string; n: number; wins: number; dumps: number }[];
  links: { address: string; symbol: string; outcome: "win" | "dump" | "flat"; shared: number; peak: number }[];
  signals: { tone: "good" | "warn" | "bad" | "info"; text: string }[];
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function WraithWallet({ u, wallet }: { u: WUser; wallet: string }) {
  return (
    <Link href={`/app/u/${encodeURIComponent(u.username ?? u.userId)}`} className="wchip" title={`${u.displayName} · ${u.tier} · ${wallet}`} onClick={(e) => e.stopPropagation()}>
      {u.avatar ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={u.avatar} alt="" /> : <i>{u.displayName[0]?.toUpperCase()}</i>}
      <span>{u.displayName}</span>
      {u.tier !== "GHOST" && <em>{u.tier}</em>}
    </Link>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="dt-empty">
      <span className="dt-empty-orb" />
      <strong>{title}</strong>
      <span>{sub}</span>
    </div>
  );
}

function Ring({ value, size = 76 }: { value: number; size?: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  const color = v >= 70 ? "#37d58a" : v >= 40 ? "#ffba55" : "#e5594a";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`${v} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={size / 3.4} fontWeight="800">{Math.round(v)}</text>
    </svg>
  );
}

export function TokenDetailTabs({ trades = [], mint, intelLinks = [], intelSummary, thread, safetyScore, safetyBreakdown, currentMcap }: TokenDetailTabsProps) {
  const [tab, setTab] = useState<Tab>("Swaps");
  const [holders, setHolders] = useState<Holder[]>([]);
  const [top10, setTop10] = useState<number | null>(null);
  const [holdersState, setHoldersState] = useState<"loading" | "ready" | "error">("loading");
  const [networkHolders, setNetworkHolders] = useState<number | null>(null);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [wi, setWi] = useState<WalletIntelData | null>(null);
  const [wiState, setWiState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const seen = useRef(new Set<string>());
  const [wmap, setWmap] = useState<Record<string, WUser>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    setHolders([]); setTop10(null); setNetworkHolders(null); setHoldersState("loading");
    if (!mint) return;
    let alive = true;
    const loadHolders = async () => {
      try {
        const r = await fetch(`/api/token-holders?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        const d = (await r.json()) as { holders?: Holder[]; top10?: number };
        if (!alive) return;
        if (r.ok && d.holders?.length) { setHolders(d.holders); setTop10(d.top10 ?? null); setHoldersState("ready"); }
        else setHoldersState((s) => (s === "ready" ? s : "error"));
      } catch { if (alive) setHoldersState((s) => (s === "ready" ? s : "error")); }
    };
    const loadCount = async () => {
      try {
        const r = await fetch(`/api/token-holder-count?mint=${encodeURIComponent(mint)}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { holderCount?: unknown };
        if (alive && typeof d.holderCount === "number") setNetworkHolders(d.holderCount);
      } catch { /* optional */ }
    };
    void loadHolders(); void loadCount();
    const a = visibleInterval(() => void loadHolders(), 30_000);
    const b = visibleInterval(() => void loadCount(), 60_000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); };
  }, [mint]);

  useEffect(() => {
    setTraders([]);
    if (!mint) return;
    let alive = true;
    const run = () => fetch(`/api/token-traders?mint=${encodeURIComponent(mint)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: { traders?: Trader[] } | null) => { if (alive && d?.traders) setTraders(d.traders); }).catch(() => undefined);
    void run();
    const t = visibleInterval(run, 20_000);
    window.addEventListener("wraith:trade-recorded", run);
    return () => { alive = false; window.clearInterval(t); window.removeEventListener("wraith:trade-recorded", run); };
  }, [mint]);

  // Wallet intel: deployer history + familiar wallets. Loaded only when the Analysis tab is open.
  useEffect(() => { setWi(null); setWiState("idle"); }, [mint]);
  useEffect(() => {
    if (tab !== "Analysis" || !mint || wi || wiState === "loading") return;
    let alive = true;
    setWiState("loading");
    fetch(`/api/wallet-intel?mint=${encodeURIComponent(mint)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WalletIntelData | null) => { if (!alive) return; if (d && Array.isArray(d.signals)) { setWi(d); setWiState("ready"); } else setWiState("error"); })
      .catch(() => { if (alive) setWiState("error"); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, mint]);

  // Which of these wallets are Wraith users? Those get their profile shown instead of a bare address.
  const walletKey = useMemo(() => [...new Set([...trades.map((t) => t.wallet ?? ""), ...holders.map((h) => h.wallet)].filter(Boolean))].sort().join(","), [trades, holders]);
  useEffect(() => {
    const need = walletKey.split(",").filter((w) => w && !asked.current.has(w)).slice(0, 80);
    if (!need.length) return;
    need.forEach((w) => asked.current.add(w));
    fetch(`/api/wallet-lookup?wallets=${need.join(",")}`).then((r) => (r.ok ? r.json() : null)).then((d: { users?: Record<string, WUser> } | null) => { if (d?.users && Object.keys(d.users).length) setWmap((m) => ({ ...m, ...d.users })); }).catch(() => undefined);
  }, [walletKey]);

  const verifiedLinks = intelLinks
    .map((link) => ({ ...link, safeUrl: safeExternalUrl(link.url) }))
    .filter((link): link is IntelLink & { safeUrl: string } => Boolean(link.safeUrl));

  const sw = useMemo(() => {
    const buys = trades.filter((t) => t.type === "Buy"), sells = trades.filter((t) => t.type === "Sell");
    const bv = buys.reduce((s, t) => s + t.amountUsd, 0), sv = sells.reduce((s, t) => s + t.amountUsd, 0);
    return { buys: buys.length, sells: sells.length, bv, sv, share: bv + sv > 0 ? (bv / (bv + sv)) * 100 : 50, max: Math.max(1, ...trades.map((t) => t.amountUsd)) };
  }, [trades]);

  const badge = (t: Tab): string | null =>
    t === "Swaps" && trades.length ? String(trades.length)
    : t === "Holders" && networkHolders != null ? networkHolders.toLocaleString()
    : t === "Traders Intel" && traders.length ? String(traders.length)
    : null;

  return (
    <section className="dt">
      <style>{CSS}</style>
      <nav className="dt-tabs" aria-label="Token activity">
        {TABS.map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} aria-pressed={tab === item} className={tab === item ? "on" : ""}>
            {item}
            {badge(item) && <i>{badge(item)}</i>}
          </button>
        ))}
      </nav>

      <div className="dt-body" key={tab}>
        {tab === "Swaps" && (trades.length === 0 ? <Empty title="Waiting for swaps" sub="Live trades stream in here the moment they land on-chain." /> : (
          <>
            <div className="dt-strip">
              <div><span>BUYS</span><b className="up">{sw.buys}</b><em>{usd(sw.bv)}</em></div>
              <div className="dt-pressure">
                <div className="dt-bar"><i style={{ width: `${sw.share}%` }} /></div>
                <small>{sw.share.toFixed(0)}% buy pressure</small>
              </div>
              <div style={{ textAlign: "right" }}><span>SELLS</span><b className="dn">{sw.sells}</b><em>{usd(sw.sv)}</em></div>
            </div>
            <div className="dt-table">
              <div className="dt-row dt-head"><span>Age</span><span>Side</span><span>Size</span><span>Tokens</span><span>MCap</span><span>Trader</span></div>
              {trades.map((row, i) => {
                const buy = row.type === "Buy";
                const key = `${row.wallet ?? row.traderShort}-${row.ageLabel}-${i}`;
                const fresh = !seen.current.has(key) && i < 3;
                seen.current.add(key);
                return (
                  <div key={key} className={`dt-row${fresh ? " fresh" : ""}${row.wallet && wmap[row.wallet] ? " wr" : ""}`}>
                    <span className="mute">{row.ageLabel}</span>
                    <span className={`pill ${buy ? "up" : "dn"}`}>{buy ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{row.type}</span>
                    <span className="size"><b className={buy ? "up" : "dn"}>{usd(row.amountUsd)}</b><i className={buy ? "up" : "dn"} style={{ width: `${Math.max(6, (row.amountUsd / sw.max) * 100)}%` }} /></span>
                    <span>{qty(row.tokens)}</span>
                    <span>{row.mcapAtTrade ? usd(row.mcapAtTrade) : "—"}</span>
                    {row.wallet && wmap[row.wallet] ? <WraithWallet u={wmap[row.wallet]} wallet={row.wallet} /> : row.wallet ? <a className="mute lnk" href={`https://solscan.io/account/${row.wallet}`} target="_blank" rel="noopener noreferrer">{row.traderShort}</a> : <span className="mute">{row.traderShort}</span>}
                  </div>
                );
              })}
            </div>
          </>
        ))}

        {tab === "Holders" && (holdersState === "loading" && holders.length === 0 ? <Empty title="Reading the chain…" sub="Loading the biggest wallets." /> : holders.length === 0 ? <Empty title="Top holders unavailable" sub="The RPC is busy. This retries on its own." /> : (
          <>
            <div className="dt-strip">
              <div><span>HOLDERS</span><b>{networkHolders != null ? networkHolders.toLocaleString() : "—"}</b><em>{networkHolders == null ? "counting…" : "on-chain"}</em></div>
              <div className="dt-pressure">
                <div className="dt-bar warn"><i style={{ width: `${Math.min(100, top10 ?? 0)}%` }} /></div>
                <small>top 10 hold {top10 != null ? `${top10.toFixed(1)}%` : "—"}{top10 != null && top10 > 60 ? " · concentrated" : ""}</small>
              </div>
              <div style={{ textAlign: "right" }}><span>TOP HOLDER</span><b>{holders[0].share.toFixed(1)}%</b><em>{short(holders[0].wallet)}</em></div>
            </div>
            <div className="dt-table">
              <div className="dt-row dt-head hold"><span>#</span><span>Wallet</span><span>Tokens</span><span>Share</span></div>
              {holders.map((h, i) => (
                <div key={h.wallet} className={`dt-row hold${wmap[h.wallet] ? " wr" : ""}`}>
                  <span className="mute">{i + 1}</span>
                  {wmap[h.wallet] ? <WraithWallet u={wmap[h.wallet]} wallet={h.wallet} /> : <a className="lnk mono" href={`https://solscan.io/account/${h.wallet}`} target="_blank" rel="noopener noreferrer">{short(h.wallet)}</a>}
                  <span>{qty(h.quantity)}</span>
                  <span className="size"><b>{h.share.toFixed(2)}%</b><i className="amber" style={{ width: `${Math.max(3, Math.min(100, h.share * 3))}%` }} /></span>
                </div>
              ))}
            </div>
            <p className="dt-note">Largest token accounts, merged by owner. Liquidity pools and the bonding curve appear as holders.</p>
          </>
        ))}

        {tab === "Signals" && <SignalsTab mint={mint} currentMcap={currentMcap} />}

        {tab === "Analysis" && (
          safetyScore == null && !intelSummary && verifiedLinks.length === 0 ? <Empty title="No analysis yet" sub="Safety checks and research links appear once Wraith has scanned this token." /> : (
            <div className="dt-pad">
              {thread && thread.length > 0 ? (
                <div className="dt-thread">
                  {thread.map((e, i) => {
                    const prev = i > 0 ? thread[i - 1] : null;
                    const prevPass = new Map((prev?.safetyBreakdown ?? []).map((b) => [b.label, b.pass]));
                    const checks = prev ? e.safetyBreakdown.filter((b) => prevPass.get(b.label) !== b.pass) : e.safetyBreakdown;
                    const stamp = new Date(e.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                    return (
                      <article key={e.ts} className={`dt-th ${i === 0 ? "first" : ""}`}>
                        <header>
                          <b>{i === 0 ? "Initial read" : "Update"}</b>
                          <span>{stamp} · {ago(e.ts)} ago</span>
                        </header>
                        <div className="dt-th-meta">
                          {e.mcap > 0 && <span>MC <b>{usd(e.mcap)}</b></span>}
                          <span>Safety <b>{prev ? `${prev.safetyScore} → ${e.safetyScore}` : e.safetyScore}</b></span>
                          <span className={`dt-th-call ${e.prediction.toLowerCase()}`}>{e.prediction}</span>
                        </div>
                        <p>{e.predictionReason}</p>
                        {checks.length > 0 && (
                          <div className="dt-checks">
                            {checks.map((b) => (
                              <div key={b.label} className={b.pass ? "ok" : "bad"}>
                                <span>{b.pass ? "✓" : "✕"}</span>
                                <div><b>{b.label}</b><small>{b.detail}</small></div>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <p className="dt-note">The first read stays as written. New entries are added only when something material changes.</p>
                </div>
              ) : (<>
              {safetyScore != null && (
                <div className="dt-safety">
                  <Ring value={safetyScore} />
                  <div>
                    <div className="dt-h">{safetyScore >= 70 ? <ShieldCheck size={15} color="#37d58a" /> : <ShieldAlert size={15} color={safetyScore >= 40 ? "#ffba55" : "#e5594a"} />} SAFETY SCORE <span style={{ marginLeft: 6, color: safetyBand(safetyScore).color }}>{safetyBand(safetyScore).label}</span></div>
                    <div className="mute" style={{ fontSize: 10, marginTop: 4, maxWidth: 360, lineHeight: 1.5 }}>{safetyBand(safetyScore).hint}. Checks mint authority, liquidity and holder spread. A high score lowers risk, it never removes it.</div>
                  </div>
                </div>
              )}
              {safetyBreakdown && safetyBreakdown.length > 0 && (
                <div className="dt-checks">
                  {[...safetyBreakdown].sort((a, b) => Number(a.pass) - Number(b.pass)).map((b) => (
                    <div key={b.label} className={b.pass ? "ok" : "bad"}>
                      <span>{b.pass ? "✓" : "✕"}</span>
                      <div><b>{b.label}</b><small>{b.detail}</small></div>
                    </div>
                  ))}
                </div>
              )}
              {intelSummary && <div className="dt-quote">{intelSummary}</div>}
              </>)}
              {mint && (wiState === "loading" || wi) && (
                <div className="dt-wi">
                  <div className="dt-wi-h">WALLET INTEL</div>
                  {!wi ? <p className="dt-note" style={{ margin: 0 }}>Reading the deployer and early buyers…</p> : (<>
                    <div className="dt-wi-list">
                      {wi.signals.map((g, i) => (<div key={i} className={`dt-wi-row ${g.tone}`}><i />{g.text}</div>))}
                    </div>
                    {wi.dev && wi.dev.coins.length > 0 && (
                      <div className="dt-wi-sub">
                        <small>Deployer <a href={`https://solscan.io/account/${wi.dev.creator}`} target="_blank" rel="noopener noreferrer">{short(wi.dev.creator)}</a> · earlier launches</small>
                        <div className="dt-wi-chips">
                          {wi.dev.coins.map((c) => (
                            <Link key={c.mint} href={`/app/token/${c.mint}`} className={`dt-wi-chip ${c.status}`}>
                              <b>{c.symbol}</b><span>{c.status === "graduated" ? "graduated" : c.status === "dead" ? "faded" : usd(c.mcap)}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                    {wi.familiar.length > 0 && (
                      <div className="dt-wi-sub">
                        <small>Familiar early buyers</small>
                        {wi.familiar.map((f) => (
                          <div key={f.wallet} className="dt-wi-fam">
                            <a href={`https://solscan.io/account/${f.wallet}`} target="_blank" rel="noopener noreferrer">{short(f.wallet)}</a>
                            <span>{f.n} calls · <em className="up">{f.wins} won</em> · <em className="dn">{f.dumps} dumped</em></span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="dt-note" style={{ margin: "8px 0 0" }}>Based on {wi.buyers} early buyer wallets and Wraith's own call history. These are observations, not accusations.</p>
                  </>)}
                </div>
              )}
              {verifiedLinks.length > 0 && (
                <div className="dt-links">
                  {verifiedLinks.map((link, index) => (
                    <a key={`${link.safeUrl}-${index}`} href={link.safeUrl} target="_blank" rel="noopener noreferrer">
                      <span><b>{link.platform}</b><i>{link.title || link.url}</i></span>
                      <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {tab === "Traders Intel" && (
          <div>
            <div className="dt-section"><Users size={13} /> WRAITH TRADERS ON THIS TOKEN <em>{traders.length}</em></div>
            {traders.length === 0 ? (
              <p className="dt-note" style={{ margin: "4px 16px 14px" }}>No Wraith trader has bought or sold this yet. Be the first and your position shows up here.</p>
            ) : (
              <div className="dt-traders">
                {traders.map((t) => (
                  <Link key={t.userId} href={`/app/u/${encodeURIComponent(t.username ?? t.userId)}`} className="dt-trader">
                    {t.avatar ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={t.avatar} alt="" /> : <span className="av">{t.displayName[0]?.toUpperCase()}</span>}
                    <span className="who"><b>{t.displayName}</b><small>{t.username ? `@${t.username} · ` : ""}{ago(t.lastAt)} ago · {t.count} trade{t.count > 1 ? "s" : ""}</small></span>
                    <span className={`pill ${t.lastSide === "buy" ? "up" : "dn"}`}>{t.lastSide === "buy" ? "Bought" : "Sold"}</span>
                    {t.holding ? <span className={`pnl ${t.holding.pnlPct >= 0 ? "up" : "dn"}`}>{t.holding.pnlPct >= 0 ? "+" : ""}{t.holding.pnlPct.toFixed(0)}%<small>holding</small></span> : <span className="pnl mute">—<small>out</small></span>}
                  </Link>
                ))}
              </div>
            )}
            <div className="dt-section" style={{ marginTop: 6 }}>INTEL FEED</div>
            {mint && <TokenCallouts mint={mint} currentMcap={currentMcap} />}
          </div>
        )}
      </div>
    </section>
  );
}

const CSS = `
.dt{overflow:hidden;border:1px solid var(--border);border-radius:16px;background:linear-gradient(180deg,var(--surface),var(--bg));font-family:var(--font-mono),'IBM Plex Mono',monospace;color:var(--text)}
.dt-tabs{display:flex;gap:2px;padding:6px 8px 0;border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none}
.dt-tabs button{position:relative;display:inline-flex;align-items:center;gap:7px;padding:11px 14px;border:0;background:transparent;color:var(--text-muted);font:600 11.5px var(--font-mono),monospace;cursor:pointer;white-space:nowrap;border-radius:9px 9px 0 0;transition:color .15s,background .15s}
.dt-tabs button:hover{color:var(--text);background:rgba(255,255,255,.03)}
.dt-tabs button.on{color:var(--orange-hot)}
.dt-tabs button.on::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,var(--orange),transparent);box-shadow:0 0 10px rgba(255,123,61,.7)}
.dt-tabs i{font-style:normal;padding:1px 6px;border-radius:99px;background:rgba(255,255,255,.07);color:var(--text-muted);font-size:9px}
.dt-tabs button.on i{background:rgba(255,123,61,.16);color:var(--orange-hot)}
.dt-body{min-height:200px;animation:dt-in .18s ease-out}
@keyframes dt-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.dt-strip{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}
.dt-strip span{display:block;font-size:9px;letter-spacing:.1em;color:var(--text-muted)}
.dt-strip b{display:block;font-size:20px;line-height:1.2;margin-top:2px}
.dt-strip em{font-style:normal;font-size:10px;color:var(--text-dim)}
.dt-pressure small{display:block;text-align:center;margin-top:6px;font-size:10px;color:var(--text-muted)}
.dt-bar{height:7px;border-radius:4px;background:#e5594a;overflow:hidden}
.dt-bar i{display:block;height:100%;background:#37d58a;border-radius:4px}
.dt-bar.warn{background:rgba(255,255,255,.08)}.dt-bar.warn i{background:linear-gradient(90deg,#ffba55,#ff7b3d)}
.up{color:#37d58a}.dn{color:#e5594a}.mute{color:var(--text-muted)}.mono{font-family:var(--font-mono),monospace}
.dt-table{overflow-x:auto}
.dt-row{display:grid;grid-template-columns:54px 82px minmax(120px,1.4fr) 1fr 1fr 96px;gap:10px;align-items:center;padding:9px 16px;font-size:11px;border-top:1px solid rgba(255,255,255,.04);min-width:560px;transition:background .12s;font-variant-numeric:tabular-nums}
.dt-row.hold{grid-template-columns:36px 1.2fr 1fr minmax(140px,1.4fr);min-width:480px}
.dt-row:not(.dt-head):hover{background:rgba(255,255,255,.025)}
.dt-row.fresh{animation:dt-flash 1.2s ease-out}
@keyframes dt-flash{from{background:rgba(255,123,61,.16)}to{background:transparent}}
.dt-head{border-top:0;color:var(--text-muted);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;padding-top:11px;padding-bottom:7px}
.pill{display:inline-flex;align-items:center;gap:3px;justify-self:start;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:700}
.pill.up{background:rgba(55,213,138,.12);border:1px solid rgba(55,213,138,.3)}.pill.dn{background:rgba(229,89,74,.12);border:1px solid rgba(229,89,74,.3)}
.size{position:relative;display:block}.size b{position:relative;z-index:1;font-size:11px}
.size i{position:absolute;left:0;bottom:-4px;height:2px;border-radius:2px;opacity:.7}
.size i.up{background:#37d58a}.size i.dn{background:#e5594a}.size i.amber{background:linear-gradient(90deg,#ffba55,#ff7b3d)}
.lnk{color:var(--text-muted);text-decoration:none}.lnk:hover{color:var(--orange-hot);text-decoration:underline}
.dt-row.wr{background:rgba(255,123,61,.05);box-shadow:inset 2px 0 0 var(--orange)}
.wchip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 8px 2px 3px;border-radius:99px;border:1px solid rgba(255,123,61,.4);background:rgba(255,123,61,.08);color:var(--text);text-decoration:none;font-size:10.5px;font-weight:700}
.wchip:hover{border-color:var(--orange)}
.wchip img,.wchip i{width:18px;height:18px;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;font-style:normal;font-size:9px;background:linear-gradient(135deg,#ff7b3d,#7a2d10)}
.wchip span{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wchip em{flex:none;white-space:nowrap;font-style:normal;font-size:8px;letter-spacing:.06em;padding:1px 5px;border-radius:5px;background:rgba(255,123,61,.2);color:var(--orange-hot)}
.dt-note{margin:0;padding:10px 16px 14px;font-size:9.5px;color:var(--text-dim);line-height:1.5}
.dt-empty{min-height:200px;display:grid;place-content:center;justify-items:center;gap:7px;padding:24px;text-align:center;color:var(--text-muted);font-size:11px}
.dt-empty strong{color:var(--text);font-size:13px}
.dt-empty-orb{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,rgba(255,123,61,.5),rgba(255,123,61,0) 70%);animation:dt-pulse 1.8s ease-in-out infinite}
@keyframes dt-pulse{50%{transform:scale(1.35);opacity:.55}}
.dt-pad{padding:16px;display:grid;gap:14px}
.dt-safety{display:flex;align-items:center;gap:16px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2)}
.dt-h{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:800;letter-spacing:.1em}
.dt-checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}
.dt-checks>div{display:flex;gap:10px;padding:10px 12px;border-radius:11px;border:1px solid var(--border);background:var(--surface-2)}
.dt-checks span{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;flex:none}
.dt-checks .ok span{background:rgba(55,213,138,.15);color:#37d58a}.dt-checks .bad span{background:rgba(229,89,74,.15);color:#e5594a}
.dt-checks b{display:block;font-size:11px}.dt-checks small{display:block;margin-top:2px;font-size:9.5px;color:var(--text-muted);line-height:1.45}
.dt-quote{padding:13px 15px;border-left:2px solid var(--orange);border-radius:0 11px 11px 0;background:rgba(255,123,61,.06);font-size:11.5px;line-height:1.65}
.dt-links{display:grid;gap:7px}
.dt-links a{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:11px;background:var(--surface-2);color:var(--text);text-decoration:none;font-size:10.5px;transition:border-color .15s}
.dt-links a:hover{border-color:rgba(255,123,61,.5)}
.dt-links b{display:block;color:var(--orange-hot);margin-bottom:3px}.dt-links i{font-style:normal;color:var(--text-muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}
.dt-section{display:flex;align-items:center;gap:7px;padding:14px 16px 8px;font-size:10px;font-weight:800;letter-spacing:.1em;color:var(--text-muted)}
.dt-section em{font-style:normal;padding:1px 7px;border-radius:99px;background:rgba(255,123,61,.14);color:var(--orange-hot);font-size:9px}
.dt-traders{display:grid;gap:6px;padding:0 12px 12px}
.dt-trader{display:grid;grid-template-columns:34px 1fr auto 64px;gap:11px;align-items:center;padding:9px 11px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);color:var(--text);text-decoration:none;transition:border-color .15s,transform .15s}
.dt-trader:hover{border-color:rgba(255,123,61,.45);transform:translateY(-1px)}
.dt-trader img,.dt-trader .av{width:34px;height:34px;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,#ff7b3d,#7a2d10);display:grid;place-items:center;font-weight:800;font-size:13px}
.dt-trader .who b{display:block;font-size:11.5px}.dt-trader small{display:block;font-size:9.5px;color:var(--text-muted);margin-top:2px}
.dt-trader .pnl{text-align:right;font-weight:800;font-size:13px}.dt-trader .pnl small{font-weight:500}
@media (max-width:640px){.dt-strip{grid-template-columns:1fr 1fr}.dt-pressure{grid-column:1/-1;order:3}}
`;
