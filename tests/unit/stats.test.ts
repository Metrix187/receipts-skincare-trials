import { describe, expect, it } from "vitest";
import { analyzeTrial, bootstrapDiff, decide, headlineFor, type DayPoint } from "@/lib/stats";
import { estimatePhi, quantileSorted } from "@/lib/stats/bootstrap";
import { normalQuantile, tQuantile } from "@/lib/stats/distributions";
import { normal, prng } from "@/lib/rng";

/** AR(1) noise: today's error carries `phi` of yesterday's (sleep, weather, lighting drift). */
function ar1(n: number, phi: number, sd: number, rnd: () => number) {
  const out: number[] = [];
  let e = normal(rnd) * sd;
  for (let i = 0; i < n; i++) {
    e = phi * e + Math.sqrt(1 - phi * phi) * normal(rnd) * sd;
    out.push(e);
  }
  return out;
}

function prePost(opts: { nB: number; nT: number; effect: number; sd: number; phi?: number; seed: number }): DayPoint[] {
  const rnd = prng(opts.seed);
  const noise = ar1(opts.nB + opts.nT, opts.phi ?? 0.3, opts.sd, rnd);
  return noise.map((e, day) => ({
    day,
    phase: day < opts.nB ? "baseline" : "treatment",
    value: 60 + e + (day >= opts.nB ? opts.effect : 0),
  }));
}

describe("bootstrap primitives", () => {
  it("quantile functions match reference tables", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228139, 2);
    expect(tQuantile(0.975, 30)).toBeCloseTo(2.042272, 3);
  });

  it("recovers lag-1 autocorrelation from a long AR(1) series", () => {
    const x = ar1(4000, 0.4, 1, prng(7));
    expect(estimatePhi([x]).phi).toBeCloseTo(0.4, 1);
  });

  it("type-7 quantiles match NumPy", () => {
    const s = [1, 2, 3, 4];
    expect(quantileSorted(s, 0.5)).toBe(2.5);
    expect(quantileSorted(s, 0.25)).toBe(1.75);
  });

  it("a zero-variance difference has a zero-width interval", () => {
    const b = bootstrapDiff([3, 3, 3, 3], [1, 1, 1], { resamples: 500, rnd: prng(2) });
    expect(b).toMatchObject({ estimate: 2, ciLow: 2, ciHigh: 2 });
  });
});

describe("decision rule", () => {
  it("maps intervals to labels using the pre-registered SESOI", () => {
    expect(decide(0.5, 4, 2)).toBe("improved");
    expect(decide(-4, -0.1, 2)).toBe("worsened");
    expect(decide(-1.5, 1.8, 2)).toBe("no_meaningful_change");
    expect(decide(-1, 3, 2)).toBe("inconclusive");
    expect(decide(-2, 1, 2)).toBe("inconclusive"); // boundary touches -SESOI: not equivalence
  });
});

describe("analyzeTrial", () => {
  const common = { design: "pre_post" as const, higherIsBetter: true, sesoi: 3, treatmentStartDay: 7, seed: 42 };

  it("says not_enough_data below the minimums and counts days to go", () => {
    const r = analyzeTrial({ ...common, days: prePost({ nB: 7, nT: 4, effect: 0, sd: 3, seed: 1 }) });
    expect(r.label).toBe("not_enough_data");
    expect(r.effect).toBeNull();
    expect(r.daysRemaining.overall).toBe(3);
  });

  it("detects a clear improvement and brackets the true effect", () => {
    const r = analyzeTrial({ ...common, days: prePost({ nB: 7, nT: 21, effect: 8, sd: 2, seed: 3 }) });
    expect(r.label).toBe("improved");
    expect(r.ciLow!).toBeGreaterThan(0);
    expect(r.ciLow!).toBeLessThan(8);
    expect(r.ciHigh!).toBeGreaterThan(8);
    expect(r.daysRemaining.precision).toBe(0);
  });

  it("establishes no meaningful change when a long, quiet trial shows nothing", () => {
    const days = prePost({ nB: 14, nT: 28, effect: 0, sd: 1.5, phi: 0.2, seed: 5 });
    const r = analyzeTrial({ ...common, treatmentStartDay: 14, days });
    expect(r.label).toBe("no_meaningful_change");
    expect(r.ciLow!).toBeGreaterThan(-3);
    expect(r.ciHigh!).toBeLessThan(3);
  });

  it("is inconclusive on short, noisy data and projects the extra days needed", () => {
    const days = prePost({ nB: 7, nT: 8, effect: 0, sd: 5, seed: 9 });
    const r = analyzeTrial({ ...common, days });
    expect(r.label).toBe("inconclusive");
    expect(r.daysRemaining.precision === null || r.daysRemaining.precision > 0).toBe(true);
  });

  it("projects extra treatment days when the target precision is reachable", () => {
    // Quiet baseline, noisy treatment period: precision is limited by treatment days.
    const rnd = prng(11);
    const days: DayPoint[] = [];
    for (let day = 0; day < 22; day++) {
      const base = day < 14;
      days.push({ day, phase: base ? "baseline" : "treatment", value: 60 + normal(rnd) * (base ? 0.5 : 3) });
    }
    const r = analyzeTrial({ ...common, sesoi: 1.5, treatmentStartDay: 14, days });
    expect(r.label).toBe("inconclusive");
    expect(r.daysRemaining.precision!).toBeGreaterThan(0);
    expect(r.daysRemaining.note).toMatch(/needs about \d+ more treatment day/);
  });

  it("says when more treatment days can never help (baseline too noisy)", () => {
    const days = prePost({ nB: 5, nT: 8, effect: 0, sd: 6, seed: 12 });
    const r = analyzeTrial({ ...common, sesoi: 1, treatmentStartDay: 5, minBaselineDays: 5, days });
    expect(r.label).toBe("inconclusive");
    expect(r.daysRemaining.precision).toBeNull();
    expect(r.daysRemaining.note).toMatch(/baseline is too noisy/i);
  });

  it("orients lower-is-better metrics so positive means improvement", () => {
    const days = prePost({ nB: 7, nT: 14, effect: -6, sd: 1, seed: 13 }); // coverage fell
    const r = analyzeTrial({ ...common, higherIsBetter: false, days });
    expect(r.label).toBe("improved");
    expect(r.effect!).toBeGreaterThan(0);
  });

  it("excludes pre-registered wash-in days", () => {
    const days = prePost({ nB: 7, nT: 14, effect: 0, sd: 1, seed: 17 });
    const r = analyzeTrial({ ...common, washInDays: 5, minTreatmentDays: 5, days });
    expect(r.nExcludedWashIn).toBe(5);
    expect(r.nTreatment).toBe(9);
  });

  it("is deterministic for a given seed (verdicts don't wobble on refresh)", () => {
    const days = prePost({ nB: 7, nT: 14, effect: 1, sd: 3, seed: 19 });
    const a = analyzeTrial({ ...common, days });
    const b = analyzeTrial({ ...common, days });
    expect([a.ciLow, a.ciHigh]).toEqual([b.ciLow, b.ciHigh]);
  });

  it("split-face pairing cancels shared daily noise (lighting) that swamps pre/post", () => {
    const rnd = prng(23);
    const nB = 7;
    const days: DayPoint[] = [];
    for (let day = 0; day < 28; day++) {
      const lighting = normal(rnd) * 6; // big shared swing, hits both sides
      const treated = 12 + lighting + normal(rnd) * 0.8 - (day >= nB ? 2.5 : 0); // coverage falls 2.5 pts
      const control = 12.4 + lighting + normal(rnd) * 0.8;
      days.push({ day, phase: day < nB ? "baseline" : "treatment", treated, control, value: treated });
    }
    const split = analyzeTrial({ design: "split_face", higherIsBetter: false, sesoi: 1.5, treatmentStartDay: nB, seed: 1, days });
    const naive = analyzeTrial({ design: "pre_post", higherIsBetter: false, sesoi: 1.5, treatmentStartDay: nB, seed: 1, days });
    expect(split.label).toBe("improved");
    expect(split.ciHigh! - split.ciLow!).toBeLessThan((naive.ciHigh! - naive.ciLow!) / 3);
    expect(split.pairingNoiseReduction!).toBeGreaterThan(0.8);
  });

  it("reports claim-timeframe days separately from precision days", () => {
    const days = prePost({ nB: 7, nT: 10, effect: 9, sd: 1, seed: 29 });
    const r = analyzeTrial({ ...common, claimDays: 28, days });
    expect(r.label).toBe("improved");
    expect(r.daysRemaining.timeframe).toBe(18);
    expect(r.daysRemaining.overall).toBe(18);
  });

  it("builds a day-by-day trajectory ending at the final estimate", () => {
    const days = prePost({ nB: 7, nT: 21, effect: 2, sd: 2, seed: 31 });
    const r = analyzeTrial({ ...common, days });
    expect(r.trajectory).toHaveLength(21 - 7 + 1);
    expect(r.trajectory.at(-1)!.effect).toBeCloseTo(r.effect!, 10);
    for (const p of r.trajectory) expect(p.lo).toBeLessThanOrEqual(p.hi);
  });
});

describe("calibration (simulation)", () => {
  // The honest test of a CI: on data with a known effect, how often does the 95%
  // interval contain it? (A moving-block bootstrap scored 0.79 here; see bootstrap.ts.)
  it("95% intervals cover the true effect on AR(1) data at least 90% of the time", () => {
    const trials = 300;
    let covered = 0;
    for (let s = 0; s < trials; s++) {
      const days = prePost({ nB: 10, nT: 21, effect: 1.5, sd: 3, phi: 0.3, seed: 1000 + s });
      const r = analyzeTrial({ design: "pre_post", higherIsBetter: true, sesoi: 2, treatmentStartDay: 10, seed: s, days, resamples: 800 });
      if (r.ciLow! <= 1.5 && 1.5 <= r.ciHigh!) covered++;
    }
    const coverage = covered / trials;
    expect(coverage).toBeGreaterThanOrEqual(0.9);
    expect(coverage).toBeLessThanOrEqual(0.99);
  });

  // Hardest realistic case: 7 baseline days, 7 wash-in days (noise model only), 7
  // analyzed days, strong carry-over. Before wash-in days fed the noise model and the
  // phi bias correction used segment length, this sat at 0.88 coverage.
  it("stays calibrated with a wash-in and short phases (>= 0.88 coverage)", () => {
    let covered = 0;
    const trials = 300;
    for (let s = 0; s < trials; s++) {
      const days = prePost({ nB: 7, nT: 14, effect: 0, sd: 2.6, phi: 0.45, seed: 9000 + s });
      const r = analyzeTrial({ design: "pre_post", higherIsBetter: true, sesoi: 3, washInDays: 7, treatmentStartDay: 7, seed: s, days, resamples: 600 });
      if (r.ciLow! <= 0 && 0 <= r.ciHigh!) covered++;
    }
    expect(covered / trials).toBeGreaterThanOrEqual(0.88);
  });

  it("false 'improved' verdicts on a null effect stay rare (<= 10%)", () => {
    let improved = 0;
    const trials = 300;
    for (let s = 0; s < trials; s++) {
      const days = prePost({ nB: 10, nT: 21, effect: 0, sd: 3, phi: 0.3, seed: 5000 + s });
      const r = analyzeTrial({ design: "pre_post", higherIsBetter: true, sesoi: 2, treatmentStartDay: 10, seed: s, days, resamples: 800 });
      if (r.label === "improved") improved++;
    }
    expect(improved / trials).toBeLessThanOrEqual(0.1);
  });
});

describe("headline", () => {
  it("matches the brief's example phrasing for inconclusive results", () => {
    const rnd = prng(37);
    const days: DayPoint[] = Array.from({ length: 18 }, (_, day) => ({
      day,
      phase: day < 7 ? "baseline" : "treatment",
      value: 60 + normal(rnd) * (day < 7 ? 0.4 : 2.5),
    }));
    const r = analyzeTrial({ design: "pre_post", higherIsBetter: true, sesoi: 2.5, treatmentStartDay: 7, seed: 1, days });
    expect(r.label).toBe("inconclusive");
    expect(r.daysRemaining.overall).not.toBeNull();
    const h = headlineFor(r, { metricLabel: "Redness", unit: "pts", design: "pre_post", daysLogged: 18 });
    expect(h).toMatch(/^No detectable change in redness after 18 days; roughly \d+ more days may improve precision/);
  });
});

describe("pre-registered endpoint", () => {
  it("keeps early looks interim and excludes measurements after the planned endpoint", () => {
    const initial = prePost({ nB: 7, nT: 10, effect: 8, sd: 1, seed: 12 });
    const input = { design: "pre_post" as const, higherIsBetter: true, sesoi: 3, treatmentStartDay: 7, plannedTreatmentDays: 14, seed: 1 };
    const early = analyzeTrial({ ...input, days: initial });
    expect(early.interim).toBe(true);
    expect(early.label).toBe("inconclusive");
    expect(headlineFor(early, { metricLabel: "Redness", unit: "pts", design: "pre_post", daysLogged: 17 })).toMatch(/^Interim/);
    const complete = prePost({ nB: 7, nT: 14, effect: 8, sd: 1, seed: 12 });
    const atEnd = analyzeTrial({ ...input, days: complete });
    const withLate = analyzeTrial({ ...input, days: [...complete, { day: 21, phase: "treatment", value: -500 }] });
    expect(atEnd.interim).toBe(false);
    expect(withLate.effect).toBe(atEnd.effect);
    expect(withLate.nTreatment).toBe(14);
    const missedLast = complete.filter((d) => d.day !== 20);
    const afterMissing = analyzeTrial({ ...input, days: [...missedLast, { day: 21, phase: "treatment", value: -500 }] });
    expect(afterMissing.interim).toBe(false);
    expect(afterMissing.nTreatment).toBe(13);
    const tooSparse = analyzeTrial({ ...input, days: [complete[0], complete[1], complete[2], complete[3], complete[4], complete[5], complete[6], complete.at(-1)!] });
    expect(tooSparse.label).toBe("not_enough_data");
    expect(tooSparse.daysRemaining.overall).toBeNull();
    expect(tooSparse.daysRemaining.note).toMatch(/window closed/);
  });
});
