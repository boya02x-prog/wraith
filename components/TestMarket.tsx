"use client";

import { FlaskConical, LoaderCircle } from "lucide-react";
import { useSandboxTokens } from "@/lib/useSandboxTokens";
import type { MemeTrend } from "@/app/app/page";

export default function TestMarket({ onSelectMeme, onOpenTestnet }: { onSelectMeme: (m: MemeTrend) => void; onOpenTestnet: () => void }) {
  const list = useSandboxTokens();
  return (
    <div className="tm">
      <header className="tm-head">
        <h2><FlaskConical size={18} /> Test market</h2>
        <p>Devnet sandbox tokens with fixed prices. Trade, post intel, comment, follow and save them like real tokens.</p>
      </header>
      {list === null ? (
        <div className="tm-empty"><LoaderCircle size={16} className="animate-spin" /> Loading…</div>
      ) : list.length === 0 ? (
        <div className="tm-empty">
          <p>No test tokens yet. Set up the sandbox first.</p>
          <button type="button" className="tn-btn" onClick={onOpenTestnet}>Open Testnet</button>
        </div>
      ) : (
        <div className="tm-list">
          {list.map((t) => (
            <button
              key={t.mint}
              type="button"
              className="tm-row"
              onClick={() => onSelectMeme({ keyword: t.symbol, score: 0, posts: 0, source: "test", contractAddress: t.mint })}
            >
              <span className="tn-sym">{t.symbol.slice(1, 2)}</span>
              <span className="tm-name"><strong>{t.symbol}</strong><small>{t.name}</small></span>
              <span className="tm-price"><small>Price</small><b>{t.priceSol} SOL</b></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
