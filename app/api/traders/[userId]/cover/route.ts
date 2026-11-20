import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongoClient";

// A trader's cover picture as a normal image (not a 700 KB text blob inside JSON), so the browser can cache it and the Hot shots banner can
// ask for just the few covers it shows. Only people who made their trading public have a cover here, the same rule as their public page.
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[a-f\d]{24}$/i.test(userId)) return new NextResponse(null, { status: 404 });
  try {
    const db = await getDb();
    const p = await db.collection("profiles").findOne({ userId, publicTrading: true }, { projection: { _id: 0, coverDataUrl: 1 } });
    const m = typeof p?.coverDataUrl === "string" ? DATA_URL.exec(p.coverDataUrl) : null;
    if (!m) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(m[2], "base64"), {
      headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=600" },
    });
  } catch (error) {
    console.error("[trader cover GET]", error);
    return new NextResponse(null, { status: 500 });
  }
}
