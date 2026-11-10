// POST — unlink Telegram from the signed-in account (keeps the user's tier).
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAppSession } from "@/lib/session";
import clientPromise from "@/lib/mongoClient";

export async function POST() {
  const session = await getAppSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = (await clientPromise).db();
  await db.collection("users").updateOne({ _id: new ObjectId(session.user.id) }, { $unset: { telegramChatId: "", telegramLinkedAt: "" } });
  return NextResponse.json({ ok: true });
}
