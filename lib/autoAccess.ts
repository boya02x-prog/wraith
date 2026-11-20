// lib/autoAccess.ts  (server only)
// Who may see the Auto-trader: the owner always, plus the people the owner adds by email in the admin page. Stored in its own small collection, so
// adding or removing someone takes effect at once and can never be overwritten by saving some other admin setting.
import { getDb } from "@/lib/mongoClient";
import { isQuestAdmin } from "@/lib/quests";

const COLLECTION = "auto_trader_access";
const MAX_PEOPLE = 200;
type Row = { _id: string; addedAt: number; addedBy?: string };

export const normEmail = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const validEmail = (e: string): boolean => e.length >= 5 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

const col = async () => (await getDb()).collection<Row>(COLLECTION);

export async function listAccess(): Promise<{ email: string; addedAt: number; addedBy?: string }[]> {
  const rows = await (await col()).find({}).sort({ addedAt: -1 }).limit(MAX_PEOPLE).toArray();
  return rows.map((r) => ({ email: r._id, addedAt: r.addedAt, addedBy: r.addedBy }));
}

export async function addAccess(email: string, by: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const e = normEmail(email);
  if (!validEmail(e)) return { ok: false, message: "That does not look like an email address." };
  const c = await col();
  if ((await c.estimatedDocumentCount()) >= MAX_PEOPLE) return { ok: false, message: `The list is full (${MAX_PEOPLE} people).` };
  await c.updateOne({ _id: e }, { $setOnInsert: { addedAt: Date.now(), addedBy: by.slice(0, 120) } }, { upsert: true });
  return { ok: true };
}

export async function removeAccess(email: string): Promise<void> {
  await (await col()).deleteOne({ _id: normEmail(email) });
}

/** True for the owner, and for anyone whose sign-in email is on the list. */
export async function isAutoAllowed(userId: string, email: string | null | undefined): Promise<boolean> {
  if (isQuestAdmin(userId, email)) return true;
  const e = normEmail(email);
  if (!e) return false;
  try { return !!(await (await col()).findOne({ _id: e })); } catch { return false; }
}
