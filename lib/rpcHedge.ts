// Server only. Ask a list of JSON-RPC endpoints for one answer without paying for all of them every time.
//
// The proxy used to fire every request at EVERY endpoint at once and keep the first answer. That is fast, but it multiplies each
// user's request by the number of endpoints, so the paid provider key (listed first) was charged for every call even when it would
// have answered alone. Hedging keeps the speed without the waste: the first endpoint goes out immediately, the next one only starts
// if the previous is still silent after `hedgeMs` or has failed, and the first good answer wins.

export interface HedgeOptions {
  /** Hard timeout for each endpoint. */
  timeoutMs?: number;
  /** How long to wait for an endpoint before also asking the next one. */
  hedgeMs?: number;
}

const isRpcError = (d: unknown): boolean =>
  typeof d === "object" && d !== null && "error" in d && Boolean((d as { error?: unknown }).error);

export async function hedgedRpc<T = unknown>(
  urls: string[],
  body: unknown,
  opts: HedgeOptions = {},
): Promise<{ data: T; url: string }> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const hedgeMs = opts.hedgeMs ?? 700;
  const list = [...new Set(urls.filter(Boolean))];
  if (!list.length) throw new Error("no rpc endpoints configured");
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    let next = 0;
    let pending = 0;
    let done = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let firstRpcError: { data: T; url: string } | null = null;
    const errors: string[] = [];
    const controllers: AbortController[] = [];

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      for (const c of controllers) c.abort();
      fn();
    };

    const armHedge = () => {
      if (hedgeTimer) clearTimeout(hedgeTimer);
      if (done || next >= list.length) return;
      hedgeTimer = setTimeout(() => {
        launch();
        armHedge();
      }, hedgeMs);
    };

    const launch = () => {
      if (done || next >= list.length) return;
      const url = list[next++];
      pending++;
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: ctrl.signal,
        cache: "no-store",
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as T;
          if (isRpcError(data)) {
            // a node that answers with an RPC error (rate limit, unsupported call) is worth skipping, but keep its message in case
            // every node says the same thing
            if (!firstRpcError) firstRpcError = { data, url };
            throw new Error("rpc error");
          }
          finish(() => resolve({ data, url }));
        })
        .catch((e: unknown) => {
          errors.push(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          clearTimeout(timer);
          pending--;
          if (done) return;
          if (next < list.length) {
            launch();
            armHedge();
          } else if (pending === 0) {
            finish(() => (firstRpcError ? resolve(firstRpcError) : reject(new Error(errors.join("; ") || "all rpc endpoints failed"))));
          }
        });
    };

    launch();
    armHedge();
  });
}
