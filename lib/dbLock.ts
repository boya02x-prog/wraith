// A tiny cross-instance mutex on top of MongoDB.
//
// Serverless functions run many copies at once, so "check a counter, then act, then record it" is a race: fire the same request
// ten times in parallel and all ten pass the check before any of them records. A lock document whose `_id` is the lock name fixes
// that: only one caller can create (or take over an expired) document, everyone else gets a duplicate-key error and is refused.
import type { Db } from "mongodb";

const COLLECTION = "locks";

/** Take the lock `key` for at most `ttlMs`. Returns false when somebody else currently holds it. */
export async function acquireLock(db: Db, key: string, ttlMs: number): Promise<boolean> {
  const now = Date.now();
  try {
    await db.collection<{ _id: string; until: number }>(COLLECTION).findOneAndUpdate(
      { _id: key, until: { $lt: now } },
      { $set: { until: now + ttlMs } },
      { upsert: true },
    );
    return true;
  } catch (e) {
    // E11000 = the document exists and has not expired, so another request holds the lock
    if (typeof e === "object" && e !== null && (e as { code?: number }).code === 11000) return false;
    throw e;
  }
}

/** Give the lock back early. Never throws: an unreleased lock simply expires on its own. */
export async function releaseLock(db: Db, key: string): Promise<void> {
  try {
    await db.collection<{ _id: string }>(COLLECTION).deleteOne({ _id: key });
  } catch {
    /* expires by itself */
  }
}

/**
 * Run `fn` while holding `key`. With `tries > 1` it waits (`waitMs` between attempts) for a busy lock, which suits short critical
 * sections. Resolves to `{ ok: false }` when the lock could not be taken.
 */
export async function withLock<T>(
  db: Db,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  tries = 1,
  waitMs = 120,
): Promise<{ ok: true; value: T } | { ok: false }> {
  for (let i = 0; i < tries; i++) {
    if (await acquireLock(db, key, ttlMs)) {
      try {
        return { ok: true, value: await fn() };
      } finally {
        await releaseLock(db, key);
      }
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return { ok: false };
}
