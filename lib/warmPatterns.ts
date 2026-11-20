"use client";

// Reads the Patterns view's numbers ahead of time (called while the app is idle, see AppShell) and keeps them where the view looks first, so opening
// Patterns shows real numbers at once instead of a "Loading…". The answer is the same for everybody and only changes when the model retrains
// (every few hours), so a copy from a minute ago is as good as a fresh one.
import { writeLast } from "@/lib/lastGood";
import { swrWrite } from "@/lib/swrCache";

export function warmPatterns() {
  fetch("/api/signal-learning", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { patterns?: unknown } | null) => {
      if (d && Array.isArray(d.patterns)) { swrWrite("signal-learning", d); writeLast("signal-learning", d); }
    })
    .catch(() => undefined);
}
