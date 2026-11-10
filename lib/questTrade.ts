// Client side: after a swap confirms, ask the server to verify it on-chain and credit quest points.
// Fire and forget: never throws, never slows the trade UI. Retries while the trade is still being indexed.
export function reportQuestTrade(chain: "solana" | number, tx: string): void {
  if (typeof window === "undefined" || !tx) return;
  const delays = [4_000, 20_000, 60_000, 180_000];
  const attempt = async (i: number) => {
    try {
      const r = await fetch("/api/quests/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ chain: String(chain), tx }),
      });
      const j = (await r.json().catch(() => ({}))) as { status?: string };
      if (j.status === "pending" && i + 1 < delays.length) setTimeout(() => void attempt(i + 1), delays[i + 1]);
    } catch {
      if (i + 1 < delays.length) setTimeout(() => void attempt(i + 1), delays[i + 1]);
    }
  };
  setTimeout(() => void attempt(0), delays[0]);
}
