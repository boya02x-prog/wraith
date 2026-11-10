import { getPrivySession } from "@/lib/privyAuth";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { ObjectId } from "mongodb";
import { isDisplayCurrency } from "@/lib/currencies";

const MAX_BODY_BYTES = 1_300_000;
const MAX_AVATAR_CHARS = 400_000;
const MAX_COVER_CHARS = 700_000;
const AVATAR_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDb();

    // The header only needs the photo, name, currency and username. The full profile also carries the cover image (up to
    // 700 KB) and two extra lookups, which made the header wait on a megabyte it never shows.
    if (request.nextUrl.searchParams.get("lite") === "1") {
      const p = await db.collection("profiles").findOne(
        { userId: session.user.id },
        { projection: { _id: 0, displayName: 1, avatarDataUrl: 1, avatarUrl: 1, displayCurrency: 1, username: 1 } },
      );
      return NextResponse.json(
        {
          profile: {
            displayName: p?.displayName ?? session.user.name ?? "",
            avatarDataUrl: p?.avatarDataUrl ?? "",
            avatarUrl: p?.avatarUrl ?? "",
            displayCurrency: isDisplayCurrency(p?.displayCurrency) ? p.displayCurrency : "USD",
            username: p?.username ?? null,
          },
          userId: session.user.id,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const userObjectId = ObjectId.isValid(session.user.id)
      ? new ObjectId(session.user.id)
      : null;
    // Three independent lookups: run them together instead of one after another.
    const [profile, xLink, user] = await Promise.all([
      db.collection("profiles").findOne(
        { userId: session.user.id },
        {
          projection: {
            _id: 0,
            displayName: 1,
            bio: 1,
            xHandle: 1,
            avatarDataUrl: 1,
            avatarUrl: 1,
            coverDataUrl: 1,
            displayCurrency: 1,
            publicTrading: 1,
            username: 1,
          },
        },
      ),
      db.collection("x_links").findOne(
        { userId: session.user.id },
        { projection: { _id: 0, username: 1 } },
      ),
      userObjectId
        ? db.collection("users").findOne(
            { _id: userObjectId },
            { projection: { _id: 0, createdAt: 1 } },
          )
        : Promise.resolve(null),
    ]);
    // Keep the signed-in photo on the profile so other people's pages can show it.
    if (profile && !profile.avatarDataUrl && session.user.image) {
      await db.collection("profiles").updateOne(
        { userId: session.user.id },
        { $set: { avatarUrl: session.user.image } },
      ).catch(() => undefined);
    }

    return NextResponse.json({
      profile: {
        displayName: profile?.displayName ?? session.user.name ?? "",
        bio: profile?.bio ?? "",
        xHandle: xLink?.username ?? "",
        avatarDataUrl: profile?.avatarDataUrl ?? "",
        avatarUrl: profile?.avatarUrl ?? "",
        coverDataUrl: profile?.coverDataUrl ?? "",
        displayCurrency: isDisplayCurrency(profile?.displayCurrency)
          ? profile.displayCurrency
          : "USD",
        publicTrading: profile?.publicTrading === true,
        username: profile?.username ?? null,
      },
      accountCreatedAt:
        user?.createdAt instanceof Date
          ? user.createdAt.toISOString()
          : typeof user?.createdAt === "string"
            ? user.createdAt
            : (userObjectId?.getTimestamp().toISOString() ?? null),
      userId: session.user.id,
    });
  } catch (error) {
    console.error("[user profile GET]", error);
    return NextResponse.json(
      { error: "Could not load profile" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Profile update is too large" },
      { status: 413 },
    );
  }

  let rawBody: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return NextResponse.json(
          { error: "Profile update is too large" },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const bodyBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    rawBody = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isRecord(rawBody)) {
    return NextResponse.json(
      { error: "Invalid profile data" },
      { status: 400 },
    );
  }

  const allowedKeys = new Set([
    "displayName",
    "bio",
    "avatarDataUrl",
    "coverDataUrl",
    "displayCurrency",
    "publicTrading",
  ]);
  if (Object.keys(rawBody).some((key) => !allowedKeys.has(key))) {
    return NextResponse.json(
      { error: "Profile fields are invalid" },
      { status: 400 },
    );
  }

  const updates: Record<string, string | boolean | Date> = {
    updatedAt: new Date(),
  };
  if (
    "displayName" in rawBody &&
    (typeof rawBody.displayName !== "string" ||
      rawBody.displayName.trim().length > 40)
  ) {
    return NextResponse.json(
      { error: "Profile fields are invalid" },
      { status: 400 },
    );
  }
  if ("displayName" in rawBody) {
    updates.displayName = (rawBody.displayName as string).trim();
  }
  if (
    "bio" in rawBody &&
    (typeof rawBody.bio !== "string" || rawBody.bio.length > 160)
  ) {
    return NextResponse.json(
      { error: "Profile fields are invalid" },
      { status: 400 },
    );
  }
  if ("bio" in rawBody) updates.bio = (rawBody.bio as string).trim();
  if ("avatarDataUrl" in rawBody) {
    if (
      typeof rawBody.avatarDataUrl !== "string" ||
      rawBody.avatarDataUrl.length > MAX_AVATAR_CHARS ||
      (rawBody.avatarDataUrl && !AVATAR_RE.test(rawBody.avatarDataUrl))
    ) {
      return NextResponse.json(
        { error: "Choose a valid image under 300 KB" },
        { status: 400 },
      );
    }
    updates.avatarDataUrl = rawBody.avatarDataUrl;
  }
  if ("coverDataUrl" in rawBody) {
    if (
      typeof rawBody.coverDataUrl !== "string" ||
      rawBody.coverDataUrl.length > MAX_COVER_CHARS ||
      (rawBody.coverDataUrl && !AVATAR_RE.test(rawBody.coverDataUrl))
    ) {
      return NextResponse.json(
        { error: "Choose a valid cover image" },
        { status: 400 },
      );
    }
    updates.coverDataUrl = rawBody.coverDataUrl;
  }
  if ("displayCurrency" in rawBody) {
    if (!isDisplayCurrency(rawBody.displayCurrency)) {
      return NextResponse.json(
        { error: "Unsupported display currency" },
        { status: 400 },
      );
    }
    updates.displayCurrency = rawBody.displayCurrency;
  }
  if ("publicTrading" in rawBody) {
    if (typeof rawBody.publicTrading !== "boolean") {
      return NextResponse.json(
        { error: "Profile fields are invalid" },
        { status: 400 },
      );
    }
    updates.publicTrading = rawBody.publicTrading;
  }
  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No profile fields provided" },
      { status: 400 },
    );
  }

  try {
    const db = await getDb();
    await db.collection("profiles").updateOne(
      { userId: session.user.id },
      {
        $set: {
          ...updates,
          userId: session.user.id,
        },
      },
      { upsert: true },
    );

    const profile = await db.collection("profiles").findOne(
      { userId: session.user.id },
      {
        projection: {
          _id: 0,
          displayName: 1,
          bio: 1,
          xHandle: 1,
          avatarDataUrl: 1,
          avatarUrl: 1,
          coverDataUrl: 1,
          displayCurrency: 1,
          publicTrading: 1,
          username: 1,
        },
      },
    );
    const xLink = await db.collection("x_links").findOne(
      { userId: session.user.id },
      { projection: { _id: 0, username: 1 } },
    );
    return NextResponse.json({
      profile: {
        displayName: profile?.displayName ?? "",
        bio: profile?.bio ?? "",
        xHandle: xLink?.username ?? "",
        avatarDataUrl: profile?.avatarDataUrl ?? "",
        avatarUrl: profile?.avatarUrl ?? "",
        coverDataUrl: profile?.coverDataUrl ?? "",
        displayCurrency: isDisplayCurrency(profile?.displayCurrency)
          ? profile.displayCurrency
          : "USD",
        publicTrading: profile?.publicTrading === true,
        username: profile?.username ?? null,
      },
    });
  } catch (error) {
    console.error("[user profile PATCH]", error);
    return NextResponse.json(
      { error: "Could not save profile" },
      { status: 500 },
    );
  }
}
