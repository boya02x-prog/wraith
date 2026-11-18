"use client";
// The token page before its data arrives: one column on phones, and on desktop the same three columns as the real page
// (market list, token, trade panel), so nothing jumps when the real page appears.
import TokenSkeleton from "@/components/TokenSkeleton";

export default function TokenPageSkeleton({ address }: { address: string }) {
  return (
    <>
      {/* phones: one column */}
      <div className="wx-mobile-body rs-mob"><TokenSkeleton address={address} /></div>
      {/* desktop: the same three columns as the real page (market list, token, trade panel), so nothing jumps when it loads */}
      <div className="wx-workspace rs-desk">
        <aside className="wx-sidebar">
          <div style={{ padding: 12, display: "grid", gap: 10 }}>
            <div className="wx-skel" style={{ height: 34, borderRadius: 10 }} />
            {Array.from({ length: 9 }, (_, i) => <div key={i} className="wx-skel" style={{ height: 56, borderRadius: 12 }} />)}
          </div>
        </aside>
        <div className="wx-center"><TokenSkeleton address={address} /></div>
        <aside className="wx-dock">
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            <div className="wx-skel" style={{ height: 46, borderRadius: 12 }} />
            <div className="wx-skel" style={{ height: 48, borderRadius: 12 }} />
            <div className="wx-skel" style={{ height: 56, borderRadius: 12 }} />
            <div className="wx-skel" style={{ height: 40, borderRadius: 12 }} />
            <div className="wx-skel" style={{ height: 52, borderRadius: 12 }} />
          </div>
        </aside>
      </div>
    </>
  );
}
