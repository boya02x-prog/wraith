"use client";
// The placeholder shown while a screen's code loads, chosen by the address being opened. The shared /app loading screen used to
// draw the market-list skeleton for EVERY screen, so tapping a token flashed a list of grey cards before the token page appeared.
import { usePathname } from "next/navigation";
import PageSkeleton from "@/components/PageSkeleton";
import TokenSkeleton from "@/components/TokenSkeleton";

export default function RouteSkeleton() {
  const path = usePathname() ?? "";
  const tok = path.match(/^\/app\/token\/([^/?#]+)/);
  if (tok) return <TokenSkeleton address={decodeURIComponent(tok[1])} />;
  if (path.startsWith("/app/traders") || path.startsWith("/app/u/")) return <PageSkeleton kind="traders" />;
  if (path.startsWith("/app/profile")) return <PageSkeleton kind="profile" />;
  if (path.startsWith("/app/quests")) return <PageSkeleton kind="quests" />;
  return <PageSkeleton kind="scanner" />;
}
