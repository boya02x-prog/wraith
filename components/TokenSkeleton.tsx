"use client";
// The token page the instant a token is tapped: name, icon and market cap come from what the list already knew, and every other
// block is a same-size placeholder. The real panel (a big chunk) swaps in without anything moving. Same class names as the real
// header and price block, so the layout cannot jump when the data lands.
import { TokenIcon } from "@/components/TokenIcon";
import { readTokenNav } from "@/lib/tokenNav";

const usd = (n: number | undefined | null) => (n == null ? "" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(2)}K` : `$${n.toFixed(0)}`);

export default function TokenSkeleton({ address }: { address: string }) {
  const m = readTokenNav(address);
  return (
    <div className="wx-panel" aria-busy="true" aria-label="Loading token">
      <header className="wx-token-head">
        <span className="wx-back-btn" aria-hidden="true" />
        <div className="wx-token-id">
          <TokenIcon contractAddress={address} imageUrl={m?.tokenImageUrl ?? undefined} symbol={m?.keyword ?? ""} size={48} />
          <div style={{ minWidth: 0 }}>
            <div className="wx-token-name"><h1>{m?.keyword ?? <span className="wx-skel" style={{ display: "inline-block", width: 90, height: 24 }} />}</h1></div>
            <div className="wx-token-sub"><span className="wx-skel" style={{ display: "inline-block", width: 120, height: 14 }} /></div>
          </div>
        </div>
      </header>
      <div className="wx-pricebar">
        <div className="wx-mcap">{m?.mcap ? usd(m.mcap) : <span className="wx-skel" style={{ display: "inline-block", width: 130, height: 32 }} />}</div>
        <div className="wx-changes">
          {["5m", "1h", "6h", "24h"].map((l) => (
            <div key={l} className="wx-change"><span>{l}</span><b><span className="wx-skel" style={{ display: "inline-block", width: 46, height: 16 }} /></b></div>
          ))}
        </div>
      </div>
      <section className="wx-chart-card" style={{ position: "relative" }}><div className="wx-skel" style={{ position: "absolute", inset: 0, borderRadius: 0 }} /></section>
      <div style={{ padding: "12px 12px 0", display: "grid", gap: 10 }}>
        <div className="wx-skel" style={{ height: 64, borderRadius: 14 }} />
        <div className="wx-skel" style={{ height: 64, borderRadius: 14 }} />
      </div>
    </div>
  );
}
