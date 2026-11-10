// app/api/telegram/link/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/session";
import clientPromise from "@/lib/mongoClient";
import { ObjectId } from "mongodb";
import crypto from "crypto";
import { checkLimit, telegramLinkLimiter } from "@/lib/ratelimit";

// POST — generate a one-time deep link token
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!ObjectId.isValid(session.user.id)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rl = await checkLimit(telegramLinkLimiter, session.user.id);
  if (!rl.success) return NextResponse.json({ error: "Too many link requests. Try again later." }, { status: 429 });

  const client = await clientPromise;
  const db = client.db();

  const token = crypto.randomBytes(16).toString("hex");

  // only the newest link works: drop any older unused codes for this account
  await db.collection("telegram_links").deleteMany({ userId: new ObjectId(session.user.id) });
  await db.collection("telegram_links").insertOne({
    token,
    userId: new ObjectId(session.user.id),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
  });

  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "wraithscan_bot";
  const deepLink = `https://t.me/${botUsername}?start=${token}`;

  return NextResponse.json({ url: deepLink });
}

// DELETE — unlink Telegram from account
export async function DELETE(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await clientPromise;
  const db = client.db();

  await db
    .collection("users")
    .updateOne(
      { _id: new ObjectId(session.user.id) },
      { $unset: { telegramChatId: "", telegramLinkedAt: "" } },
    );

  return NextResponse.json({ ok: true });
}
