/**
 * Would an outside scam check have kept the failed calls out?   npx tsx scripts/research-rugcheck.ts [max=1400]
 * Asks RugCheck's free public summary (no key, no signup) about every past call that has a real price path, saves the answers in
 * scripts/.pilot/rugcheck.json (resumable), then reports for each warning: how many calls had it and how those calls ended.
 * Read-only on the database. Honest limit: RugCheck describes the token NOW, so a few warnings (like holder concentration) can
 * be partly a result of the collapse rather than a cause. Warnings about the creator and the token's setup are the cleanest.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { auc } from "../lib/signalModel";

const OUT = "scripts/.pilot/rugcheck.json";
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 1400);
interface Sum { ok: boolean; norm?: number; lp?: number; risks?: { name: string; level: string }[] }

async function ask(mint: string): Promise<Sum> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r) { await new Promise((x) => setTimeout(x, 1500)); continue; }
    if (r.status === 429) { await new Promise((x) => setTimeout(x, 8000)); continue; }
    if (!r.ok) return { ok: false };
    const j = (await r.json().catch(() => null)) as { score_normalised?: number; lpLockedPct?: number; risks?: { name: string; level: string }[] } | null;
    if (!j) return { ok: false };
    return { ok: true, norm: j.score_normalised, lp: j.lpLockedPct, risks: (j.risks ?? []).map((x) => ({ name: x.name, level: x.level })) };
  }
  return { ok: false };
}

async function main() {
  const done: Record<string, Sum> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const paths: Record<string, { ok?: boolean }> = existsSync("scripts/.pilot/paths.json") ? JSON.parse(readFileSync("scripts/.pilot/paths.json", "utf8")) : {};
  const pathsH: Record<string, { ok?: boolean }> = existsSync("scripts/.pilot/paths-helius.json") ? JSON.parse(readFileSync("scripts/.pilot/paths-helius.json", "utf8")) : {};
  const c = new MongoClient(process.env.MONGODB_URI!); await c.connect();
  const calls = await c.db(process.env.MONGODB_DB || "wraith").collection("signal_calls")
    .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - 24 * 3_600_000 }, address: { $regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ } },
      { projection: { address: 1, shadow: 1, score: 1, spottedMcap: 1, lastMcap: 1, peakMcap: 1 } }).sort({ spottedAt: -1 }).toArray();
  await c.close();
  const withPath = calls.filter((x) => paths[x.address as string]?.ok || pathsH[x.address as string]?.ok);
  // public calls first: they are what users see
  const todo = withPath.filter((x) => !done[x.address as string]).sort((a, b) => Number(!b.shadow) - Number(!a.shadow)).slice(0, MAX);
  console.log(`${withPath.length} calls with a path, ${Object.keys(done).length} already checked, checking ${todo.length}`);
  let n = 0;
  for (const t of todo) {
    done[t.address as string] = await ask(t.address as string);
    n++;
    if (n % 25 === 0) { writeFileSync(OUT, JSON.stringify(done)); console.log(`  ${n}/${todo.length} checked`); }
    await new Promise((r) => setTimeout(r, 350));
  }
  writeFileSync(OUT, JSON.stringify(done));

  // ── report ──
  const rows = withPath.filter((x) => done[x.address as string]?.ok).map((x) => {
    const peak = Math.max(x.peakMcap as number, x.lastMcap as number) / (x.spottedMcap as number);
    return { pub: !x.shadow, win: peak >= 2, col: (x.lastMcap as number) / (x.spottedMcap as number) <= 0.2, s: done[x.address as string] };
  });
  console.log(`\n${rows.length} calls answered (${rows.filter((r) => r.pub).length} public).`);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
  for (const [title, set] of [["ALL CALLS", rows], ["PUBLIC CALLS ONLY (what users see)", rows.filter((r) => r.pub)]] as const) {
    const base = { col: set.filter((r) => r.col).length, win: set.filter((r) => r.win).length };
    console.log(`\n== ${title}: ${set.length} calls, ${pct(base.col, set.length)} collapsed, ${pct(base.win, set.length)} reached 2x ==`);
    const names = new Map<string, { danger: typeof set; warn: typeof set }>();
    for (const r of set) for (const k of r.s.risks ?? []) {
      const e = names.get(k.name) ?? { danger: [], warn: [] };
      (k.level === "danger" ? e.danger : e.warn).push(r);
      names.set(k.name, e);
    }
    const list: [string, string, typeof set][] = [];
    for (const [name, e] of names) { if (e.danger.length >= 8) list.push([name, "danger", e.danger]); if (e.warn.length >= 8) list.push([name, "warn", e.warn]); }
    list.sort((a, b) => b[2].length - a[2].length);
    for (const [name, lvl, g] of list.slice(0, 14)) console.log(`  ${(name + " [" + lvl + "]").padEnd(54)} ${String(g.length).padStart(4)} calls | collapsed ${pct(g.filter((r) => r.col).length, g.length).padStart(4)} | reached 2x ${pct(g.filter((r) => r.win).length, g.length).padStart(4)}`);
    const anyDanger = set.filter((r) => (r.s.risks ?? []).some((k) => k.level === "danger"));
    const clean = set.filter((r) => !(r.s.risks ?? []).some((k) => k.level === "danger"));
    console.log(`  ANY danger flag   : ${String(anyDanger.length).padStart(4)} calls | collapsed ${pct(anyDanger.filter((r) => r.col).length, anyDanger.length)} | reached 2x ${pct(anyDanger.filter((r) => r.win).length, anyDanger.length)}`);
    console.log(`  no danger flag    : ${String(clean.length).padStart(4)} calls | collapsed ${pct(clean.filter((r) => r.col).length, clean.length)} | reached 2x ${pct(clean.filter((r) => r.win).length, clean.length)}`);
    const sc = set.filter((r) => typeof r.s.norm === "number");
    if (sc.length > 30) console.log(`  RugCheck risk score as a collapse detector: AUC ${auc(sc.map((r) => r.s.norm as number), sc.map((r) => (r.col ? 1 : 0))).toFixed(3)} | as a 2x detector (should be low): ${auc(sc.map((r) => r.s.norm as number), sc.map((r) => (r.win ? 1 : 0))).toFixed(3)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
