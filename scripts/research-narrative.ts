/**
 * Does "the token's name matches what the world is reading about that day" separate winners from losers?  Read-only:
 *   npx tsx scripts/research-narrative.ts
 * Free, dated data: Wikipedia's daily top-1000 most read articles (Wikimedia pageviews API). For each public call (24h+ old), the
 * day BEFORE the call is looked up, so nothing from the future leaks in. A call is "in the news" when a meaningful word of its
 * name/ticker (4+ letters, not a generic crypto word) equals a word in a top-article title, or the title is inside the name.
 * Prints how often calls in the news vs not reached 2x / 5x and ended below 20%, with 95% ranges. This tests ONE cheap proxy for
 * narrative; it does not read X, Telegram or Reddit (those need paid or login-gated access), so a null result is about this
 * proxy, not about narratives in general.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";

const GENERIC = new Set(["coin", "token", "meme", "memecoin", "pump", "fun", "the", "and", "inu", "doge", "pepe", "cat", "dog", "sol", "solana", "ai", "bonk", "official", "wif", "baby", "elon", "moon", "king", "coins", "dollar", "dollars", "man", "bro", "frog", "wojak", "chad", "trump", "maga"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));
const wilson = (k: number, n: number): [number, number] => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

async function topTitles(date: string, cache: Map<string, Set<string>>): Promise<Set<string>> {
  const hit = cache.get(date);
  if (hit) return hit;
  const [y, m, d] = date.split("-");
  const out = new Set<string>();
  try {
    const r = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${y}/${m}/${d}`, { headers: { "User-Agent": "research-script (token backtest)", Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const j = (await r.json()) as { items?: { articles?: { article: string; views: number }[] }[] };
      for (const a of j.items?.[0]?.articles ?? []) {
        const t = a.article.replace(/_/g, " ");
        if (/^(Main Page|Special:|Wikipedia:|Portal:|Help:|File:|Category:|Talk:|-)/i.test(t)) continue;
        out.add(t.toLowerCase());
        for (const w of words(t)) out.add(`w:${w}`);
      }
    }
  } catch { /* leave empty: day counted as unknown */ }
  cache.set(date, out);
  await new Promise((r) => setTimeout(r, 120));
  return out;
}

async function main() {
  const cli = new MongoClient(process.env.MONGODB_URI!); await cli.connect();
  const docs = await cli.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, shadow: { $ne: true }, spottedAt: { $lt: Date.now() - 24 * 3600e3 }, spottedMcap: { $gt: 0 } },
      { projection: { name: 1, symbol: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } }).toArray();
  await cli.close();
  const cache = new Map<string, Set<string>>();
  const rows: { news: boolean; match: string; hit2: boolean; hit5: boolean; coll: boolean }[] = [];
  for (const d of docs) {
    const date = day(Number(d.spottedAt) - 24 * 3600e3);
    const titles = await topTitles(date, cache);
    if (titles.size === 0) continue;
    const s = Number(d.spottedMcap), peak = Math.max(Number(d.peakMcap ?? s), Number(d.lastMcap ?? s)) / s, end = Number(d.lastMcap ?? s) / s;
    const ws = [...words(String(d.name ?? "")), ...words(String(d.symbol ?? ""))];
    const nameKey = String(d.name ?? "").toLowerCase().trim();
    let match = ws.find((w) => titles.has(`w:${w}`)) ?? "";
    if (!match && nameKey.length >= 5 && titles.has(nameKey)) match = nameKey;
    rows.push({ news: !!match, match, hit2: peak >= 2, hit5: peak >= 5, coll: end < 0.2 });
  }
  console.log(`calls checked: ${rows.length} over ${cache.size} days`);
  const show = (label: string, xs: typeof rows) => {
    const [lo, hi] = wilson(xs.filter((x) => x.hit2).length, xs.length);
    console.log(`${label.padEnd(22)} n=${String(xs.length).padStart(4)}  reached 2x ${pct(xs.filter((x) => x.hit2).length / (xs.length || 1)).padStart(4)} (${pct(lo)}-${pct(hi)})  5x ${pct(xs.filter((x) => x.hit5).length / (xs.length || 1)).padStart(3)}  ended<20% ${pct(xs.filter((x) => x.coll).length / (xs.length || 1)).padStart(4)}`);
  };
  show("name matches the news", rows.filter((r) => r.news));
  show("no match", rows.filter((r) => !r.news));
  const hits = rows.filter((r) => r.news).map((r) => r.match);
  console.log("matched words:", [...new Set(hits)].slice(0, 30).join(", "));
}
void main();
