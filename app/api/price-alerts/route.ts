// GET /api/price-alerts?mint= → my active alerts (all, or for one token). POST {mint, symbol, kind, pct} → set one. DELETE ?id= → remove.
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";
import { SOLANA_MINT_RE } from "@/lib/market";
import { MAX_ALERTS_PER_USER, type PriceAlert } from "@/lib/priceAlerts";
import { checkLimit, reactLimiter } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
const err = (m: string, s: number) => NextResponse.json({ error: m }, { status: s });

async function livePrice(mint: string): Promise<number> {
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return 0;
    const d = (await r.json()) as Record<string, { usdPrice?: number }>;
    return d[mint]?.usdPrice ?? 0;
  } catch { return 0; }
}

export async function GET(req: NextRequest) {
  const s = await getPrivySession();
  if (!s?.user?.id) return err("Sign in first.", 401);
  const mint = req.nextUrl.searchParams.get("mint");
  const db = await getDb();
  const rows = await db.collection("price_alerts").find({ userId: s.user.id, firedAt: { $exists: false }, ...(mint ? { mint } : {}) }).sort({ createdAt: -1 }).limit(60).toArray();
  return NextResponse.json({ alerts: rows.map((r) => ({ id: String(r._id), mint: r.mint, symbol: r.symbol, kind: r.kind, pct: r.pct, basePrice: r.basePrice })) });
}

export async function POST(req: NextRequest) {
  const s = await getPrivySession();
  const userId = s?.user?.id;
  if (!userId) return err("Sign in first.", 401);
  if (!(await checkLimit(reactLimiter, `palert:${userId}`)).success) return err("Slow down.", 429);
  const b = (await req.json().catch(() => null)) as { mint?: string; symbol?: string; kind?: string; pct?: number } | null;
  const mint = String(b?.mint ?? ""), kind = b?.kind === "rise" ? "rise" : b?.kind === "drop" ? "drop" : null, pct = Math.round(Number(b?.pct));
  if (!SOLANA_MINT_RE.test(mint) || !kind || !Number.isFinite(pct)) return err("Pick a token and an alert.", 400);
  if (kind === "drop" ? pct < 5 || pct > 90 : pct < 10 || pct > 1000) return err("That percentage is out of range.", 400);
  const db = await getDb();
  const col = db.collection("price_alerts");
  if ((await col.countDocuments({ userId, firedAt: { $exists: false } })) >= MAX_ALERTS_PER_USER) return err(`You can keep ${MAX_ALERTS_PER_USER} alerts at a time. Remove one first.`, 400);
  if (await col.findOne({ userId, mint, kind, pct, firedAt: { $exists: false } }, { projection: { _id: 1 } })) return err("You already have that alert.", 409);
  const basePrice = await livePrice(mint);
  if (!(basePrice > 0)) return err("Could not read this token's price right now. Try again in a moment.", 502);
  const doc: PriceAlert = { userId, mint, symbol: String(b?.symbol ?? "").replace(/[^\w$.-]/g, "").slice(0, 16) || "TOKEN", kind, pct, basePrice, createdAt: Date.now() };
  const r = await col.insertOne(doc as never);
  return NextResponse.json({ alert: { id: String(r.insertedId), mint, symbol: doc.symbol, kind, pct, basePrice } });
}

export async function DELETE(req: NextRequest) {
  const s = await getPrivySession();
  if (!s?.user?.id) return err("Sign in first.", 401);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!ObjectId.isValid(id)) return err("Bad id.", 400);
  const db = await getDb();
  await db.collection("price_alerts").deleteOne({ _id: new ObjectId(id), userId: s.user.id });
  return NextResponse.json({ ok: true });
}
