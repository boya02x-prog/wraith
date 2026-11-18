"use client";
// Admin: the two gas wallets (Solana and EVM) with their addresses, balances and a copy button, so the owner knows where to send funds.
import { useEffect, useState } from "react";
import { Check, Copy, Fuel } from "lucide-react";

type Chain = { chain: string; symbol: string; bal: number; topups: number };
type R = { solana: { address: string; sol: number; topups: number } | null; evm: { address: string; chains: Chain[] } | null };
const fmt = (n: number) => (n === 0 ? "0" : n >= 1 ? n.toFixed(3) : n.toFixed(6));
const NAMES: Record<string, string> = { base: "Base", ethereum: "Ethereum", bsc: "BNB Chain", monad: "Monad", robinhood: "Robinhood Chain" };

function Addr({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="ag-addr" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }} title="Copy address">
      <code>{value}</code>{done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export default function AdminGasWallets() {
  const [d, setD] = useState<R | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    fetch("/api/admin/gas-wallets", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (on) { setD(j); setErr(!j); } }).catch(() => { if (on) setErr(true); });
    return () => { on = false; };
  }, []);
  return (
    <section className="q-card ad-card" id="gas">
      <h2><Fuel size={16} /> Gas wallets</h2>
      <p className="q-note">These two wallets pay the network fees for new users&apos; first trades. Send a small amount of each chain&apos;s coin to the address to fund it. Never send tokens other than the chain&apos;s own coin.</p>
      {err && !d ? <p className="q-note">Could not load the wallets right now.</p> : !d ? <div className="wsk-b" style={{ height: 120, borderRadius: 12 }} /> : (
        <div className="ag-grid">
          <div className="ag-card">
            <b>Solana</b>
            {d.solana ? (<>
              <Addr value={d.solana.address} />
              <div className={`ag-bal${d.solana.topups < 100 ? " low" : ""}`}>{fmt(d.solana.sol)} SOL <small>· about {d.solana.topups.toLocaleString()} top-ups left</small></div>
            </>) : <p className="q-note">Not set up (GAS_TREASURY_SOL_KEY is missing).</p>}
          </div>
          <div className="ag-card">
            <b>EVM (one address for every chain below)</b>
            {d.evm ? (<>
              <Addr value={d.evm.address} />
              <div className="ag-chains">
                {d.evm.chains.map((c) => (
                  <div key={c.chain} className={c.topups < 100 ? "low" : ""}><span>{NAMES[c.chain] ?? c.chain}</span><b>{fmt(c.bal)} {c.symbol}</b><small>~{c.topups.toLocaleString()} top-ups</small></div>
                ))}
              </div>
            </>) : <p className="q-note">Not set up (GAS_TREASURY_KEY is missing).</p>}
          </div>
        </div>
      )}
    </section>
  );
}
