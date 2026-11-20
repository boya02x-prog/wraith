// GET /api/signal-learning: what the scanner has learned from its own track record (no secrets, no weights).
import { NextResponse } from "next/server";
import { edge } from "@/lib/edge";
import { learningSnapshot } from "@/lib/signalLearning";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The same answer for everybody and it only changes when the model retrains (every few hours), so Vercel's CDN keeps a copy: 2 minutes fresh, then
// an hour of "serve the old one instantly while a new one is fetched". Before, every open of the Patterns view waited for a function (often a cold
// one) and a database read: that was the long "Loading…".
export async function GET() {
  return edge(NextResponse.json(await learningSnapshot()), 120, 3600);
}
