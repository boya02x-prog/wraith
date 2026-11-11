"use client";
// What a screen renders where the top bar goes. The real bar lives once in AppShell and stays mounted; this is an invisible
// block of exactly the bar's size (same CSS class, so every breakpoint matches) plus the hand-over of the screen's own
// "a token was picked in search" handler. Outside the shell (should not happen) it falls back to a normal Header.
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useAppShell } from "@/components/AppShell";
import type { MemeTrend } from "@/app/app/page";

const RealHeader = dynamic(() => import("@/components/Header"), { ssr: false });

export default function HeaderSlot({ onSelectMeme }: { onSelectMeme?: (meme: MemeTrend) => void }) {
  const shell = useAppShell();
  useEffect(() => {
    if (!shell) return;
    shell.setSelect(onSelectMeme ?? null);
    return () => shell.setSelect(null);
  }, [shell, onSelectMeme]);
  if (!shell) return <RealHeader onSelectMeme={onSelectMeme} />;
  return <div className="wraith-app-header wx-header-spacer" aria-hidden="true" />;
}
