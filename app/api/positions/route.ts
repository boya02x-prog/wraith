import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";
import { positionLimiter, checkLimit } from "@/lib/ratelimit";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MAX_BODY_BYTES = 50_000; // 50KB hard cap
const MAX_POSITIONS = 50;

// ─── POSITION SCHEMA ─────────────────────────────────────────────────────────
// Strict allowlist of fields + types. Nothing outside this shape reaches the DB.
interface ValidatedPosition {
  id: string;
  symbol: string;
  mint: string;
  entryMcap: number;
  entryPrice: number;
  tokenAmount: number;
  amountSol: number;
  slPct: number;
  tpX: number;
  trailPct: number;
  peakMcap: number;
  currentMcap: number;
  currentPnlPct: number;
  trailStopMcap: number;
  status: "watching" | "selling" | "sold" | "failed";
  exitReason?: "TP" | "SL" | "TRAIL" | "MANUAL";
  exitMcap?: number;
  exitPnlPct?: number;
  exitTxSig?: string;
  buyTxSig?: string;
  imageUrl?: string;
  ts: number;
}

const VALID_STATUSES = new Set(["watching", "selling", "sold", "failed"]);
const VALID_EXIT_REASONS = new Set(["TP", "SL", "TRAIL", "MANUAL"]);

// Solana base58 mint address: 32–44 chars, alphanumeric no 0/O/I/l
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// TX signature: 87–88 base58 chars
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
// Token symbol: 1–20 uppercase alphanumeric
const SYM_RE = /^[A-Za-z0-9]{1,20}$/;
// Image URL: must be https, max 300 chars
const IMG_RE = /^https:\/\/.{1,290}$/;
// Position id: timestamp-random format
const ID_RE = /^[0-9]+-[a-z0-9]{1,10}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v) && !isNaN(v);
}

function validatePosition(raw: unknown): ValidatedPosition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;

  // Required string fields with pattern checks
  if (typeof p.id !== "string" || !ID_RE.test(p.id)) return null;
  if (typeof p.symbol !== "string" || !SYM_RE.test(p.symbol)) return null;
  if (typeof p.mint !== "string" || !MINT_RE.test(p.mint)) return null;
  if (typeof p.status !== "string" || !VALID_STATUSES.has(p.status))
    return null;

  // Required finite numbers with range guards
  if (!isFiniteNumber(p.entryMcap) || p.entryMcap < 0 || p.entryMcap > 1e12)
    return null;
  if (!isFiniteNumber(p.entryPrice) || p.entryPrice < 0) return null;
  if (
    !isFiniteNumber(p.tokenAmount) ||
    p.tokenAmount < 0 ||
    p.tokenAmount > 1e18
  )
    return null;
  if (!isFiniteNumber(p.amountSol) || p.amountSol <= 0 || p.amountSol > 1000)
    return null;
  if (!isFiniteNumber(p.slPct) || p.slPct < -100 || p.slPct > 0) return null;
  if (!isFiniteNumber(p.tpX) || p.tpX < 1 || p.tpX > 1000) return null;
  if (!isFiniteNumber(p.trailPct) || p.trailPct < 0 || p.trailPct > 100)
    return null;
  if (!isFiniteNumber(p.peakMcap) || p.peakMcap < 0 || p.peakMcap > 1e12)
    return null;
  if (
    !isFiniteNumber(p.currentMcap) ||
    p.currentMcap < 0 ||
    p.currentMcap > 1e12
  )
    return null;
  if (!isFiniteNumber(p.currentPnlPct) || Math.abs(p.currentPnlPct) > 100000)
    return null;
  if (
    !isFiniteNumber(p.trailStopMcap) ||
    p.trailStopMcap < 0 ||
    p.trailStopMcap > 1e12
  )
    return null;
  if (
    !isFiniteNumber(p.ts) ||
    p.ts < 1_000_000_000_000 ||
    p.ts > Date.now() + 60_000
  )
    return null;

  // Optional fields — validate only if present, reject if wrong type
  if (p.exitReason !== undefined) {
    if (
      typeof p.exitReason !== "string" ||
      !VALID_EXIT_REASONS.has(p.exitReason)
    )
      return null;
  }
  if (p.exitMcap !== undefined) {
    if (!isFiniteNumber(p.exitMcap) || p.exitMcap < 0 || p.exitMcap > 1e12)
      return null;
  }
  if (p.exitPnlPct !== undefined) {
    if (!isFiniteNumber(p.exitPnlPct) || Math.abs(p.exitPnlPct) > 100000)
      return null;
  }
  if (p.exitTxSig !== undefined) {
    if (typeof p.exitTxSig !== "string" || !SIG_RE.test(p.exitTxSig))
      return null;
  }
  if (p.buyTxSig !== undefined) {
    if (typeof p.buyTxSig !== "string" || !SIG_RE.test(p.buyTxSig)) return null;
  }
  if (p.imageUrl !== undefined) {
    if (typeof p.imageUrl !== "string" || !IMG_RE.test(p.imageUrl)) return null;
  }

  // Return a clean object — never spread the raw input into DB
  const out: ValidatedPosition = {
    id: p.id,
    symbol: p.symbol,
    mint: p.mint,
    entryMcap: p.entryMcap,
    entryPrice: p.entryPrice,
    tokenAmount: p.tokenAmount,
    amountSol: p.amountSol,
    slPct: p.slPct,
    tpX: p.tpX,
    trailPct: p.trailPct,
    peakMcap: p.peakMcap,
    currentMcap: p.currentMcap,
    currentPnlPct: p.currentPnlPct,
    trailStopMcap: p.trailStopMcap,
    status: p.status as ValidatedPosition["status"],
    ts: p.ts,
  };
  if (p.exitReason !== undefined)
    out.exitReason = p.exitReason as ValidatedPosition["exitReason"];
  if (p.exitMcap !== undefined) out.exitMcap = p.exitMcap;
  if (p.exitPnlPct !== undefined) out.exitPnlPct = p.exitPnlPct;
  if (p.exitTxSig !== undefined) out.exitTxSig = p.exitTxSig;
  if (p.buyTxSig !== undefined) out.buyTxSig = p.buyTxSig;
  if (p.imageUrl !== undefined) out.imageUrl = p.imageUrl;
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
    const doc = await db.collection("positions").findOne(
      { userId: session.user.id },
      { projection: { _id: 0, positions: 1 } }, // never send _id or userId back
    );

    return NextResponse.json({ positions: doc?.positions ?? [] });
  } catch (e) {
    console.error("[positions GET]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Body size guard — read raw bytes before parsing JSON
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const { success } = await checkLimit(positionLimiter, session.user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !rawBody ||
    typeof rawBody !== "object" ||
    !Array.isArray((rawBody as Record<string, unknown>).positions)
  ) {
    return NextResponse.json(
      { error: "positions must be an array" },
      { status: 400 },
    );
  }

  const rawPositions = (rawBody as Record<string, unknown>)
    .positions as unknown[];

  // Validate every item — reject the whole request if any item is malformed
  const validated: ValidatedPosition[] = [];
  for (const item of rawPositions.slice(0, MAX_POSITIONS)) {
    const pos = validatePosition(item);
    if (!pos) {
      return NextResponse.json(
        { error: "Invalid position object in array" },
        { status: 400 },
      );
    }
    validated.push(pos);
  }

  try {
    const db = await getDb();
    await db.collection("positions").updateOne(
      { userId: session.user.id },
      {
        $set: {
          userId: session.user.id,
          positions: validated, // only validated, typed data hits the DB
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[positions POST]", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
