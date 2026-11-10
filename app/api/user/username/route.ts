import { getPrivySession } from "@/lib/privyAuth";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { validateUsername } from "@/lib/usernameUtils";

export async function GET() {
  const session = await getPrivySession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = await getDb();
    const profile = await db
      .collection("profiles")
      .findOne(
        { userId: session.user.id },
        { projection: { _id: 0, username: 1 } },
      );
    return NextResponse.json({ username: profile?.username ?? null });
  } catch (error) {
    console.error("[username GET]", error);
    return NextResponse.json(
      { error: "Could not load username." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawUsername =
    typeof raw === "object" && raw !== null && "username" in raw
      ? (raw as Record<string, unknown>).username
      : undefined;
  if (typeof rawUsername !== "string")
    return NextResponse.json({ error: "Username is required." }, { status: 400 });

  const check = validateUsername(rawUsername);
  if (!check.ok)
    return NextResponse.json({ error: check.error }, { status: 400 });

  const { normalized } = check;
  try {
    const db = await getDb();
    const profiles = db.collection("profiles");
    await profiles.createIndex(
      { username: 1 },
      { unique: true, sparse: true, collation: { locale: "en", strength: 2 } },
    );

    // Block if another user already owns this username
    const existing = await profiles.findOne(
      { username: new RegExp(`^${normalized}$`, "i") },
      { projection: { _id: 0, userId: 1 } },
    );
    if (existing && existing.userId !== session.user.id) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    }

    await profiles.updateOne(
      { userId: session.user.id },
      { $set: { username: normalized, updatedAt: new Date() } },
      { upsert: true },
    );
    return NextResponse.json({ username: normalized });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === 11000
    ) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    }
    console.error("[username PUT]", error);
    return NextResponse.json(
      { error: "Could not save username." },
      { status: 500 },
    );
  }
}
