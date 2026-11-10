import { getPrivySession } from "@/lib/privyAuth";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";
import { getPrivyClient } from "@/lib/privyServer";

export async function GET() {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = await getDb();
    const link = await db.collection("x_links").findOne(
      { userId: session.user.id },
      { projection: { _id: 0, username: 1, profileImageUrl: 1, verifiedAt: 1 } },
    );
    return NextResponse.json({
      available: !!getPrivyClient(), // linking runs through Privy now
      linked: !!link,
      account: link
        ? {
            username: link.username,
            profileImageUrl: link.profileImageUrl,
            verifiedAt:
              link.verifiedAt instanceof Date
                ? link.verifiedAt.toISOString()
                : null,
          }
        : null,
    });
  } catch (error) {
    console.error("[X account GET]", error);
    return NextResponse.json(
      { error: "Could not load linked X account." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const db = await getDb();
    await db.collection("x_links").deleteOne({ userId: session.user.id });
    await db.collection("profiles").updateOne(
      { userId: session.user.id },
      { $unset: { xHandle: "", xUserId: "" } },
    );
    return NextResponse.json({ linked: false });
  } catch (error) {
    console.error("[X account DELETE]", error);
    return NextResponse.json(
      { error: "Could not unlink X account." },
      { status: 500 },
    );
  }
}
