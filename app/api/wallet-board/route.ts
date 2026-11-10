// GET /api/wallet-board: the wallets behind the scanner's "proven wallet" and "repeat dumper" signals, with their record.
// Wallet addresses are public on-chain; this only shows what Wraith has measured about them (calls they were early in, and how those ended).
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Row { _id: string; n: number; wins: number; dumps: number; lastSeen?: number; kind?: string; holdPct?: number; flipPct?: number; medOffsetS?: number; avgSol?: number }
const shape = (r: Row) => ({
  wallet: String(r._id), calls: r.n, wins: r.wins, dumps: r.dumps, winRate: r.n ? r.wins / r.n : 0, dumpRate: r.n ? r.dumps / r.n : 0, lastSeen: r.lastSeen ?? null,
  kind: r.kind ?? "regular", holdPct: r.holdPct ?? null, flipPct: r.flipPct ?? null, medOffsetS: r.medOffsetS ?? null, avgSol: r.avgSol ?? null,
});

// One answer shared by every visitor for 5 minutes (the numbers move slowly), and one database round at a time even if many open it at once.
let cached: { ts: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

export async function GET() {
  if (cached && Date.now() - cached.ts < 5 * 60_000) return NextResponse.json(cached.body, { headers: { "Cache-Control": "private, max-age=300" } });
  if (!inflight) inflight = build().finally(() => { inflight = null; });
  try {
    const body = await inflight;
    cached = { ts: Date.now(), body };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    if (cached) return NextResponse.json(cached.body); // the database hiccuped: the last answer beats an error
    return NextResponse.json({ error: "Wallets unavailable" }, { status: 503 });
  }
}

async function build() {
  const db = await getDb();
  const col = db.collection<Row>("wallet_stats");
  // same rules as the scanner (lib/signalIntel.ts): proven = 3+ calls and 30%+ wins; repeat dumper = 4+ calls and 75%+ dumps
  const [provenPool, dumperPool, provenCount, dumperCount, total, holderPool] = await Promise.all([
    col.find({ n: { $gte: 3 }, wins: { $gte: 1 } }).sort({ wins: -1, n: 1 }).limit(400).toArray(),
    col.find({ n: { $gte: 4 }, dumps: { $gte: 3 } }).sort({ dumps: -1 }).limit(400).toArray(),
    col.aggregate([{ $match: { n: { $gte: 3 }, $expr: { $and: [{ $gte: ["$wins", { $multiply: [0.3, "$n"] }] }, { $lt: ["$dumps", { $multiply: [0.6, "$n"] }] }] } } }, { $count: "c" }]).toArray(),
    col.aggregate([{ $match: { n: { $gte: 4 }, $expr: { $gte: ["$dumps", { $multiply: [0.75, "$n"] }] } } }, { $count: "c" }]).toArray(),
    col.estimatedDocumentCount(),
    col.find({ kind: "holder", n: { $gte: 3 }, wins: { $gte: 1 } }).sort({ wins: -1 }).limit(200).toArray(),
  ]);
  // wallets that also dump most of the time are bots that buy everything: not shown as proven (and not counted as proven by the scanner)
  const isProven = (r: Row) => r.n >= 3 && r.wins / r.n >= 0.3 && r.dumps / r.n < 0.6;
  const proven = provenPool.filter(isProven).slice(0, 40).map(shape);
  const dumpers = dumperPool.filter((r) => r.dumps / r.n >= 0.75).slice(0, 40).map(shape);
  // holders: wallets measured as usually still holding 30 minutes in, that also win at least 30% and do not dump most of the time
  const holders = holderPool.filter(isProven).slice(0, 40).map(shape);
  return { proven, holders, dumpers, counts: { tracked: total, proven: provenCount[0]?.c ?? 0, dumpers: dumperCount[0]?.c ?? 0 } };
}
