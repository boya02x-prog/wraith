"use client";

import { useEffect, useState } from "react";

/**
 * Keeps a sheet / menu / popup mounted for `ms` after it is closed, so it can play a closing animation instead of vanishing.
 *   const p = usePresence(open);
 *   {p.mounted && <div className={p.out ? "thing out" : "thing"}>…</div>}
 * `mounted` is true while open and during the exit; `out` is true only during the exit.
 */
export function usePresence(open: boolean, ms = 190): { mounted: boolean; out: boolean } {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return; }
    const t = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || shown, out: !open && shown };
}
