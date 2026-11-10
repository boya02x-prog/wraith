// One shared SOL/USD read for the whole page. Every component used to fetch it on its own (50 requests in one session).
// Calls made at the same moment share one request, and the answer is reused for 20 seconds.
let cached: { v: unknown; t: number } | null = null;
let inflight: Promise<unknown> | null = null;

export function fetchSolPrice(): Promise<{ solUsd?: number } | null> {
  if (cached && Date.now() - cached.t < 20_000) return Promise.resolve(cached.v as { solUsd?: number });
  if (!inflight) {
    inflight = fetch("/api/sol-price")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => { if (v && Number(v.solUsd) > 0) cached = { v, t: Date.now() }; return v; })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight as Promise<{ solUsd?: number } | null>;
}
