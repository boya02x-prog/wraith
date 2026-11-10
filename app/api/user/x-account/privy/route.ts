import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPrivySession } from "@/lib/privyAuth";
import { getPrivyClient } from "@/lib/privyServer";
import { getDb } from "@/lib/mongoClient";

// POST /api/user/x-account/privy
//
// "Link X" now goes through Privy (Privy's own X app does the sign-in, so Wraith needs no X developer credits). The browser
// only tells us "I just linked X". The handle is read from Privy's server API for the signed-in user and never from the
// request, so nobody can claim an X account that is not theirs.
let indexesReady = false;

export async function POST() {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const privy = getPrivyClient();
  if (!privy) {
    return NextResponse.json({ error: "Account linking is not configured." }, { status: 503 });
  }

  try {
    const db = await getDb();
    const me = await db
      .collection("users")
      .findOne({ _id: new ObjectId(session.user.id) }, { projection: { _id: 0, privyUserId: 1 } });
    const privyUserId = typeof me?.privyUserId === "string" ? me.privyUserId : "";
    if (!privyUserId) {
      return NextResponse.json({ error: "Could not find your login." }, { status: 404 });
    }

    const x = (await privy.getUser(privyUserId)).twitter;
    if (!x?.subject || !x.username || !/^[A-Za-z0-9_]{1,15}$/.test(x.username)) {
      return NextResponse.json({ error: "No X account is linked to this login yet." }, { status: 404 });
    }

    const links = db.collection("x_links");
    if (!indexesReady) {
      await Promise.all([
        links.createIndex({ userId: 1 }, { unique: true }),
        links.createIndex({ usernameLower: 1 }, { unique: true }),
        links.createIndex({ xUserId: 1 }, { unique: true }),
      ]);
      indexesReady = true;
    }

    const photo = (x.profilePictureUrl ?? "").replace("_normal.", "_400x400.");
    await links.updateOne(
      { userId: session.user.id },
      {
        $set: {
          userId: session.user.id,
          xUserId: x.subject,
          username: x.username,
          usernameLower: x.username.toLowerCase(),
          profileImageUrl: photo,
          verifiedAt: new Date(),
          via: "privy",
        },
      },
      { upsert: true },
    );
    await db
      .collection("profiles")
      .updateOne({ userId: session.user.id }, { $set: { xHandle: x.username, xUserId: x.subject } }, { upsert: true });
    // Use the X photo as the avatar for anyone who has not uploaded one.
    if (photo) {
      await db.collection("profiles").updateOne(
        { userId: session.user.id, $or: [{ avatarDataUrl: { $exists: false } }, { avatarDataUrl: "" }, { avatarDataUrl: null }] },
        { $set: { avatarUrl: photo } },
      );
    }

    return NextResponse.json({ linked: true, username: x.username, profileImageUrl: photo });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return NextResponse.json({ error: "That X account is already linked to another WRAITH profile." }, { status: 409 });
    }
    console.error("[X account privy sync]", error);
    return NextResponse.json({ error: "Could not save the linked X account." }, { status: 500 });
  }
}
