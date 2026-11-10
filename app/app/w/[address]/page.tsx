"use client";

// A profile for any Solana wallet, even one that never signed up. Labelled as an on-chain wallet, not a Wraith account.
// The header (record + net worth) loads first and fast; the trade list loads next to it and fills in when ready.
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import Header from "@/components/Header";
import WalletAvatar from "@/components/WalletAvatar";
import { TokenIcon } from "@/components/TokenIcon";
import { asKind, KIND_INFO, walletName } from "@/lib/walletIdentity";
import { fmtUsd } from "@/lib/market";
import { swrRead, swrWrite } from "@/lib/swrCache";

interface Holding { mint: string; symbol: string; image: string | null; amount: number; usd: number }
interface Profile {
  address: string;
  wraith: null | { userId: string; displayName: string; username: string | null };
  record: null | { calls: number; wins: number; dumps: number; kind: string; holdPct: number | null; flipPct: number | null; medOffsetS: number | null; avgSol: number | null };
  earlyIn: { address: string; symbol: string; imageUrl: string | null; spottedAt: number; x: number; now: number }[];
  net: null | { solBalance: number; solUsd: number; tokensUsd: number; totalUsd: number; holdings: Holding[] };
}
interface Trades {
  tokens: { mint: string; symbol: string; name: string; image: string | null; buys: number; sells: number; buySol: number; sellSol: number; lastAt: number; holding: boolean; pnlSol: number | null }[];
  swaps: number; solUsd: number | null; historyOk: boolean;
}

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const sol = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
/** how big is this wallet, in plain words */
const reach = (usd: number) => (usd >= 100_000 ? ["Whale", "#38bdf8"] : usd >= 10_000 ? ["Big", "#22c55e"] : usd >= 1_000 ? ["Mid", "#a3e635"] : usd >= 100 ? ["Small", "#f59e0b"] : ["Tiny", "#94a3b8"]) as [string, string];

export default function WalletPage() {
  const params = useParams();
  const router = useRouter();
  const address = decodeURIComponent((params?.address as string) ?? "");
  const [p, setP] = useState<Profile | null>(() => swrRead<Profile>(`wp:${address}`, 5 * 60_000) ?? null);
  const [t, setT] = useState<Trades | null>(() => swrRead<Trades>(`wt:${address}`, 5 * 60_000) ?? null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const [tryNo, setTryNo] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr("");
    // both calls start at the same moment; the header does not wait for the slower trade history
    fetch(`/api/wallet-profile?address=${encodeURIComponent(address)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load this wallet"); return j as Profile; })
      .then((j) => { swrWrite(`wp:${address}`, j); if (alive) setP(j); })
      .catch((e: unknown) => { if (alive) setErr(e instanceof Error ? e.message : "Could not load this wallet"); });
    return () => { alive = false; };
  }, [address]);

  // trade history on its own, so "Try again" re-runs only this part (busy bot wallets can take 10-20s to read)
  useEffect(() => {
    let alive = true;
    fetch(`/api/wallet-trades?address=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Trades>) : Promise.reject()))
      .then((j) => { if (j.historyOk) swrWrite(`wt:${address}`, j); if (alive) setT(j); })
      .catch(() => { if (alive) setT((cur) => cur ?? { tokens: [], swaps: 0, solUsd: null, historyOk: false }); });
    return () => { alive = false; };
  }, [address, tryNo]);

  const goBack = () => { if (window.history.length > 1) router.back(); else router.push("/app"); };
  const kind = asKind(p?.record?.kind);
  const info = KIND_INFO[kind];
  const r = p?.record;
  const net = p?.net ?? null;
  const [reachLabel, reachColor] = reach(net?.totalUsd ?? 0);

  return (
    <main className="wraith-dashboard profile-page">
      <Header />
      <div className="profile-shell wp-shell">
        <button type="button" className="wp-back" onClick={goBack}>← Back</button>
        {err ? <div className="pt-note">{err}</div> : (
          <>
            <section className="wp-head">
              <WalletAvatar address={address} kind={p ? kind : "regular"} size={76} />
              <div className="wp-id">
                <h1>{walletName(address)}</h1>
                <div className="wp-addr">
                  <code>{address.slice(0, 6)}…{address.slice(-6)}</code>
                  <button type="button" aria-label="Copy address" onClick={() => { void navigator.clipboard.writeText(address).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }).catch(() => undefined); }}>{copied ? "Copied" : <Copy size={13} />}</button>
                  <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer" aria-label="Open on Solscan"><ExternalLink size={13} /></a>
                </div>
                <div className="wp-tags">
                  {!p ? <span className="wp-badge">Loading…</span> : p.wraith ? (
                    <Link href={`/app/u/${encodeURIComponent(p.wraith.username || p.wraith.userId)}`} className="wp-badge on">Wraith trader · {p.wraith.displayName}</Link>
                  ) : (
                    <span className="wp-badge" title="This wallet has no Wraith account. Everything here comes from public on-chain data.">On-chain wallet · not a Wraith account</span>
                  )}
                  {r && <span className="pw-kind" style={{ color: info.color, borderColor: info.color }} title={info.blurb}>{info.label}</span>}
                  {net && <span className="pw-kind" style={{ color: reachColor, borderColor: reachColor }} title="By total value of SOL and tokens held right now">{reachLabel}</span>}
                </div>
                {r && <p className="wp-blurb">{info.blurb}.</p>}
              </div>
            </section>

            <section className="wp-stats">
              {net ? (
                <>
                  <div className="wp-big"><b>{fmtUsd(net.totalUsd)}</b><small>net worth now</small></div>
                  <div><b>{sol(net.solBalance)}</b><small>SOL balance ({fmtUsd(net.solUsd)})</small></div>
                  <div><b>{fmtUsd(net.tokensUsd)}</b><small>in tokens</small></div>
                </>
              ) : !p ? <><div className="wp-sk" /><div className="wp-sk" /><div className="wp-sk" /></> : null}
              {r && (
                <>
                  <div><b>{r.calls}</b><small>calls early in</small></div>
                  <div><b className="up">{r.wins}</b><small>reached 2x</small></div>
                  <div><b className="down">{r.dumps}</b><small>ended in a big loss</small></div>
                  {r.holdPct !== null && <div><b>{r.holdPct}%</b><small>still holding at 30 min</small></div>}
                  {r.medOffsetS !== null && <div><b>~{r.medOffsetS}s</b><small>after launch it buys</small></div>}
                  {r.avgSol !== null && <div><b>{r.avgSol}</b><small>SOL per buy</small></div>}
                </>
              )}
            </section>
            {p && !r && <div className="pt-note">Wraith has no record of this wallet in its tracked calls yet.</div>}

            {net && net.holdings.length > 0 && (
              <section className="wp-block">
                <h2>Holding now</h2>
                <div className="wp-chips">
                  {net.holdings.map((h) => (
                    <Link key={h.mint} href={`/app/token/${h.mint}`} className="wp-chip">
                      <TokenIcon contractAddress={h.mint} imageUrl={h.image ?? undefined} symbol={h.symbol} size={26} />
                      <span><b>{h.symbol}</b><small>{fmtUsd(h.usd)}</small></span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="wp-block">
              <h2>Recent trades</h2>
              {!t ? <><div className="wp-skel"><i /><i /><i /></div><p className="wp-foot">Reading this wallet&apos;s swaps. Very busy wallets can take up to 20 seconds.</p></> : !t.historyOk ? <div className="pt-note">Trade history is unavailable right now. <button type="button" className="wp-retry" onClick={() => { setT(null); setTryNo((n) => n + 1); }}>Try again</button></div> : t.tokens.length === 0 ? <div className="pt-note">No recent token swaps found for this wallet.</div> : (
                <div className="wp-list">
                  {t.tokens.map((x) => {
                    const usd = t.solUsd && x.pnlSol !== null ? x.pnlSol * t.solUsd : null;
                    return (
                      <Link key={x.mint} href={`/app/token/${x.mint}`} className="wp-tok">
                        <TokenIcon contractAddress={x.mint} imageUrl={x.image ?? undefined} symbol={x.symbol} size={38} />
                        <div className="wp-tok-main">
                          <b>{x.symbol}</b>
                          <span>{x.holding ? "Bought, still holding" : x.buys ? "Bought and sold" : "Sold"} · {ago(x.lastAt)}</span>
                        </div>
                        <div className="wp-tok-nums">
                          {x.buys > 0 && <span>in {sol(x.buySol)} SOL</span>}
                          {x.sells > 0 && <span>out {sol(x.sellSol)} SOL</span>}
                          {x.pnlSol !== null && <em className={x.pnlSol >= 0 ? "up" : "down"}>{x.pnlSol >= 0 ? "+" : "-"}{sol(Math.abs(x.pnlSol))} SOL{usd !== null ? ` (${fmtUsd(Math.abs(usd))})` : ""}</em>}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              {t?.historyOk && <p className="wp-foot">From the last {t.swaps} swaps Wraith could read for this wallet. Profit/loss only counts tokens it has both bought and sold in that window, so it is an estimate.</p>}
            </section>

            {p && p.earlyIn.length > 0 && (
              <section className="wp-block">
                <h2>Wraith calls it was early in</h2>
                <div className="wp-list">
                  {p.earlyIn.map((c) => (
                    <Link key={c.address} href={`/app/token/${c.address}`} className="wp-tok">
                      <TokenIcon contractAddress={c.address} imageUrl={c.imageUrl ?? undefined} symbol={c.symbol} size={34} />
                      <div className="wp-tok-main"><b>{c.symbol}</b><span>called {ago(c.spottedAt)}</span></div>
                      <div className="wp-tok-nums"><span>peak {c.x.toFixed(1)}x</span><em className={c.now >= 1 ? "up" : "down"}>now {c.now.toFixed(2)}x</em></div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
