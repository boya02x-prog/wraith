"use client";
// The placeholder shown while a screen's code loads, chosen by the address being opened. The shared /app loading screen used to
// draw the market-list skeleton for EVERY screen, so tapping a token flashed a list of grey cards before the token page appeared.
import { usePathname } from "next/navigation";
import PageSkeleton from "@/components/PageSkeleton";
import TokenPageSkeleton from "@/components/TokenPageSkeleton";
import Header from "@/components/HeaderSlot";

export default function RouteSkeleton() {
  const path = usePathname() ?? "";
  const tok = path.match(/^\/app\/token\/([^/?#]+)/);
  // same wrapper classes and header slot as the real token page, so the placeholder has the SAME layout (flat price bar, chart height)
  if (tok) return (
    <div className="wraith-dashboard wraith-token-page wx-page">
      <Header />
      <TokenPageSkeleton address={decodeURIComponent(tok[1])} />
    </div>
  );
  if (path.startsWith("/app/traders") || path.startsWith("/app/u/")) return <PageSkeleton kind="traders" />;
  if (path.startsWith("/app/profile")) return <PageSkeleton kind="profile" />;
  if (path.startsWith("/app/quests")) return <PageSkeleton kind="quests" />;
  return <PageSkeleton kind="scanner" />;
}
