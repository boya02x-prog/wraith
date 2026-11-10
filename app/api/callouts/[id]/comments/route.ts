import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongoClient";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !/^[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  try {
    const db = await getDb();
    const parent = await db.collection("callouts").findOne({ _id: new ObjectId(id) }, { projection: { mint: 1 } });
    if (!parent) return NextResponse.json({ error: "Callout not found." }, { status: 404 });

    const docs = await db.collection("callouts")
      .find({ parentId: id }, { projection: { _id: 1, userId: 1, text: 1, createdAt: 1, imageUrl: 1, replyToId: 1, replyToName: 1 } })
      .sort({ createdAt: 1 })
      .limit(50)
      .toArray();
    const userIds = [...new Set(docs.map((d) => d.userId as string))];
    const profiles = userIds.length
      ? await db.collection("profiles")
          .find({ userId: { $in: userIds } }, { projection: { _id: 0, userId: 1, username: 1, displayName: 1, avatarDataUrl: 1, avatarUrl: 1 } })
          .toArray()
      : [];
    const pm = new Map(profiles.map((p) => [p.userId as string, p]));
    const comments = docs.map((d) => {
      const p = pm.get(d.userId as string);
      return {
        id: (d._id as ObjectId).toHexString(),
        userId: d.userId,
        displayName: p?.displayName ?? "Wraith trader",
        username: p?.username ?? null,
        avatarDataUrl: p?.avatarDataUrl || p?.avatarUrl || "",
        text: d.text,
        imageUrl: typeof d.imageUrl === "string" ? d.imageUrl : null,
        replyToId: typeof d.replyToId === "string" ? d.replyToId : null,
        replyToName: typeof d.replyToName === "string" ? d.replyToName : null,
        createdAt: d.createdAt,
      };
    });

    return NextResponse.json({ comments });
  } catch (err) {
    console.error("[callout comments GET]", err);
    return NextResponse.json({ error: "Could not load comments." }, { status: 500 });
  }
}
