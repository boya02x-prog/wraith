// Is the whole site private right now? (server only: used by proxy.ts, the sign-in route and the health check)
// The owner flips it from /app/admin ("Site access"); that is stored in Mongo (app_settings/_id "launch", field siteOpen) and
// every server notices within ~10 seconds, no redeploy. Until the admin has ever saved it, the old WRAITH_PRIVATE=1 variable decides.
// If the database cannot be read, the last known answer is kept (and the variable is the fallback), so a database hiccup never
// opens a private site or locks you out.
//
// SPEED: this runs in front of EVERY request. It used to wait for the database each time the 10-second cache ran out, and many
// requests landed at the same moment, so the proxy step went from ~30 ms to 400-800 ms. Now a request NEVER waits for the database
// once an answer is known: it gets the last answer at once and, when that is older than 10 seconds, ONE refresh runs in the background.
import { getDb } from "@/lib/mongoClient";

const TTL = 10_000;
let cache: { v: boolean; at: number } | null = null;
let refreshing: Promise<boolean> | null = null;
const envPrivate = () => process.env.WRAITH_PRIVATE === "1";

function refresh(): Promise<boolean> {
  if (refreshing) return refreshing; // one lookup at a time, however many requests are waiting
  refreshing = (async () => {
    try {
      const doc = await (await getDb()).collection<{ _id: string; siteOpen?: unknown }>("app_settings").findOne({ _id: "launch" }, { projection: { siteOpen: 1 } });
      const v = typeof doc?.siteOpen === "boolean" ? !doc.siteOpen : envPrivate();
      cache = { v, at: Date.now() };
      return v;
    } catch (e) {
      console.error("[site access] read failed", e);
      const v = cache?.v ?? envPrivate();
      cache = { v, at: Date.now() - TTL + 3000 }; // try again in ~3 s, keep the last answer meanwhile
      return v;
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function isSitePrivate(): Promise<boolean> {
  if (cache) {
    if (Date.now() - cache.at >= TTL) void refresh(); // stale: refresh in the background, answer now
    return cache.v;
  }
  return refresh(); // the very first call on this server has nothing to go on yet
}

/** Called after the admin saves, so this server answers with the new value at once. */
export function setSitePrivateCache(v: boolean) { cache = { v, at: Date.now() }; }
