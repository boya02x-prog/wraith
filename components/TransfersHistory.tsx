"use client";
// Transfers = history of money sent and received (stablecoin cash + SOL), like fomo. Deposit / Withdraw are separate dialogs.
import { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import ChainLogo from "@/components/ChainLogo";
import CashLogo from "@/components/CashLogo";
import { CASH_TOKENS } from "@/lib/cashTokens";
import { CHAINS } from "@/lib/chains";

interface Row { id: string; chain: string; symbol: string; dir: "in" | "out"; amount: number; ts: number; peer: string; usd: boolean }

const CASH_MINTS = new Map(CASH_TOKENS.filter((c) => c.chain === "solana").map((c) => [c.address, c.symbol]));
const short = (a: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");
const when = (ts: number) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function TransfersHistory() {
  const { user } = usePrivy();
  const { connection } = useConnection();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const sol = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "solana" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);
  const evm = useMemo(() => {
    const a = user?.linkedAccounts.find((x) => x.type === "wallet" && x.chainType === "ethereum" && x.walletClientType === "privy");
    return a?.type === "wallet" ? a.address : null;
  }, [user]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const out: Row[] = [];
      await Promise.all([
        (async () => {
          if (!sol) return;
          try {
            const pk = new PublicKey(sol);
            const sigs = await connection.getSignaturesForAddress(pk, { limit: 25 });
            const txs = await connection.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
            txs.forEach((tx, i) => {
              if (!tx?.meta || tx.meta.err) return;
              const ts = (tx.blockTime ?? sigs[i].blockTime ?? 0) * 1000;
              const toks = new Map<string, number>();
              const peers = new Map<string, number>();
              const bal = (list: typeof tx.meta.preTokenBalances) => (list ?? []).filter((b) => CASH_MINTS.has(b.mint));
              const pre = bal(tx.meta.preTokenBalances), post = bal(tx.meta.postTokenBalances);
              const acc = (b: { owner?: string; uiTokenAmount: { uiAmount: number | null } }, sign: number, mint: string) => {
                const v = (b.uiTokenAmount.uiAmount ?? 0) * sign;
                if (b.owner === sol) toks.set(mint, (toks.get(mint) ?? 0) + v);
                else if (b.owner) peers.set(b.owner, (peers.get(b.owner) ?? 0) + v);
              };
              pre.forEach((b) => acc(b, -1, b.mint));
              post.forEach((b) => acc(b, 1, b.mint));
              let found = false;
              toks.forEach((d, mint) => {
                if (Math.abs(d) < 0.005) return;
                found = true;
                const peer = [...peers.entries()].find(([, v]) => Math.sign(v) === -Math.sign(d))?.[0] ?? "";
                out.push({ id: `${sigs[i].signature}:${mint}`, chain: "solana", symbol: CASH_MINTS.get(mint) ?? "USDC", dir: d > 0 ? "in" : "out", amount: Math.abs(d), ts, peer, usd: true });
              });
              if (found) return;
              const keys = tx.transaction.message.accountKeys;
              const idx = keys.findIndex((k) => k.pubkey.toBase58() === sol);
              if (idx < 0) return;
              const d = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
              if (Math.abs(d) < 0.001) return;
              const other = keys.find((k, j) => j !== idx && (tx.meta!.postBalances[j] - tx.meta!.preBalances[j]) * d < 0);
              out.push({ id: sigs[i].signature, chain: "solana", symbol: "SOL", dir: d > 0 ? "in" : "out", amount: Math.abs(d), ts, peer: other?.pubkey.toBase58() ?? "", usd: false });
            });
          } catch { /* partial history is fine */ }
        })(),
        (async () => {
          if (!evm) return;
          try {
            const res = await fetch(`/api/wallet-transfers?address=${evm}`, { cache: "no-store" });
            if (!res.ok) return;
            const data: { rows: { chain: string; symbol: string; dir: "in" | "out"; amount: number; ts: number; peer: string; hash: string }[] } = await res.json();
            data.rows.forEach((r, i) => out.push({ id: `${r.hash}:${i}`, chain: r.chain, symbol: r.symbol, dir: r.dir, amount: r.amount, ts: r.ts, peer: r.peer, usd: true }));
          } catch { /* optional */ }
        })(),
      ]);
      if (alive) { setRows(out.sort((a, b) => b.ts - a.ts)); setLoading(false); }
    };
    void run();
    return () => { alive = false; };
  }, [sol, evm, connection]);

  if (loading) return <div className="tx-empty">Loading transfers…</div>;
  if (!rows.length) return <div className="tx-empty"><strong>No transfers yet</strong><span>Money you deposit, send or receive shows up here.</span></div>;
  return (
    <ul className="tx-list">
      {rows.map((r) => (
        <li key={r.id} className="tx-row">
          <span className={`tx-ico ${r.dir}`}>{r.dir === "in" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span>
          <span className="tx-mid">
            <strong>{r.dir === "in" ? "Received" : "Sent"}</strong>
            <small><ChainLogo chain={r.chain} size={12} /> {CHAINS[r.chain]?.name ?? "Solana"} · {r.ts ? when(r.ts) : "—"}</small>
          </span>
          <span className="tx-end">
            <b className={r.dir}>{r.dir === "in" ? "+" : "-"}{r.usd ? `$${r.amount.toFixed(2)}` : `${r.amount.toFixed(4)} ${r.symbol}`}</b>
            <small>{r.usd && <CashLogo symbol={r.symbol} size={11} />} {r.usd ? r.symbol : ""} {short(r.peer)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
