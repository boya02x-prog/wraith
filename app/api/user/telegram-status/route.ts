import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import { getDb } from "@/lib/mongoClient";

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ linked: false });
  }

  const db = await getDb();
  const user = await db
    .collection("users")
    .findOne(
      { email: session.user.email },
      { projection: { telegramChatId: 1 } },
    );

  return NextResponse.json({ linked: !!user?.telegramChatId });
}
