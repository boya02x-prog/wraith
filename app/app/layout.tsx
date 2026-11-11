import AppShell from "@/components/AppShell";

// Everything under /app shares one shell: the top bar and bottom tabs stay put while screens change beneath them.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
