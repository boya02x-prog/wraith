// lib/signalLearning.ts  (server only)
// The self-improving loop: retrains lib/signalModel from the shared track record every few hours, keeps the model in MongoDB,
// and annotates live signals with detected patterns (+ win odds once the model has proven itself on unseen calls).
import { getDb } from "@/lib/mongoClient";
import { contextAt, type CtxCall, type CtxPrior, withContext } from "@/lib/signalRegime";
import { detectPatterns, PATTERNS, patternStats, predict, trainModel, type Features, type PatternStat, type SignalModel, type TrainRow } from "@/lib/signalModel";

const COLLECTION = "signal_model";
const TARGET = 2; // "win" = reached 2x from the call price, the same definition as the public record
const MATURE_MS = 4 * 3_600_000;
const RUG_MATURE_MS = 24 * 3_600_000;
const RUG_LEVEL = 0.2; // collapsed = ended below 20% of the call price
const RETRAIN_EVERY_MS = 6 * 3_600_000;
const MEMORY_MS = 10 * 60_000;
/** Largest score change the model may make, so a bad model can never run the feed. */
export const MAX_ADJ = 6;

export interface LearningSnapshot {
  model: Omit<SignalModel, "mean" | "std" | "w" | "names" | "trees"> | null;
  /** how well the collapse (rug) model did on calls it never saw; null until it has enough history */
  rug: Omit<SignalModel, "mean" | "std" | "w" | "names" | "trees"> | null;
  patterns: PatternStat[];
  coverage: { calls: number; withIntel: number; withIntelPct: number };
  /** every retrain so far (newest last): how many calls it learned from and its score on calls it never saw */
  history: { at: number; calls: number; auc: number | null; active: boolean; rugAuc: number | null }[];
  at: number;
}

let mem: { ts: number; model: SignalModel | null; rug: SignalModel | null; patterns: PatternStat[]; coverage: LearningSnapshot["coverage"] } | null = null;
let training: Promise<void> | null = null;
let lastTrainCheck = 0;

async function load(): Promise<NonNullable<typeof mem>> {
  if (mem && Date.now() - mem.ts < MEMORY_MS) return mem;
  try {
    const doc = await (await getDb()).collection(COLLECTION).findOne({ _id: "current" as never });
    mem = {
      ts: Date.now(),
      model: (doc?.model as SignalModel) ?? null,
      rug: (doc?.rug as SignalModel) ?? null,
      patterns: (doc?.patterns as PatternStat[]) ?? [],
      coverage: (doc?.coverage as LearningSnapshot["coverage"]) ?? { calls: 0, withIntel: 0, withIntelPct: 0 },
    };
  } catch {
    mem = { ts: Date.now(), model: mem?.model ?? null, rug: mem?.rug ?? null, patterns: mem?.patterns ?? [], coverage: mem?.coverage ?? { calls: 0, withIntel: 0, withIntelPct: 0 } };
  }
  return mem;
}

/** Retrain from every matured call. Cheap (a few thousand rows, pure math), runs at most every 6 hours. */
export async function retrainIfDue(force = false): Promise<void> {
  if (training) return training;
  if (!force && Date.now() - lastTrainCheck < 10 * 60_000) return;
  lastTrainCheck = Date.now();
  training = (async () => {
    try {
      const db = await getDb();
      const col = db.collection(COLLECTION);
      const cur = await col.findOne({ _id: "current" as never }, { projection: { at: 1, model: 1, rug: 1 } });
      if (!force && cur?.at && Date.now() - new Date(cur.at as Date).getTime() < RETRAIN_EVERY_MS) return;
      const docs = await db
        .collection("signal_calls")
        .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $lt: Date.now() - MATURE_MS } }, { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } })
        .sort({ spottedAt: -1 })
        .limit(6_000)
        .toArray();
      // every call also learns the market context it was made in (regime + ranks, from calls before it): see lib/signalRegime.ts
      const ctx = withContext(docs as unknown as Parameters<typeof withContext>[0]);
      const withCtx = ctx.docs;
      const rows: TrainRow[] = withCtx.map((d) => ({
        features: d.features,
        win: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= TARGET,
        at: d.spottedAt as number,
      }));
      const withIntel = rows.filter((r) => typeof r.features.smart === "number" || typeof r.features.flowBuyers === "number").length;
      const trained = trainModel(rows);
      // Rug model: same trees, different question. "Will this call end below 20% of its call price?" Needs a full day to judge.
      const oldDocs = withCtx.filter((d) => (d.spottedAt as number) < Date.now() - RUG_MATURE_MS);
      const trainedRug = trainModel(oldDocs.map((d) => ({ features: d.features, win: d.lastMcap / d.spottedMcap <= RUG_LEVEL, at: d.spottedAt as number })));
      // Champion / challenger: a retrain may IMPROVE the live model but must never replace one that beats chance with one that does not
      // (a data glitch or a bad week would otherwise switch the model off or make it worse until the next retrain).
      const curModel = cur?.model as SignalModel | undefined, curRug = cur?.rug as SignalModel | undefined;
      // ...and a challenger that scores clearly worse on unseen calls (more than 0.02 AUC) does not replace it either
      const keepModel = !!curModel?.active && (!trained?.active || trained.holdout.auc < curModel.holdout.auc - 0.02);
      const keepRug = !!curRug?.active && (!trainedRug?.active || trainedRug.holdout.auc < curRug.holdout.auc - 0.02);
      const model = keepModel ? curModel! : trained;
      const rug = keepRug ? curRug! : trainedRug;
      await col.updateOne(
        { _id: "current" as never },
        { $set: { model, rug, ctx: ctx.prior, patterns: patternStats(rows), coverage: { calls: rows.length, withIntel, withIntelPct: rows.length ? Math.round((withIntel / rows.length) * 1000) / 10 : 0 }, at: new Date() } },
        { upsert: true },
      );
      // A record of every retrain, so "is it learning?" has a visible answer: how the score on unseen calls moves as calls pile up.
      await db.collection("signal_model_history").insertOne({
        at: Date.now(), calls: rows.length, wins: rows.filter((r) => r.win).length,
        auc: trained?.holdout.auc ?? null, active: !!trained?.active, topQ: trained?.holdout.topQuartileRate ?? null, bottomQ: trained?.holdout.bottomQuartileRate ?? null,
        rugAuc: trainedRug?.holdout.auc ?? null, rugActive: !!trainedRug?.active, keptOldModel: keepModel, keptOldRug: keepRug,
      }).catch(() => undefined);
      mem = null;
    } catch (e) {
      console.warn("[signal-learning] retrain failed", e instanceof Error ? e.message : e);
    }
  })().finally(() => { training = null; });
  return training;
}

export interface Annotated { patterns: string[]; odds?: number; adj: number; /** % chance this call collapses (rugs); only when the rug model beat chance on unseen calls */ rugRisk?: number }

// The last ~41 hours of calls, kept in memory for 5 minutes: enough to describe the market a new signal is appearing in.
let recent: { ts: number; hist: CtxCall[]; prior: CtxPrior } | null = null;
async function recentContext(): Promise<NonNullable<typeof recent>> {
  if (recent && Date.now() - recent.ts < 5 * 60_000) return recent;
  try {
    const db = await getDb();
    const [docs, cur] = await Promise.all([
      db.collection("signal_calls")
        .find({ engine: 2, badData: { $ne: true }, spottedMcap: { $gt: 0 }, spottedAt: { $gt: Date.now() - 41 * 3_600_000 } }, { projection: { features: 1, spottedAt: 1, spottedMcap: 1, peakMcap: 1, lastMcap: 1 } })
        .sort({ spottedAt: 1 }).toArray(),
      db.collection(COLLECTION).findOne({ _id: "current" as never }, { projection: { ctx: 1 } }),
    ]);
    const hist: CtxCall[] = docs.map((d) => ({ at: d.spottedAt as number, f: (d.features as Features) ?? {}, win: Math.max(d.peakMcap, d.lastMcap) / d.spottedMcap >= TARGET, col: d.lastMcap / d.spottedMcap <= RUG_LEVEL }));
    const prior = (cur?.ctx as CtxPrior | undefined) ?? { gw: 0.2, gc: 0.4 };
    recent = { ts: Date.now(), hist, prior };
  } catch {
    recent = { ts: Date.now(), hist: recent?.hist ?? [], prior: recent?.prior ?? { gw: 0.2, gc: 0.4 } };
  }
  return recent;
}

/** Patterns for one signal, plus the model's win odds and a small capped score nudge when the model is active. */
export async function annotateFeatures(listIn: Features[]): Promise<Annotated[]> {
  const { model, rug } = await load();
  // same market context the model was trained with (missing history just leaves those inputs empty)
  const rc = await recentContext();
  const now = Date.now();
  const list = listIn.map((f) => ({ ...f, ...contextAt(rc.hist, rc.hist.length, now, f, rc.prior) }));
  return list.map((f) => {
    const patterns = detectPatterns(f);
    const rugRisk = rug?.active ? Math.round(predict(rug, f) * 100) : undefined;
    if (!model?.active) return { patterns, adj: 0, rugRisk };
    const p = predict(model, f);
    const adj = Math.max(-MAX_ADJ, Math.min(MAX_ADJ, Math.round(((p - model.base) / Math.max(0.05, model.base)) * 6)));
    return { patterns, odds: Math.round(p * 1000) / 10, adj, rugRisk };
  });
}

export async function learningSnapshot(): Promise<LearningSnapshot> {
  const m = await load();
  let history: LearningSnapshot["history"] = [];
  try {
    const rows = await (await getDb()).collection("signal_model_history").find({}, { projection: { _id: 0, at: 1, calls: 1, auc: 1, active: 1, rugAuc: 1 } }).sort({ at: -1 }).limit(40).toArray();
    history = (rows.reverse() as unknown) as LearningSnapshot["history"];
  } catch { /* history is optional */ }
  const model = m.model ? (({ mean: _mean, std: _std, w: _w, names: _names, trees: _trees, ...rest }) => rest)(m.model) : null;
  // pattern labels exist even before the first training run
  const patterns = m.patterns.length ? m.patterns : PATTERNS.map((p) => ({ id: p.id, label: p.label, hint: p.hint, trap: p.id.startsWith("trap-"), calls: 0, wins: 0, rate: null, lift: null }));
  const rug = m.rug ? (({ mean: _mean, std: _std, w: _w, names: _names, trees: _trees, ...rest }) => rest)(m.rug) : null;
  return { model, rug, patterns, coverage: m.coverage, history, at: Date.now() };
}

export const patternLabel = (id: string) => PATTERNS.find((p) => p.id === id)?.label ?? id;
