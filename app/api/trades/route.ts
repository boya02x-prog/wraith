import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { tradeLimiter, checkLimit } from "@/lib/ratelimit";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MAX_BODY_BYTES = 10_000; // 10KB — a single trade object is tiny
const MAX_TRADES = 200;

// ─── TRADE SCHEMA ─────────────────────────────────────────────────────────────
interface ValidatedTrade {
  id: string;
  symbol: string;
  mint: string;
  entryMcap: number;
  exitMcap?: number;
  amountSol: number;
  slPct: number;
  tpX: number;
  pnlPct?: number;
  exitReason?: string;
  buyTxSig?: string;
  exitTxSig?: string;
  status: "filled" | "failed" | "open";
  imageUrl?: string;
  ts: number;
  closedAt?: number;
}

const VALID_TRADE_STATUSES = new Set(["filled", "failed", "open"]);
const VALID_EXIT_REASONS = new Set(["TP", "SL", "TRAIL", "MANUAL"]);
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const SYM_RE = /^[A-Za-z0-9]{1,20}$/;
const IMG_RE = /^https:\/\/.{1,290}$/;
const ID_RE = /^[0-9]+-[a-z0-9]{1,10}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v) && !isNaN(v);
}

function validateTrade(raw: unknown): ValidatedTrade | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;

  if (typeof t.id !== "string" || !ID_RE.test(t.id)) return null;
  if (typeof t.symbol !== "string" || !SYM_RE.test(t.symbol)) return null;
  if (typeof t.mint !== "string" || !MINT_RE.test(t.mint)) return null;
  if (typeof t.status !== "string" || !VALID_TRADE_STATUSES.has(t.status))
    return null;

  if (!isFiniteNumber(t.entryMcap) || t.entryMcap < 0 || t.entryMcap > 1e12)
    return null;
  if (!isFiniteNumber(t.amountSol) || t.amountSol <= 0 || t.amountSol > 1000)
    return null;
  if (!isFiniteNumber(t.slPct) || t.slPct < -100 || t.slPct > 0) return null;
  if (!isFiniteNumber(t.tpX) || t.tpX < 1 || t.tpX > 1000) return null;
  if (
    !isFiniteNumber(t.ts) ||
    t.ts < 1_000_000_000_000 ||
    t.ts > Date.now() + 60_000
  )
    return null;

  if (t.exitMcap !== undefined) {
    if (!isFiniteNumber(t.exitMcap) || t.exitMcap < 0 || t.exitMcap > 1e12)
      return null;
  }
  if (t.pnlPct !== undefined) {
    if (!isFiniteNumber(t.pnlPct) || Math.abs(t.pnlPct) > 100000) return null;
  }
  if (t.exitReason !== undefined) {
    if (
      typeof t.exitReason !== "string" ||
      !VALID_EXIT_REASONS.has(t.exitReason)
    )
      return null;
  }
  if (t.buyTxSig !== undefined) {
    if (typeof t.buyTxSig !== "string" || !SIG_RE.test(t.buyTxSig)) return null;
  }
  if (t.exitTxSig !== undefined) {
    if (typeof t.exitTxSig !== "string" || !SIG_RE.test(t.exitTxSig))
      return null;
  }
  if (t.imageUrl !== undefined) {
    if (typeof t.imageUrl !== "string" || !IMG_RE.test(t.imageUrl)) return null;
  }

  // Return clean object — never spread raw input
  const out: ValidatedTrade = {
    id: t.id,
    symbol: t.symbol,
    mint: t.mint,
    entryMcap: t.entryMcap,
    amountSol: t.amountSol,
    slPct: t.slPct,
    tpX: t.tpX,
    status: t.status as ValidatedTrade["status"],
    ts: t.ts,
  };
  if (t.exitMcap !== undefined) out.exitMcap = t.exitMcap;
  if (t.pnlPct !== undefined) out.pnlPct = t.pnlPct;
  if (t.exitReason !== undefined) out.exitReason = t.exitReason as string;
  if (t.buyTxSig !== undefined) out.buyTxSig = t.buyTxSig;
  if (t.exitTxSig !== undefined) out.exitTxSig = t.exitTxSig;
  if (t.imageUrl !== undefined) out.imageUrl = t.imageUrl;
  // close time powers average hold time; an implausible value is ignored instead of rejecting the trade
  if (isFiniteNumber(t.closedAt) && t.closedAt >= t.ts && t.closedAt <= Date.now() + 60_000) out.closedAt = t.closedAt;
  return out;
}

// ─── GET ─────────────────────────────────────────────────────────────────────
export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDb();
    const doc = await db
      .collection("trades")
      .findOne(
        { userId: session.user.id },
        { projection: { _id: 0, trades: 1 } },
      );

    return NextResponse.json({ trades: doc?.trades ?? [] });
  } catch (e) {
    console.error("[trades GET]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const { success } = await checkLimit(tradeLimiter, session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const rawTrade = (rawBody as Record<string, unknown>).trade;
  const trade = validateTrade(rawTrade);
  if (!trade) {
    return NextResponse.json(
      { error: "Invalid trade object" },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await db.collection("trades").updateOne(
      { userId: session.user.id },
      {
        $push: {
          trades: {
            $each: [trade], // only validated data hits the DB
            $position: 0,
            $slice: MAX_TRADES,
          },
        } as never,
        $set: { updatedAt: new Date() },
        $setOnInsert: { userId: session.user.id },
      },
      { upsert: true },
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[trades POST]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
