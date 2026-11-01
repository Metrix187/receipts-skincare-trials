// The pre-registered analysis for one Receipts trial. Deterministic: the same data and
// protocol always give the same numbers (the bootstrap is seeded by the trial id).
//
// THE ESTIMAND
//   pre_post:   effect = mean(score | treatment days) - mean(score | baseline days)
//   split_face: d_t = treated_t - control_t   (same photo, same lighting: shared
//               day-to-day noise cancels), then
//               effect = mean(d | treatment days) - mean(d | baseline days)
//               The baseline term removes the face's natural left/right asymmetry.
//   Values are oriented so that POSITIVE = IMPROVEMENT (metrics where lower is
//   better, like mask coverage, are negated first).
//   Treatment days inside the pre-registered wash-in window are excluded.
//
// THE DECISION RULE (fixed before any data, using SESOI = smallest effect size of
// interest, also pre-registered):
//   not_enough_data       fewer than the minimum baseline or treatment days
//   improved              95% CI entirely above 0
//   worsened              95% CI entirely below 0
//   no_meaningful_change  95% CI entirely inside (-SESOI, +SESOI)  (an equivalence result)
//   inconclusive          everything else: the data can't yet tell a small effect from none
//
// One metric, one test, one interval. Secondary metrics are shown as descriptive only.

import { bootstrapDiff, mean, variance } from "./bootstrap";
import { tQuantile } from "./distributions";
import { prng } from "@/lib/rng";

export type Design = "split_face" | "pre_post";
export type VerdictLabel = "not_enough_data" | "improved" | "worsened" | "no_meaningful_change" | "inconclusive";

export interface DayPoint {
  day: number;
  phase: "baseline" | "treatment";
  /** pre_post: the whole-face value */
  value?: number;
  /** split_face: per-side values */
  treated?: number;
  control?: number;
}

export interface AnalysisInput {
  design: Design;
  higherIsBetter: boolean;
  sesoi: number;
  washInDays?: number;
  minBaselineDays?: number;
  minTreatmentDays?: number;
  /** Treatment duration stated in the claim ("4 weeks" -> 28). */
  claimDays?: number | null;
  /** First treatment day index (to measure elapsed treatment time). */
  treatmentStartDay: number;
  /** Locked duration; data after the pre-registered endpoint are excluded. */
  plannedTreatmentDays?: number;
  days: DayPoint[];
  seed: number;
  resamples?: number;
}

export interface TrajectoryPoint {
  day: number;
  effect: number;
  lo: number;
  hi: number;
}

export interface AnalysisResult {
  label: VerdictLabel;
  effect: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  sesoi: number;
  nBaseline: number;
  nTreatment: number;
  nExcludedWashIn: number;
  baselineMean: number | null;
  treatmentMean: number | null;
  /** Day-to-day SD of the analyzed series (oriented). */
  dailySd: number | null;
  /** Interval internals, so the method is auditable. */
  method: { name: string; phi: number; phiRaw: number; se: number; df: number; resamples: number } | null;
  /** Fraction of daily noise removed by pairing sides (split_face only). */
  pairingNoiseReduction: number | null;
  daysRemaining: {
    /** More treatment days until the CI half-width reaches SESOI/2 (null = unreachable). */
    precision: number | null;
    /** Days until the claim's own timeframe is reached. */
    timeframe: number | null;
    /** max of the two: the honest "come back in N days". */
    overall: number | null;
    note: string;
  };
  trajectory: TrajectoryPoint[];
  minimums: { baseline: number; treatment: number };
  interim: boolean;
}

/** z.975 / (z.975 + z.80): planning half-width as a fraction of the SESOI. */
export const PLANNING_FRACTION = 1.959964 / (1.959964 + 0.841621);

export function analyzeTrial(input: AnalysisInput): AnalysisResult {
  const resamples = input.resamples ?? 4000;
  const minB = input.minBaselineDays ?? (input.design === "split_face" ? 3 : 5);
  const minT = input.minTreatmentDays ?? 7;
  const washIn = input.washInDays ?? 0;
  const sign = input.higherIsBetter ? 1 : -1;

  // Series to analyze, oriented so positive = better.
  const series = [...input.days]
    .sort((a, b) => a.day - b.day)
    .map((d) => {
      const v =
        input.design === "split_face"
          ? d.treated !== undefined && d.control !== undefined
            ? d.treated - d.control
            : undefined
          : d.value;
      return { ...d, v: v === undefined || !Number.isFinite(v) ? undefined : sign * v };
    })
    .filter((d): d is typeof d & { v: number } => d.v !== undefined);

  const baseline = series.filter((d) => d.phase === "baseline");
  const allTreatment = series.filter((d) => d.phase === "treatment");
  const treatAll = allTreatment.filter((d) => input.plannedTreatmentDays == null || d.day < input.treatmentStartDay + input.plannedTreatmentDays);
  const treatment = treatAll.filter((d) => d.day - input.treatmentStartDay >= washIn);
  const B = baseline.map((d) => d.v);
  const T = treatment.map((d) => d.v);
  // Wash-in days are excluded from the effect but still inform the noise model.
  const W = treatAll.filter((d) => d.day - input.treatmentStartDay < washIn).map((d) => d.v);

  const elapsedTreatment = allTreatment.length
    ? Math.max(...allTreatment.map((d) => d.day)) - input.treatmentStartDay + 1
    : 0;
  const timeframe =
    input.claimDays != null ? Math.max(0, input.claimDays - elapsedTreatment) : null;
  const plannedRemaining = input.plannedTreatmentDays == null ? 0 : Math.max(0, input.plannedTreatmentDays - elapsedTreatment);
  const interim = plannedRemaining > 0;

  const pairingNoiseReduction =
    input.design === "split_face" ? pairingReduction(input.days, sign) : null;

  const base: Omit<AnalysisResult, "label" | "effect" | "ciLow" | "ciHigh" | "daysRemaining" | "trajectory" | "method"> = {
    sesoi: input.sesoi,
    nBaseline: B.length,
    nTreatment: T.length,
    nExcludedWashIn: treatAll.length - treatment.length,
    baselineMean: B.length ? mean(B) : null,
    treatmentMean: T.length ? mean(T) : null,
    dailySd: T.length + B.length > 2 ? Math.sqrt(pooledVariance(T, B)) : null,
    pairingNoiseReduction,
    minimums: { baseline: minB, treatment: minT },
    interim,
  };

  if (B.length < minB || T.length < minT) {
    // Not enough data: report raw means but no interval, and count days to the minimum.
    const needT = Math.max(0, minT - T.length);
    const needB = Math.max(0, minB - B.length);
    const precisionGuess = needT + (needB > 0 && treatAll.length === 0 ? needB : 0);
    const windowClosed = input.plannedTreatmentDays != null && !interim;
    const baselineClosed = needB > 0 && allTreatment.length > 0;
    return {
      ...base,
      label: "not_enough_data",
      effect: null,
      ciLow: null,
      ciHigh: null,
      method: null,
      daysRemaining: {
        precision: null,
        timeframe,
        overall: windowClosed || baselineClosed ? null : Math.max(precisionGuess, timeframe ?? 0, plannedRemaining),
        note: windowClosed
          ? "The pre-registered window closed without enough data; a new trial is needed."
          : baselineClosed
            ? "The baseline ended without enough data; a new trial is needed."
            : needB > 0
            ? `Need ${needB} more baseline day(s) before treatment can be evaluated.`
            : `Need ${needT} more treatment day(s) before any interval is meaningful.`,
      },
      trajectory: [],
    };
  }

  const rnd = prng(input.seed);
  const boot = bootstrapDiff(T, B, { resamples, rnd, noiseOnly: [W] });
  // Repeated daily looks are not a sequential test. Only classify at the locked
  // endpoint; earlier estimates remain exploratory rather than a final verdict.
  const label = interim ? "inconclusive" : decide(boot.ciLow, boot.ciHigh, input.sesoi);

  // ---- Days remaining: precision-based planning ---------------------------------
  // Var(effect) ~ VarT_now * nT_now / nT + VarB  (only treatment days accumulate from
  // here; the baseline is fixed). Target half-width h* = SESOI * z.975 / (z.975 + z.80)
  // = 0.7 * SESOI, the textbook sample-size convention: a true effect of SESOI would
  // be detected with 80% power. Solve for nT. The t critical value depends on nT, so
  // iterate a few times. If the fixed baseline alone is already wider than h*, more
  // treatment days can never get there, and we say so instead of inventing a number.
  let precision: number | null;
  let note: string;
  const halfWidth = (boot.ciHigh - boot.ciLow) / 2;
  if (label === "improved" || label === "worsened" || label === "no_meaningful_change") {
    precision = 0;
    note = "The interval already answers the question.";
  } else {
    const target = input.sesoi * PLANNING_FRACTION;
    let nT = T.length;
    let reachable = true;
    for (let i = 0; i < 4; i++) {
      const t = tQuantile(0.975, Math.max(2, nT + B.length - 3));
      const room = (target / t) ** 2 - boot.varBaselineMean;
      if (room <= 0) {
        reachable = false;
        break;
      }
      nT = Math.max(T.length, Math.ceil((boot.varTreatmentMean * T.length) / room));
    }
    if (!reachable) {
      precision = null;
      note = "The baseline is too noisy to ever reach the target precision; more treatment days won't fix it. A longer baseline or steadier captures would.";
    } else {
      precision = nT - T.length;
      note = `Interval half-width is ±${halfWidth.toFixed(1)}; reaching ±${target.toFixed(1)} (80% power to detect ${input.sesoi}) needs about ${precision} more treatment day(s).`;
    }
  }
  if (interim) note = `Interim estimate only; ${plannedRemaining} day(s) remain until the pre-registered endpoint. Repeated looks are not a sequential test.`;
  else if (input.plannedTreatmentDays != null && label === "inconclusive") {
    precision = null;
    note = "The pre-registered window is complete. Further measurements need a new analysis plan; they cannot guarantee a conclusive result.";
  }
  const overall = interim ? Math.max(plannedRemaining, timeframe ?? 0) : precision === null ? null : Math.max(precision, timeframe ?? 0);

  return {
    ...base,
    label,
    effect: boot.estimate,
    ciLow: boot.ciLow,
    ciHigh: boot.ciHigh,
    method: {
      name: "AR(1)-sieve bootstrap, Student-t interval",
      phi: boot.phi,
      phiRaw: boot.phiRaw,
      se: boot.se,
      df: boot.df,
      resamples,
    },
    daysRemaining: { precision, timeframe, overall, note },
    // The last trajectory point IS the primary analysis (same numbers everywhere).
    trajectory: trajectory(T, B, W, treatment.map((d) => d.day), minT, input.seed).map((p, i, all) =>
      i === all.length - 1 ? { ...p, effect: boot.estimate, lo: boot.ciLow, hi: boot.ciHigh } : p,
    ),
  };
}

export function decide(lo: number, hi: number, sesoi: number): VerdictLabel {
  if (lo > 0) return "improved";
  if (hi < 0) return "worsened";
  if (lo > -sesoi && hi < sesoi) return "no_meaningful_change";
  return "inconclusive";
}

/** Effect estimate as it stood after each treatment day (shows the interval tightening). */
function trajectory(T: number[], B: number[], W: number[], days: number[], minT: number, seed: number): TrajectoryPoint[] {
  const out: TrajectoryPoint[] = [];
  for (let k = Math.max(3, Math.min(minT, T.length)); k <= T.length; k++) {
    const b = bootstrapDiff(T.slice(0, k), B, { resamples: 1500, rnd: prng(seed + k), noiseOnly: [W] });
    out.push({ day: days[k - 1], effect: b.estimate, lo: b.ciLow, hi: b.ciHigh });
  }
  return out;
}

function pooledVariance(a: number[], b: number[]) {
  const na = a.length;
  const nb = b.length;
  if (na + nb < 3) return 0;
  return ((na - 1) * (na > 1 ? variance(a) : 0) + (nb - 1) * (nb > 1 ? variance(b) : 0)) / Math.max(1, na + nb - 2);
}

/**
 * How much day-to-day noise the split-face pairing removes: 1 - Var(diff) / (Var(treated) + Var(control)).
 * Near 0: sides vary independently. Near 1: most noise was shared (lighting etc.) and cancelled.
 */
function pairingReduction(days: DayPoint[], sign: number) {
  const pairs = days.filter((d) => d.treated !== undefined && d.control !== undefined);
  if (pairs.length < 4) return null;
  const t = pairs.map((d) => sign * d.treated!);
  const c = pairs.map((d) => sign * d.control!);
  const diff = pairs.map((_, i) => t[i] - c[i]);
  const denom = variance(t) + variance(c);
  return denom > 0 ? Math.max(0, Math.min(1, 1 - variance(diff) / denom)) : null;
}
