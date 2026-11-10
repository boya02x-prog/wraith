// Create an index once per server instance. Unique indexes are what make "insert or fail" atomic, which is how likes, reposts,
// follows and similar toggles stay correct when the same request arrives several times at once (check-then-write is a race).
import type { Collection, CreateIndexesOptions, Document, IndexSpecification } from "mongodb";

const done = new Set<string>();

/**
 * @param dedupeKeys when the index is unique and old data may already contain duplicates (written by the racy version of the route),
 *                   keep one document per key combination and delete the rest, then retry once.
 */
export async function ensureIndex(
  col: Collection<Document>,
  spec: IndexSpecification,
  opts: CreateIndexesOptions = {},
  dedupeKeys?: string[],
): Promise<void> {
  const k = `${col.collectionName}:${JSON.stringify(spec)}`;
  if (done.has(k)) return;
  try {
    await col.createIndex(spec, opts);
    done.add(k);
  } catch (e) {
    const dup = typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
    if (dup && dedupeKeys?.length) {
      try {
        const group: Record<string, string> = {};
        for (const key of dedupeKeys) group[key] = `$${key}`;
        const dups = await col
          .aggregate<{ ids: unknown[] }>([
            { $group: { _id: group, ids: { $push: "$_id" }, n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } },
            { $limit: 5000 },
          ])
          .toArray();
        for (const g of dups) await col.deleteMany({ _id: { $in: g.ids.slice(1) as never[] } });
        await col.createIndex(spec, opts);
        done.add(k);
        return;
      } catch (e2) {
        console.warn("[ensureIndex] dedupe failed", k, e2);
        return;
      }
    }
    console.warn("[ensureIndex]", k, e);
  }
}
