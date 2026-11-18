// Is the whole site private right now? (server only: used by proxy.ts, the sign-in route and the health check)
// The owner flips it from /app/admin ("Site access"); that is stored in Mongo (app_settings/_id "launch", field siteOpen) and
// every server notices within ~10 seconds, no redeploy. Until the admin has ever saved it, the old WRAITH_PRIVATE=1 variable decides.
// If the database cannot be read, the last known answer is kept (and the variable is the fallback), so a database hiccup never
// opens a private site or locks you out.
import { getDb } from "@/lib/mongoClient";

const TTL = 10_000;
let cache: { v: boolean; at: number } | null = null;
const envPrivate = () => process.env.WRAITH_PRIVATE === "1";

export async function isSitePrivate(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL) return cache.v;
  try {
    const doc = await (await getDb()).collection<{ _id: string; siteOpen?: unknown }>("app_settings").findOne({ _id: "launch" }, { projection: { siteOpen: 1 } });
    const v = typeof doc?.siteOpen === "boolean" ? !doc.siteOpen : envPrivate();
    cache = { v, at: Date.now() };
    return v;
  } catch (e) {
    console.error("[site access] read failed", e);
    return cache?.v ?? envPrivate();
  }
}

/** Called after the admin saves, so this server answers with the new value at once. */
export function setSitePrivateCache(v: boolean) { cache = { v, at: Date.now() }; }
