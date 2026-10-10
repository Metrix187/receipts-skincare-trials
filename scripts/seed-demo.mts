// Seeds two demo trials with 21 days of realistic SYNTHETIC data, so the dashboard,
// verdict and receipt are populated for the video. No YouCam units are spent:
// captures are marked mock=true and the UI labels them "DEMO / MOCK DATA".
//
//   npm run seed:demo                 # deterministic mock agents (default)
//   npm run seed:demo -- --live-agents  # real Protocol/Verdict agents if ANTHROPIC_API_KEY is set
//
// A: split-face azelaic serum vs redness: a real effect, ramping in over ~5 days.
// B: oral collagen vs hydration (pre/post): no effect, 21 of 35 planned days logged.

if (!process.argv.includes("--live-agents")) process.env.MOCK_AGENTS = "1";

const { db } = await import("@/lib/db");
const { canonicalHash } = await import("@/lib/crypto");
const { normal, prng } = await import("@/lib/rng");
const { runProtocolAgent } = await import("@/lib/agents/protocol-agent");
const { recordAgentRun } = await import("@/lib/agents/runner");
const { produceVerdict } = await import("@/lib/services");
const { protocolConcerns } = await import("@/lib/protocol");
const { DEMO_OWNER } = await import("@/lib/owner-cookie");

const DAYS = 21;
const DAY_MS = 86_400_000;

function startDate() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  return new Date(d.getTime() - (DAYS - 1) * DAY_MS);
}

/** AR(1) series: tomorrow keeps `phi` of today's deviation (lighting, sleep, weather). */
function ar1(n: number, phi: number, sd: number, rnd: () => number) {
  const out: number[] = [];
  let e = normal(rnd) * sd;
  for (let i = 0; i < n; i++) {
    e = phi * e + Math.sqrt(1 - phi * phi) * normal(rnd) * sd;
    out.push(e);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

async function makeTrial(input: {
  productName: string;
  brand: string | null;
  claimText: string;
  application: "leave_on_topical" | "oral";
  canApplyToHalfFace: "yes" | "no";
  slug: string;
}) {
  const start = startDate();
  const trial = await db.trial.create({
    data: {
      ownerId: DEMO_OWNER,
      isDemo: true,
      shareSlug: input.slug,
      productName: input.productName,
      brand: input.brand,
      claimText: input.claimText,
      startDate: start,
      tier: "sd",
      status: "draft",
    },
  });
  const agentInput = { ...input, startDate: start.toISOString().slice(0, 10), notes: null, tier: "sd" as const };
  const started = Date.now();
  const result = await runProtocolAgent(agentInput);
  await recordAgentRun({ trialId: trial.id, agent: "protocol", input: agentInput, started, result });
  const p = result.output;
  return db.trial.update({
    where: { id: trial.id },
    data: {
      protocol: p,
      design: p.design,
      treatedSide: p.treated_side,
      baselineDays: p.baseline_days,
      treatmentDays: p.treatment_days,
      washInDays: p.wash_in_days,
      concerns: protocolConcerns(p),
      primaryConcern: p.primary_concern,
      primaryMetric: p.primary_metric,
      sesoi: p.sesoi,
      captureTime: p.capture_time,
      claimDays: p.claim_days,
      status: "active",
      lockedAt: new Date(start.getTime() - 3_600_000),
      protocolHash: canonicalHash({ protocol: p, trialId: trial.id, startDate: start.toISOString() }),
    },
  });
}

type Trial = Awaited<ReturnType<typeof makeTrial>>;

async function addDay(trial: Trial, day: number, m: { concern: string; metric: string; side: string; value: number }[], quality: Record<string, unknown>, overall: number) {
  const capturedAt = new Date(trial.startDate.getTime() + day * DAY_MS - 4 * 3_600_000 + Number(quality.minutesFromTarget) * 60_000);
  const c = await db.capture.create({
    data: {
      trialId: trial.id,
      dayIndex: day,
      phase: day < (trial.baselineDays ?? 0) ? "baseline" : "treatment",
      capturedAt,
      status: "success",
      counts: true,
      quality: quality as object,
      face: { box: { x: 0.17, y: 0.12, w: 0.66, h: 0.8 }, midlineX: 0.5, rollDeg: 0 },
      overall,
      skinAge: 29,
      units: 9,
      mock: true,
    },
  });
  await db.measurement.createMany({ data: m.map((x) => ({ ...x, region: "whole", trialId: trial.id, captureId: c.id })) });
  await db.unitLedger.create({ data: { feature: "skin-analysis", tier: "sd", concernCount: (trial.concerns as string[]).length, units: 9, status: "charged", mock: true, trialId: trial.id, captureId: c.id, note: "demo seed" } });
}

async function seedSplitFace() {
  const trial = await makeTrial({
    productName: "Azelaic Acid 10% Serum",
    brand: "Demo product",
    claimText: "Visibly calmer, less red skin in 2 weeks",
    application: "leave_on_topical",
    canApplyToHalfFace: "yes",
    slug: "demo-azelaic",
  });
  if (trial.design !== "split_face") throw new Error(`expected split_face, agent chose ${trial.design}`);
  const rnd = prng(20261102);
  const lighting = ar1(DAYS, 0.5, 2.2, rnd); // shared by both sides: cancels in the paired difference
  const baselineDays = trial.baselineDays ?? 7;
  for (let day = 0; day < DAYS; day++) {
    const t = day - baselineDays;
    const effect = t >= 0 ? -3.0 * (1 - Math.exp(-(t + 1) / 5)) : 0; // % of cheek flagged, treated side only
    const treated = clamp(14.2 + lighting[day] + normal(rnd) * 0.75 + effect, 2, 40);
    const control = clamp(14.9 + lighting[day] + normal(rnd) * 0.75, 2, 40);
    const [left, right] = trial.treatedSide === "left" ? [treated, control] : [control, treated];
    const whole = (left + right) / 2;
    const rednessUi = Math.round(clamp(78 - whole * 1.1 + normal(rnd) * 1.5, 1, 100));
    const textureUi = Math.round(clamp(69 + normal(rnd) * 2.5, 1, 100));
    const radianceUi = Math.round(clamp(64 - lighting[day] * 0.8 + normal(rnd) * 2, 1, 100));
    const luminance = r2(0.54 + lighting[day] * -0.01 + normal(rnd) * 0.01);
    await addDay(
      trial,
      day,
      [
        { concern: "redness", metric: "mask_coverage", side: "left", value: r2(left) },
        { concern: "redness", metric: "mask_coverage", side: "right", value: r2(right) },
        { concern: "redness", metric: "mask_coverage", side: "whole", value: r2(whole) },
        { concern: "redness", metric: "ui_score", side: "whole", value: rednessUi },
        { concern: "texture", metric: "ui_score", side: "whole", value: textureUi },
        { concern: "radiance", metric: "ui_score", side: "whole", value: radianceUi },
      ],
      { luminance, leftRightLumaGap: r2(Math.abs(normal(rnd)) * 0.04), sharpness: 0.6, rollDeg: r2(normal(rnd) * 2), yaw: r2(normal(rnd) * 0.04), minutesFromTarget: Math.round(normal(rnd) * 25), detector: "demo-seed" },
      Math.round((rednessUi + textureUi + radianceUi) / 3),
    );
  }
  return trial;
}

async function seedPrePost() {
  const trial = await makeTrial({
    productName: "Marine Collagen Powder",
    brand: "Demo product",
    claimText: "Improves skin hydration in 4 weeks",
    application: "oral",
    canApplyToHalfFace: "no",
    slug: "demo-collagen",
  });
  if (trial.design !== "pre_post") throw new Error(`expected pre_post, agent chose ${trial.design}`);
  // No true effect. Note on the seed: an earlier seed (424242) happened to draw a slow
  // +7-point upward drift, a ~1-in-500 realization that any pre/post analysis reads
  // as "improved". That's exactly why split-face is the preferred design. For a demo
  // of a null product we use a typical draw.
  const rnd = prng(7);
  const drift = ar1(DAYS, 0.45, 2.6, rnd);
  for (let day = 0; day < DAYS; day++) {
    const moisture = Math.round(clamp(58 + drift[day] + normal(rnd) * 1.2, 1, 100));
    const texture = Math.round(clamp(70 + drift[day] * 0.3 + normal(rnd) * 2, 1, 100));
    const radiance = Math.round(clamp(63 + normal(rnd) * 2.2, 1, 100));
    await addDay(
      trial,
      day,
      [
        { concern: "moisture", metric: "ui_score", side: "whole", value: moisture },
        { concern: "texture", metric: "ui_score", side: "whole", value: texture },
        { concern: "radiance", metric: "ui_score", side: "whole", value: radiance },
      ],
      { luminance: r2(0.52 + normal(rnd) * 0.015), leftRightLumaGap: 0.03, sharpness: 0.55, rollDeg: 0, yaw: 0, minutesFromTarget: Math.round(normal(rnd) * 30), detector: "demo-seed" },
      Math.round((moisture + texture + radiance) / 3),
    );
  }
  return trial;
}

const old = await db.trial.findMany({ where: { isDemo: true }, select: { id: true } });
await db.trial.deleteMany({ where: { isDemo: true } });
await db.unitLedger.deleteMany({ where: { trialId: { in: old.map((t) => t.id) } } });

for (const seed of [seedSplitFace, seedPrePost]) {
  const trial = await seed();
  const v = await produceVerdict(trial.id);
  console.log(`✓ ${trial.productName}: ${trial.design}, ${trial.baselineDays}+${trial.treatmentDays} days planned, treated=${trial.treatedSide ?? "-"}`);
  console.log(`  ${v.label}: ${v.headline}`);
  console.log(`  receipt: /r/${trial.shareSlug}   dashboard: /trials/${trial.id}`);
}
await db.$disconnect();
