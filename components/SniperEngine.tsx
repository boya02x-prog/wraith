"use client";

// Auto-buy engine + control panel. Scans the "New" feed, buys tokens that pass every filter (USDC -> token),
// then attaches the configured TP / SL / trail. Runs only while Wraith is open and the tier has `sniper`.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { executeQuickBuy, SwapError } from "@/lib/jupiterSwap";
import { armLiveExit, readRules } from "@/lib/liveExits";
import { OPEN_SNIPER, SNIPER_EVENT, pushLog, readCfg, readLog, spentToday, writeCfg, type SniperCfg, type SniperLog } from "@/lib/sniper";
import type { MarketToken } from "@/lib/market";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SCAN_MS = 15_000;
const MONO = { fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" };
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);

export default function SniperEngine({ allowed }: { allowed: boolean }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { connection } = useConnection();
  const [cfg, setCfg] = useState<SniperCfg>(() => readCfg());
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<SniperLog[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const busy = useRef(false);

  const address = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const wallet = useMemo(() => wallets.find((w) => w.address === address), [wallets, address]);

  useEffect(() => {
    const sync = () => { setCfg(readCfg()); setLog(readLog()); };
    sync();
    const o = () => setOpen(true);
    window.addEventListener(SNIPER_EVENT, sync);
    window.addEventListener(OPEN_SNIPER, o);
    return () => { window.removeEventListener(SNIPER_EVENT, sync); window.removeEventListener(OPEN_SNIPER, o); };
  }, []);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 7000); return () => clearTimeout(t); }, [flash]);

  useEffect(() => {
    if (!allowed || !address || !wallet) return;
    const signer = {
      publicKey: new PublicKey(address),
      signTransaction: async (tx: VersionedTransaction) => {
        const r = await signTransaction({ transaction: tx.serialize(), wallet, chain: "solana:mainnet" });
        return VersionedTransaction.deserialize(r.signedTransaction);
      },
    };
    const tick = async () => {
      const c = readCfg();
      if (!c.on || !c.ack || busy.current || document.hidden) return;
      if (spentToday() + c.buyUsd > c.dailyCapUsd) return;
      if (readRules().length >= c.maxOpen) return;
      busy.current = true;
      try {
        const res = await fetch("/api/market?category=new", { cache: "no-store" });
        if (!res.ok) return;
        const { tokens } = (await res.json()) as { tokens: MarketToken[] };
        const seen = new Set(readLog().map((l) => l.mint));
        const now = Date.now();
        const pick = tokens.find((t) => {
          if (!t.address || seen.has(t.address) || (t.chain && t.chain !== "solana")) return false;
          if (t.mcap < c.mcapMin || t.mcap > c.mcapMax || t.liquidity < c.liqMin) return false;
          if (!t.createdAt || (now - t.createdAt) / 60_000 > c.ageMaxMin) return false;
          if (t.onCurve && !c.includeCurve) return false;
          const n = t.txns.buys + t.txns.sells;
          return n >= 10 && (t.txns.buys / n) * 100 >= c.minBuyRatioPct;
        });
        if (!pick) return;
        try {
          const r = await executeQuickBuy(pick.address, c.buyUsd, signer, connection, { input: { mint: USDC, decimals: 6 } });
          pushLog({ ts: Date.now(), mint: pick.address, symbol: pick.symbol, usd: c.buyUsd, mcap: pick.mcap, sig: r.signature });
          if (c.tpPct || c.slPct || c.trailPct) armLiveExit({ mint: pick.address, symbol: pick.symbol, entryMcap: pick.mcap, tpPct: c.tpPct, slPct: c.slPct, trailPct: c.trailPct });
          void fetch("/api/token-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mint: pick.address, side: "buy", signature: r.signature }) }).catch(() => undefined);
          setFlash(`Sniped ${pick.symbol} · $${c.buyUsd} @ ${usd(pick.mcap)}`);
        } catch (e) {
          const msg = e instanceof SwapError ? e.message : "Buy failed";
          pushLog({ ts: Date.now(), mint: pick.address, symbol: pick.symbol, usd: 0, mcap: pick.mcap, error: msg });
          if (e instanceof SwapError && (e.code === "INSUFFICIENT_SOL" || e.code === "SIGN_REJECTED")) { writeCfg({ ...c, on: false }); setFlash(`Sniper paused: ${msg}`); }
        }
      } finally { busy.current = false; }
    };
    const id = window.setInterval(() => void tick(), SCAN_MS);
    return () => window.clearInterval(id);
  }, [allowed, address, wallet, signTransaction, connection]);

  const set = (patch: Partial<SniperCfg>) => { const n = { ...cfg, ...patch }; setCfg(n); writeCfg(n); };
  const num = (k: keyof SniperCfg, label: string, suffix = "") => (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", color: "var(--text-muted)", fontSize: 9, marginBottom: 4 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", padding: "0 8px", height: 34 }}>
        <input inputMode="decimal" value={String(cfg[k])} onChange={(e) => { const v = Number(e.target.value.replace(/[^0-9.]/g, "")); set({ [k]: Number.isFinite(v) ? v : 0 } as Partial<SniperCfg>); }} style={{ width: "100%", minWidth: 0, background: "transparent", border: 0, outline: 0, color: "var(--text)", fontSize: 13, ...MONO }} />
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{suffix}</span>
      </div>
    </label>
  );

  if (typeof document === "undefined") return null;
  const spent = spentToday();
  return createPortal(
    <>
      {flash && <div role="status" style={{ position: "fixed", bottom: 56, left: 16, zIndex: 2000, padding: "10px 14px", borderRadius: 10, background: "#14241d", border: "1px solid #267454", color: "#55cf91", fontSize: 12, ...MONO }}>{flash}</div>}
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1500, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sniper" style={{ width: "min(520px,100%)", maxHeight: "90dvh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 16, padding: 20, color: "var(--text)", ...MONO }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".08em", color: "var(--orange-hot)" }}>SNIPER · AUTO-BUY</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>Buys new tokens that match your filters, then arms your exit. Real USDC.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: 0, color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>×</button>
            </div>

            {!allowed ? (
              <a href="/#omen" style={{ display: "block", marginTop: 16, padding: 14, border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-muted)", fontSize: 12, textDecoration: "none" }}>🔒 Sniper unlocks at SHADE (250K OMEN).</a>
            ) : !cfg.ack ? (
              <div style={{ marginTop: 16, fontSize: 12, lineHeight: 1.7, color: "var(--text-muted)" }}>
                <p style={{ margin: "0 0 10px" }}><b style={{ color: "var(--text)" }}>Read this first.</b> New tokens are extremely risky and many are scams that cannot be sold. The sniper spends your real USDC without asking each time.</p>
                <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                  <li>It works only while Wraith is open in a visible tab.</li>
                  <li>Your hard caps (per buy, per day, open positions) are the only protection. Keep them small.</li>
                  <li>Stop-loss is not guaranteed: a token can drop faster than it can be sold, or become unsellable.</li>
                  <li>Not financial advice. You can lose everything you put in.</li>
                </ul>
                <button type="button" onClick={() => set({ ack: true })} style={{ width: "100%", minHeight: 44, border: 0, borderRadius: 10, background: "var(--orange)", color: "#fff", fontWeight: 800, cursor: "pointer", ...MONO }}>I understand the risk</button>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => set({ on: !cfg.on })} style={{ width: "100%", minHeight: 46, marginTop: 16, border: `1px solid ${cfg.on ? "#267454" : "var(--border)"}`, borderRadius: 10, background: cfg.on ? "#14241d" : "var(--bg)", color: cfg.on ? "#55cf91" : "var(--text)", fontWeight: 800, cursor: "pointer", ...MONO }}>
                  {cfg.on ? "● SNIPER ON — scanning every 15s" : "○ SNIPER OFF — tap to start"}
                </button>
                <div style={{ fontSize: 10, color: "var(--text-muted)", margin: "8px 2px 14px" }}>Spent today ${spent.toFixed(2)} / ${cfg.dailyCapUsd} · open {readRules().length} / {cfg.maxOpen}</div>

                <div style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 6px" }}>SPENDING LIMITS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>{num("buyUsd", "PER BUY", "$")}{num("dailyCapUsd", "DAILY CAP", "$")}{num("maxOpen", "MAX OPEN")}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", margin: "14px 0 6px" }}>TOKEN FILTERS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                  {num("mcapMin", "MIN MCAP", "$")}{num("mcapMax", "MAX MCAP", "$")}{num("liqMin", "MIN LIQUIDITY", "$")}{num("ageMaxMin", "MAX AGE", "min")}{num("minBuyRatioPct", "MIN BUY RATIO", "%")}
                  <label style={{ display: "flex", alignItems: "end", gap: 8, fontSize: 11, color: "var(--text-muted)", paddingBottom: 8 }}><input type="checkbox" checked={cfg.includeCurve} onChange={(e) => set({ includeCurve: e.target.checked })} /> include bonding-curve tokens</label>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", margin: "14px 0 6px" }}>AUTO-EXIT ON EVERY BUY (0 = off)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>{num("tpPct", "TAKE PROFIT", "%")}{num("slPct", "STOP LOSS", "%")}{num("trailPct", "TRAIL", "%")}</div>

                <div style={{ fontSize: 10, color: "var(--text-muted)", margin: "16px 0 6px" }}>RECENT</div>
                {log.length === 0 ? <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Nothing yet. Matches appear here.</div> : log.slice(0, 8).map((l) => (
                  <div key={l.ts} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "5px 0", borderTop: "1px solid var(--border)", color: l.error ? "#e58d80" : "var(--text)" }}>
                    <span>{l.symbol} @ {usd(l.mcap)}</span><span>{l.error ? l.error : `$${l.usd}`}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
