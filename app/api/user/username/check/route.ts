import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { validateUsername } from "@/lib/usernameUtils";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ available: false, error: "Username is required." });

  const check = validateUsername(q);
  if (!check.ok) return NextResponse.json({ available: false, error: check.error });

  try {
    const db = await getDb();
    const existing = await db
      .collection("profiles")
      .findOne(
        { username: new RegExp(`^${check.normalized}$`, "i") },
        { projection: { _id: 1 } },
      );
    return NextResponse.json({
      available: !existing,
      normalized: check.normalized,
    });
  } catch (error) {
    console.error("[username check GET]", error);
    return NextResponse.json({ available: false, error: "Could not check username." });
  }
}
