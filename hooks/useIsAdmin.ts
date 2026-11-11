"use client";
// Is the signed-in account the owner? Asked once per page load and shared. Only decides whether the Admin menu entry is shown.
import { useEffect, useState } from "react";

let known: boolean | null = null;
let inflight: Promise<boolean> | null = null;

export function useIsAdmin(): boolean {
  const [v, setV] = useState(known ?? false);
  useEffect(() => {
    if (known !== null) { setV(known); return; }
    inflight ??= fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((j: { isAdmin?: boolean }) => (known = !!j.isAdmin))
      .catch(() => false)
      .finally(() => { inflight = null; });
    let alive = true;
    void inflight.then((x) => { if (alive) setV(x); });
    return () => { alive = false; };
  }, []);
  return v;
}
