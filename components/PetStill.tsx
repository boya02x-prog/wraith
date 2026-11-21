"use client";
// A pet as a small picture (lib/petStill.ts), for rows and cards. Same look and mood as the live one, drawn once.
import { useEffect, useMemo, useState } from "react";
import { genomeOf, lookOf, moodOf, petKey, type PetStats } from "@/lib/wraithPet";
import { peekPetStill, petStill } from "@/lib/petStill";

export default function PetStill({ seed, stats, size = 64, className }: { seed: string; stats: PetStats | null; size?: number; className?: string }) {
  const look = useMemo(() => { const g = genomeOf(seed, stats); return lookOf(g, moodOf(stats).mood, stats); }, [seed, stats]);
  const key = petKey(look);
  const [got, setGot] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let alive = true;
    if (peekPetStill(look)) return;
    void petStill(look).then((u) => { if (alive && u) setGot({ key, url: u }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const url = peekPetStill(look) ?? (got?.key === key ? got.url : null);
  return (
    <span className={`ps${className ? ` ${className}` : ""}`} style={{ width: size, height: size * 1.14 }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" width={size} height={size * 1.14} draggable={false} />}
    </span>
  );
}
