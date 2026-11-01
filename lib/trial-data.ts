import "server-only";
import type { Capture, Measurement, Trial } from "@prisma/client";
import { db } from "@/lib/db";
import { fnv1a } from "@/lib/rng";
import { METRIC_META, type Protocol } from "@/lib/protocol";
import { analyzeTrial, headlineFor, type AnalysisResult, type DayPoint } from "@/lib/stats";
import { concern, type ConcernKey } from "@/lib/youcam/concerns";

const DAY_MS = 86_400_000;

/** Day index of a local calendar date (YYYY-MM-DD) relative to the trial start date. */
export function dayIndexFor(startDate: Date, localDate: string) {
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const [y, m, d] = localDate.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - start) / DAY_MS);
}

export function phaseFor(trial: Pick<Trial, "baselineDays">, dayIndex: number): "baseline" | "treatment" {
  return dayIndex < (trial.baselineDays ?? 0) ? "baseline" : "treatment";
}

export function trialProtocol(trial: Trial): Protocol | null {
  return (trial.protocol as Protocol | null) ?? null;
}

export function metricMeta(trial: Trial) {
  const metric = (trial.primaryMetric ?? "ui_score") as keyof typeof METRIC_META;
  return { metric, ...METRIC_META[metric], concernLabel: trial.primaryConcern ? concern(trial.primaryConcern as ConcernKey).label : "" };
}

type CaptureWithM = Capture & { measurements: Measurement[] };

/** Counting captures (first successful one per day), with their measurements. */
export async function countingCaptures(trialId: string): Promise<CaptureWithM[]> {
  return db.capture.findMany({
    where: { trialId, counts: true, status: "success" },
    include: { measurements: true },
    orderBy: { dayIndex: "asc" },
  });
}

/** Builds the analysis series for any concern/metric from counting captures. */
export function seriesFrom(
  trial: Trial,
  captures: CaptureWithM[],
  opts: { concern: string; metric: "ui_score" | "mask_coverage" },
): DayPoint[] {
  const treatedSide = trial.treatedSide ?? "left";
  const controlSide = treatedSide === "left" ? "right" : "left";
  const out: DayPoint[] = [];
  for (const c of captures) {
    const ms = c.measurements.filter((m) => m.concern === opts.concern && m.metric === opts.metric && m.region === "whole");
    const phase = c.phase as DayPoint["phase"];
    if (opts.metric === "mask_coverage") {
      const t = ms.find((m) => m.side === treatedSide)?.value;
      const k = ms.find((m) => m.side === controlSide)?.value;
      const w = ms.find((m) => m.side === "whole")?.value;
      if (t !== undefined && k !== undefined) out.push({ day: c.dayIndex, phase, treated: t, control: k, value: w });
    } else {
      const w = ms.find((m) => m.side === "whole")?.value;
      if (w !== undefined) out.push({ day: c.dayIndex, phase, value: w });
    }
  }
  return out;
}

/** The pre-registered primary analysis, with exactly the locked parameters. */
export function primaryAnalysis(trial: Trial, captures: CaptureWithM[]): AnalysisResult | null {
  if (!trial.design || !trial.primaryConcern || !trial.primaryMetric || trial.sesoi == null) return null;
  const meta = METRIC_META[trial.primaryMetric as keyof typeof METRIC_META];
  const days = seriesFrom(trial, captures, { concern: trial.primaryConcern, metric: trial.primaryMetric as "ui_score" | "mask_coverage" });
  return analyzeTrial({
    design: trial.design as "split_face" | "pre_post",
    higherIsBetter: meta.higherIsBetter,
    sesoi: trial.sesoi,
    washInDays: trial.washInDays,
    claimDays: trial.claimDays,
    treatmentStartDay: trial.baselineDays ?? 0,
    plannedTreatmentDays: trial.treatmentDays ?? undefined,
    days,
    seed: fnv1a(`${trial.id}:${trial.protocolHash ?? ""}`),
  });
}

export function headlineForTrial(trial: Trial, r: AnalysisResult, daysLogged: number) {
  const meta = metricMeta(trial);
  return headlineFor(r, {
    metricLabel: meta.concernLabel,
    unit: meta.unit,
    design: trial.design as "split_face" | "pre_post",
    daysLogged,
    better: meta.better,
    lowerIsBetterArea: meta.less,
  });
}

/** Everything the dashboard / receipt / Verdict Agent need, in one load. */
export async function loadTrialBundle(trialId: string) {
  const trial = await db.trial.findUnique({ where: { id: trialId } });
  if (!trial) return null;
  const [captures, allCaptures, verdict, runs] = await Promise.all([
    countingCaptures(trialId),
    db.capture.findMany({
      where: { trialId },
      orderBy: { capturedAt: "asc" },
      select: { id: true, dayIndex: true, phase: true, status: true, counts: true, errorCode: true, quality: true, capturedAt: true, mock: true, units: true, photo: { select: { id: true } } },
    }),
    db.verdict.findFirst({ where: { trialId }, orderBy: { createdAt: "desc" } }),
    db.agentRun.findMany({ where: { trialId }, orderBy: { createdAt: "asc" } }),
  ]);
  const analysis = primaryAnalysis(trial, captures);
  const meta = trial.primaryMetric ? metricMeta(trial) : null;
  const series = trial.primaryConcern && trial.primaryMetric
    ? seriesFrom(trial, captures, { concern: trial.primaryConcern, metric: trial.primaryMetric as "ui_score" | "mask_coverage" })
    : [];
  const daysLogged = captures.length;
  return {
    trial,
    protocol: trialProtocol(trial),
    captures,
    allCaptures,
    analysis,
    headline: analysis ? headlineForTrial(trial, analysis, daysLogged) : null,
    series,
    meta,
    verdict,
    runs,
    daysLogged,
    photosStored: allCaptures.filter((c) => c.photo).length,
  };
}

export type TrialBundle = NonNullable<Awaited<ReturnType<typeof loadTrialBundle>>>;
