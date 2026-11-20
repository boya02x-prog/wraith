// Checks the Auto-trader allowlist (lib/autoAccess.ts) against a tiny in-memory stand-in for the database, so nothing real is touched.
// Run: npx tsx scripts/test-autoaccess.ts
type Doc = { _id: string; addedAt: number; addedBy?: string };
const rows = new Map<string, Doc>();
const fakeCol = {
  find: () => ({ sort: () => ({ limit: (n: number) => ({ toArray: async () => [...rows.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, n) }) }) }),
  estimatedDocumentCount: async () => rows.size,
  updateOne: async (f: { _id: string }, u: { $setOnInsert: Omit<Doc, "_id"> }) => { if (!rows.has(f._id)) rows.set(f._id, { _id: f._id, ...u.$setOnInsert }); },
  deleteOne: async (f: { _id: string }) => { rows.delete(f._id); },
  findOne: async (f: { _id: string }) => rows.get(f._id) ?? null,
};
// replace the database module before the allowlist module loads it
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dbPath = require.resolve("../lib/mongoClient");
// eslint-disable-next-line @typescript-eslint/no-require-imports
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: async () => ({ collection: () => fakeCol }) } } as unknown as NodeJS.Module;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const A = require("../lib/autoAccess") as typeof import("../lib/autoAccess");

process.env.QUESTS_ADMIN_EMAILS = "owner@example.com";
process.env.QUESTS_ADMIN_USER_IDS = "did:privy:owner";

let bad = 0;
const t = (name: string, ok: boolean, extra = "") => { console.log(ok ? "PASS" : "FAIL", name.padEnd(66), extra); if (!ok) bad++; };

(async () => {
  t("normEmail trims and lower-cases", A.normEmail("  Friend@Gmail.COM ") === "friend@gmail.com");
  t("normEmail of a non-string is empty", A.normEmail(42) === "" && A.normEmail(null) === "" && A.normEmail(undefined) === "");
  t("validEmail accepts a normal address", A.validEmail("friend@gmail.com"));
  t("validEmail rejects no @ / no dot / spaces / too long",
    !A.validEmail("friend") && !A.validEmail("friend@gmail") && !A.validEmail("a b@c.com") && !A.validEmail(`${"a".repeat(250)}@x.com`));

  t("owner is allowed with an empty list (by id)", await A.isAutoAllowed("did:privy:owner", null));
  t("owner is allowed with an empty list (by email, any case)", await A.isAutoAllowed("someone-else", "Owner@Example.com"));
  t("a stranger is not allowed", !(await A.isAutoAllowed("did:privy:x", "friend@gmail.com")));
  t("an account with no email is not allowed", !(await A.isAutoAllowed("did:privy:x", null)));

  const bd = await A.addAccess("  Friend@Gmail.com ", "owner@example.com");
  t("adding an email works", bd.ok === true);
  t("the added person is now allowed (case-insensitive)", await A.isAutoAllowed("did:privy:x", "FRIEND@gmail.com"));
  t("a different person is still not allowed", !(await A.isAutoAllowed("did:privy:y", "other@gmail.com")));
  await A.addAccess("friend@gmail.com", "someone-else");
  const list1 = await A.listAccess();
  t("adding the same email twice keeps one row and the first adder", list1.length === 1 && list1[0].email === "friend@gmail.com" && list1[0].addedBy === "owner@example.com");

  const junk = await A.addAccess("not-an-email", "owner@example.com");
  t("a bad email is refused with a message", junk.ok === false && "message" in junk && junk.message.length > 5);
  t("the refused one is not in the list", (await A.listAccess()).length === 1);

  await A.removeAccess("FRIEND@gmail.com");
  t("removing takes effect immediately", !(await A.isAutoAllowed("did:privy:x", "friend@gmail.com")) && (await A.listAccess()).length === 0);

  for (let i = 0; i < 200; i++) await A.addAccess(`p${i}@x.com`, "o");
  const full = await A.addAccess("one-more@x.com", "o");
  t("the list stops at 200 people", full.ok === false && rows.size === 200);

  if (bad) { console.log(`\n${bad} FAILED`); process.exitCode = 1; } else console.log("\nall passed");
})();
export {};
