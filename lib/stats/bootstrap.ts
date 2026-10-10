// Bootstrap confidence interval for (mean of treatment days) - (mean of baseline days)
// in a short, autocorrelated daily series.
//
// METHOD: AR(1)-sieve bootstrap (Bühlmann 1997) + Student-t interval.
//   1. Remove each phase's mean. What's left is day-to-day noise r_t.
//   2. Estimate how much of yesterday's noise carries into today (lag-1
//      autocorrelation phi), pooled across both phases, with the Marriott-Pope
//      small-sample bias correction phi + (1 + 3 phi) / n. Clamp to [0, 0.9].
//   3. Innovations e_t = r_t - phi * r_(t-1) are roughly independent, so resample them
//      i.i.d. and rebuild synthetic noise with the same autocorrelation:
//      r*_t = phi * r*_(t-1) + e*_t.
//   4. Each resample gives effect* = (mean_T + mean(r*_T)) - (mean_B + mean(r*_B)).
//      SE = SD(effect*), and the interval is effect +/- t(0.975, n - 3) * SE
//      (3 df spent on two means and phi).
//
// WHY NOT A PLAIN OR MOVING-BLOCK BOOTSTRAP: daily skin readings drift (sleep,
// weather, lighting), so days aren't independent. We simulated 600 trials per setting
// (5-10 baseline days, 10-21 treatment days, autocorrelation 0-0.5). Nominal 95%
// percentile moving-block intervals covered the truth only 65-89% of the time,
// because too few blocks fit in 7-21 days. This sieve interval covered 90-97%.
// tests/unit/stats.test.ts re-runs a smaller version of that check.

import { tQuantile } from "./distributions";

export function mean(xs: readonly number[]) {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : NaN;
}

export function variance(xs: ArrayLike<number>) {
  const n = xs.length;
  if (n < 2) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) m += xs[i];
  m /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2;
  return s / (n - 1);
}

/** Linear-interpolated quantile of a sorted array (type 7, the R/NumPy default). */
export function quantileSorted(sorted: readonly number[], q: number) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Pooled lag-1 autocorrelation of phase-demeaned residuals, bias-corrected and
 * clamped to [0, 0.9]. Negative estimates are clamped to 0, which can only widen intervals.
 */
export function estimatePhi(segments: readonly (readonly number[])[]) {
  let num = 0;
  let den = 0;
  let n = 0;
  let k = 0;
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const m = mean(seg);
    for (let t = 1; t < seg.length; t++) {
      num += (seg[t] - m) * (seg[t - 1] - m);
      den += (seg[t - 1] - m) ** 2;
    }
    n += seg.length;
    k++;
  }
  const raw = den > 0 ? num / den : 0;
  // Demeaning each segment biases phi down by ~(1 + 3 phi) / (segment length), so the
  // correction uses the mean segment length, not the total day count.
  const segLen = k > 0 ? n / k : 0;
  const corrected = segLen > 0 ? raw + (1 + 3 * raw) / segLen : raw;
  return { raw, phi: Math.max(0, Math.min(0.9, corrected)) };
}

export interface DiffBootstrap {
  estimate: number;
  ciLow: number;
  ciHigh: number;
  se: number;
  df: number;
  phi: number;
  phiRaw: number;
  /** Bootstrap variance of each phase mean (used to project precision forward). */
  varTreatmentMean: number;
  varBaselineMean: number;
}

export function bootstrapDiff(
  treatment: readonly number[],
  baseline: readonly number[],
  opts: {
    resamples: number;
    rnd: () => number;
    level?: number;
    /**
     * Extra contiguous segments used ONLY to estimate the noise model (phi and the
     * innovations), e.g. wash-in days. They are real measurements of the same
     * day-to-day noise even though they're excluded from the effect estimate.
     */
    noiseOnly?: readonly (readonly number[])[];
  },
): DiffBootstrap {
  const level = opts.level ?? 0.95;
  const segs = baseline.length ? [treatment, baseline] : [treatment];
  const noiseSegs = [...segs, ...(opts.noiseOnly ?? []).filter((s) => s.length >= 2)];
  const { phi, raw } = estimatePhi(noiseSegs);

  // Innovations, centered and inflated for the 3 estimated parameters.
  const innov: number[] = [];
  for (const seg of noiseSegs) {
    const m = mean(seg);
    for (let t = 1; t < seg.length; t++) innov.push(seg[t] - m - phi * (seg[t - 1] - m));
  }
  const im = innov.length ? mean(innov) : 0;
  const inflate = Math.sqrt(innov.length / Math.max(1, innov.length - 3));
  const e = innov.map((v) => (v - im) * inflate);
  const stationarySd = 1 / Math.sqrt(1 - phi * phi);

  const draw = () => (e.length ? e[Math.floor(opts.rnd() * e.length)] : 0);
  const noiseMean = (n: number) => {
    let r = draw() * stationarySd;
    let s = r;
    for (let t = 1; t < n; t++) {
      r = phi * r + draw();
      s += r;
    }
    return s / n;
  };

  const mT = mean(treatment);
  const mB = baseline.length ? mean(baseline) : 0;
  const estimate = mT - mB;
  const tMeans = new Float64Array(opts.resamples);
  const bMeans = new Float64Array(opts.resamples);
  const effs = new Float64Array(opts.resamples);
  for (let i = 0; i < opts.resamples; i++) {
    tMeans[i] = mT + noiseMean(treatment.length);
    bMeans[i] = baseline.length ? mB + noiseMean(baseline.length) : 0;
    effs[i] = tMeans[i] - bMeans[i];
  }

  const se = Math.sqrt(variance(effs));
  const df = Math.max(2, treatment.length + baseline.length - 3);
  const t = tQuantile(1 - (1 - level) / 2, df);
  return {
    estimate,
    ciLow: estimate - t * se,
    ciHigh: estimate + t * se,
    se,
    df,
    phi,
    phiRaw: raw,
    varTreatmentMean: variance(tMeans),
    varBaselineMean: baseline.length ? variance(bMeans) : 0,
  };
}
