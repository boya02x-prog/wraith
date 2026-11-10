// GET /api/signal-learning: what the scanner has learned from its own track record (no secrets, no weights).
import { NextResponse } from "next/server";
import { learningSnapshot } from "@/lib/signalLearning";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json(await learningSnapshot(), { headers: { "Cache-Control": "private, max-age=60" } });
}
