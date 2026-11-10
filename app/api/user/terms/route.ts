import { getPrivySession } from "@/lib/privyAuth";
import { getDb } from "@/lib/mongoClient";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TERMS_VERSION = "2026-10";

export async function GET() {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const profile = await (await getDb()).collection("profiles").findOne(
      { userId: session.user.id },
      { projection: { _id: 0, acceptedTermsVersion: 1 } },
    );
    return NextResponse.json({
      accepted: profile?.acceptedTermsVersion === TERMS_VERSION,
    });
  } catch (error) {
    console.error("[user terms GET]", error);
    return NextResponse.json(
      { error: "Could not check terms acceptance" },
      { status: 500 },
    );
  }
}

export async function POST() {
  const session = await getPrivySession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await (await getDb())
      .collection("profiles")
      .updateOne(
        { userId: session.user.id },
        {
          $set: {
            userId: session.user.id,
            acceptedTermsVersion: TERMS_VERSION,
            acceptedTermsAt: new Date(),
          },
        },
        { upsert: true },
      );
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error("[user terms POST]", error);
    return NextResponse.json(
      { error: "Could not save terms acceptance" },
      { status: 500 },
    );
  }
}
