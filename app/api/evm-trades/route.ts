// EVM trade ledger. POST records a buy/sell made from the Wraith wallet; GET returns the user's open positions
// (average-cost, priced live) and closed trades so the profile can show them next to Solana trades.
import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { CHAINS, EVM_ADDR_RE } from "@/lib/chains";
import { tradeLimiter, checkLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SYM_RE = /^[A-Za-z0-9$._-]{1,24}$/;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Row { userId: string; chain: string; address: string; symbol: string; side: "buy" | "sell"; usd: number; tokens: number; priceUsd: number; mcap: number | null; hash: string; imageUrl: string | null; ts: number }

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success } = await checkLimit(tradeLimiter, session.user.id);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const chain = typeof b.chain === "string" ? b.chain : "";
  const address = typeof b.address === "string" ? b.address.toLowerCase() : "";
  const usd = num(b.usd), tokens = num(b.tokens), priceUsd = num(b.priceUsd), mcap = num(b.mcap);
  if (!CHAINS[chain] || !EVM_ADDR_RE.test(address) || typeof b.symbol !== "string" || !SYM_RE.test(b.symbol)
    || (b.side !== "buy" && b.side !== "sell") || usd === null || usd <= 0 || usd > 1e7 || tokens === null || tokens <= 0
    || priceUsd === null || priceUsd < 0 || typeof b.hash !== "string" || !HASH_RE.test(b.hash))
    return NextResponse.json({ error: "Invalid trade" }, { status: 400 });
  const img = typeof b.imageUrl === "string" && /^https:\/\/.{1,290}$/.test(b.imageUrl) ? b.imageUrl : null;
  const db = await getDb();
  const col = db.collection<Row>("evm_trades");
  const row: Row = { userId: session.user.id, chain, address, symbol: b.symbol, side: b.side, usd, tokens, priceUsd, mcap: mcap && mcap > 0 ? mcap : null, hash: b.hash.toLowerCase(), imageUrl: img, ts: Date.now() };
  await col.updateOne({ userId: row.userId, hash: row.hash, side: row.side }, { $setOnInsert: row }, { upsert: true });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await getDb();
    const rows = await db.collection<Row>("evm_trades").find({ userId: session.user.id }).sort({ ts: 1 }).limit(2000).toArray();
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = `${r.chain}:${r.address}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }

    const closed: { id: string; symbol: string; mint: string; chain: string; costUsd: number; proceedsUsd: number; pnlPct: number; entryMcap: number; exitMcap: number; ts: number; imageUrl: string | null }[] = [];
    const open: { id: string; symbol: string; mint: string; chain: string; qty: number; costUsd: number; entryMcap: number; ts: number; imageUrl: string | null }[] = [];
    for (const [, list] of groups) {
      let qty = 0, cost = 0, mcapW = 0, firstTs = 0;
      for (const t of list) {
        if (t.side === "buy") { if (qty <= 0) firstTs = t.ts; qty += t.tokens; cost += t.usd; mcapW += (t.mcap ?? 0) * t.usd; }
        else if (qty > 0) {
          const frac = Math.min(1, t.tokens / qty);
          const costPart = cost * frac;
          closed.push({ id: `${t.ts}-${t.hash.slice(2, 8)}`, symbol: t.symbol, mint: t.address, chain: t.chain, costUsd: costPart, proceedsUsd: t.usd, pnlPct: costPart > 0 ? (t.usd / costPart - 1) * 100 : 0, entryMcap: cost > 0 ? mcapW / cost : 0, exitMcap: t.mcap ?? 0, ts: t.ts, imageUrl: t.imageUrl });
          qty -= t.tokens * Math.min(1, qty / t.tokens); cost -= costPart; mcapW *= 1 - frac;
          if (qty < 1e-12) { qty = 0; cost = 0; mcapW = 0; }
        }
      }
      const last = list[list.length - 1];
      if (qty > 0 && cost > 0) open.push({ id: `${firstTs}-${last.hash.slice(2, 8)}`, symbol: last.symbol, mint: last.address, chain: last.chain, qty, costUsd: cost, entryMcap: cost > 0 ? mcapW / cost : 0, ts: firstTs || last.ts, imageUrl: last.imageUrl });
    }

    // live prices, one DexScreener call per chain
    const byChain = new Map<string, string[]>();
    for (const p of open) (byChain.get(p.chain) ?? byChain.set(p.chain, []).get(p.chain)!).push(p.mint);
    const px = new Map<string, { price: number; mcap: number; liq: number }>();
    await Promise.all([...byChain].map(async ([chain, addrs]) => {
      try {
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${addrs.join(",")}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
        const arr = (await r.json()) as { baseToken?: { address?: string }; priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number } }[];
        for (const p of Array.isArray(arr) ? arr : []) {
          const a = p.baseToken?.address?.toLowerCase(); const price = Number(p.priceUsd);
          if (!a || !(price > 0)) continue;
          const key = `${chain}:${a}`; const liq = p.liquidity?.usd ?? 0;
          if (!px.has(key) || liq > (px.get(key)?.liq ?? 0)) px.set(key, { price, mcap: p.marketCap ?? p.fdv ?? 0, liq });
        }
      } catch { /* leave unpriced */ }
    }));
    const positions = open.map((p) => {
      const q = px.get(`${p.chain}:${p.mint}`);
      const valueUsd = q ? p.qty * q.price : p.costUsd;
      return { ...p, valueUsd, pnlPct: p.costUsd > 0 ? (valueUsd / p.costUsd - 1) * 100 : 0, currentMcap: q?.mcap ?? p.entryMcap };
    });
    return NextResponse.json({ closed, positions });
  } catch (e) {
    console.error("[evm-trades GET]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
