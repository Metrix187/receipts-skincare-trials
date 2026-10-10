import type { Tier } from "./concerns";

// Units charged per SUCCESSFUL skin-analysis task. Verified 2026-10-10 against the
// live GET /s2s/v2.0/credit/feature-cost endpoint (SKUs "AI Skin Analysis V2.1 SD/HD").
// Tasks that end in `error` and all polling are free.
const TIERS: Record<Tier, { maxConcerns: number; units: number }[]> = {
  sd: [
    { maxConcerns: 4, units: 9 },
    { maxConcerns: 8, units: 12 },
    { maxConcerns: 12, units: 14 },
    { maxConcerns: 16, units: 16 },
  ],
  hd: [
    { maxConcerns: 4, units: 12 },
    { maxConcerns: 8, units: 16 },
    { maxConcerns: 12, units: 20 },
    { maxConcerns: 16, units: 22 },
  ],
};

export function unitsPerAnalysis(tier: Tier, concernCount: number): number {
  if (concernCount < 1 || concernCount > 16) {
    throw new RangeError(`concernCount must be 1-16, got ${concernCount}`);
  }
  return TIERS[tier].find((t) => concernCount <= t.maxConcerns)!.units;
}

/** Projected units for a whole trial: one analysis per day, plus a retake allowance. */
export function projectTrialUnits(opts: {
  tier: Tier;
  concernCount: number;
  days: number;
  callsPerDay?: number;
  /** Fraction of days expected to need a second successful call (default 0). */
  retakeRate?: number;
}) {
  const per = unitsPerAnalysis(opts.tier, opts.concernCount);
  const calls = Math.ceil(opts.days * (opts.callsPerDay ?? 1) * (1 + (opts.retakeRate ?? 0)));
  return { unitsPerCall: per, calls, totalUnits: calls * per };
}

export const MIN_SHORT_SIDE: Record<Tier, number> = { sd: 480, hd: 1080 };
export const MAX_LONG_SIDE = 2560;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
