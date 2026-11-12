// Owner-only gate for the street theme assets. The server checks the signed-in account (never anything the browser sends)
// before serving them, and answers 404 to everybody else.
import type { NextRequest } from "next/server";
import { getAppSession } from "@/lib/session";
import { isQuestAdmin } from "@/lib/quests";

export async function isOwner(req: NextRequest): Promise<boolean> {
  const session = await getAppSession(req).catch(() => null);
  return !!session?.user?.id && isQuestAdmin(session.user.id, session.user.email);
}
