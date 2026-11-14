"use client";
// "Lookalikes": other tokens with almost the same name or ticker, so a call on "GTA Dollar" shows that "GTA Dollars" exists, how big
// it is and which is older. Size and age only: the biggest copy is often the crowd's choice, not always the original.
import { useEffect, useState } from "react";
import Link from "next/link";

interface Item { address: string; name: string; symbol: string; mcap: number; liquidity: number; volume24h: number; txns24h: number; createdAt: number | null; image: string | null }
const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const age = (t: number | null) => { if (!t) return "—"; const m = (Date.now() - t) / 60000; return m < 90 ? `${Math.max(1, Math.round(m))}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

export default function Lookalikes({ mint, name, symbol, mcap, createdAt, compact = false }: { mint: string; name: string; symbol: string; mcap: number | null; createdAt: number | null; compact?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let on = true;
    if (!name && !symbol) return;
    fetch(`/api/token-lookalikes?mint=${encodeURIComponent(mint)}&name=${encodeURIComponent(name)}&symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json()).then((d: { items?: Item[] }) => { if (on) setItems(d.items ?? []); }).catch(() => { if (on) setItems([]); });
    return () => { on = false; };
  }, [mint, name, symbol]);
  if (!items || items.length === 0) return null;
  const biggest = items[0];
  const bigger = mcap != null && biggest.mcap > mcap * 1.5;
  const older = items.some((i) => i.createdAt && createdAt && i.createdAt < createdAt - 3600e3);
  // the short banner sits above the chart and only speaks up when a bigger copy exists; the full list is further down the page
  if (compact) {
    if (!bigger) return null;
    return (
      <button type="button" className="la-chip" title={`A bigger one exists: ${biggest.symbol} at ${usd(biggest.mcap)}`} onClick={() => document.getElementById("la-full")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
        <b>⚠ {items.length} lookalike{items.length > 1 ? "s" : ""}</b><i>›</i>
      </button>
    );
  }
  return (
    <section id="la-full" className={`la${bigger ? " warn" : ""}`}>
      <div className="la-head">
        <b>{items.length} lookalike{items.length > 1 ? "s" : ""}</b>
        <span>{bigger ? `A bigger one exists: ${biggest.symbol} at ${usd(biggest.mcap)}` : older ? "An older one exists" : "This one is the biggest so far"}</span>
      </div>
      <div className="la-list">
        {items.slice(0, 4).map((i) => (
          <Link key={i.address} href={`/app/token/${i.address}`} className="la-row">
            {i.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={i.image} alt="" /> : <span className="la-ph">{i.symbol[0]}</span>}
            <span className="la-who"><b>{i.name || i.symbol}</b><small>${i.symbol} · {age(i.createdAt)} old</small></span>
            <span className="la-val"><b>{usd(i.mcap)}</b><small>vol {usd(i.volume24h)}</small></span>
          </Link>
        ))}
      </div>
      <p className="la-note">Same or near-identical name. Bigger or older does not prove it is the original: check the creator and socials before you buy.</p>
    </section>
  );
}
