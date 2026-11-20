import AppShell from "@/components/AppShell";
import PresenceBeat from "@/components/PresenceBeat";
import NativeFeel from "@/components/NativeFeel";
import HeadsUp from "@/components/HeadsUp";

// Everything under /app shares one shell: the top bar and bottom tabs stay put while screens change beneath them.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <><PresenceBeat /><NativeFeel /><HeadsUp /><AppShell>{children}</AppShell></>;
}
