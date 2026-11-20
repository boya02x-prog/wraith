"use client";
// May the signed-in account see the Auto-trader? Asked once per account per page load and shared. This only decides whether the menu entry is
// shown; the page and its numbers are checked again on the server every time (see /api/auto-trader), so hiding a link is never the lock.
import { useEffect, useState } from "react";

let cachedFor: string | null = null;
let cached = false;
let inflight: { uid: string; p: Promise<boolean> } | null = null;

export function useAutoAccess(userId: string | null | undefined): boolean {
  const [v, setV] = useState(!!userId && cachedFor === userId ? cached : false);
  useEffect(() => {
    if (!userId) { setV(false); return; }
    if (cachedFor === userId) { setV(cached); return; }
    if (!inflight || inflight.uid !== userId) {
      const p: Promise<boolean> = fetch("/api/auto-trader", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { allowed: false }))
        .then((j: { allowed?: boolean }) => { cachedFor = userId; cached = !!j.allowed; return cached; })
        .catch(() => false)
        .finally(() => { if (inflight?.p === p) inflight = null; });
      inflight = { uid: userId, p };
    }
    let alive = true;
    void inflight.p.then((x) => { if (alive) setV(x); });
    return () => { alive = false; };
  }, [userId]);
  return v;
}
