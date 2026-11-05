import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { canonicalHash } from "@/lib/crypto";
import { deleteTrialPhotos } from "@/lib/photos";
import { PRODUCT_APPLICATION, protocolConcerns, type Protocol } from "@/lib/protocol";
import { loadTrialBundle } from "@/lib/trial-data";
import { recordAgentRun } from "@/lib/agents/runner";
import { runProtocolAgent, type ProtocolAgentInput } from "@/lib/agents/protocol-agent";
import { deterministicVerdict, runVerdictAgent, type VerdictOutput } from "@/lib/agents/verdict-agent";
import { HttpError, requireOwnedTrial } from "@/lib/owner";
import type { Tier } from "@/lib/youcam/concerns";

/** A real calendar date in YYYY-MM-DD form ("2026-13-45" matches the regex but is not a date). */
export const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Not a calendar date");

export const NewTrialSchema = z.object({
  productName: z.string().trim().min(2).max(80),
  // nullish: the stored agent input (re-parsed by the protocol route) carries the nulls this transform produced
  brand: z.string().trim().max(60).nullish().transform((v) => v || null),
  claimText: z.string().trim().min(5).max(240),
  application: z.enum(PRODUCT_APPLICATION),
  canApplyToHalfFace: z.enum(["yes", "no", "unsure"]),
  startDate: CalendarDate,
  notes: z.string().trim().max(400).nullish().transform((v) => v || null),
});

export type NewTrial = z.infer<typeof NewTrialSchema>;

/** Creates a draft trial and has the Protocol Agent design it. */
export async function createTrial(ownerId: string, input: NewTrial) {
  const trial = await db.trial.create({
    data: {
      ownerId,
      shareSlug: randomBytes(6).toString("base64url"),
      productName: input.productName,
      brand: input.brand,
      claimText: input.claimText,
      startDate: new Date(`${input.startDate}T12:00:00Z`),
      tier: env().YOUCAM_TIER,
      status: "draft",
    },
  });
  await designProtocol(trial.id, input);
  return trial;
}

/** (Re)runs the Protocol Agent on a draft trial and stores the proposed protocol. */
export async function designProtocol(trialId: string, input: NewTrial) {
  const trial = await db.trial.findUniqueOrThrow({ where: { id: trialId } });
  if (trial.lockedAt) throw new HttpError(409, "Protocol is locked.");
  const agentInput: ProtocolAgentInput = { ...input, tier: trial.tier as Tier };
  const started = Date.now();
  try {
    const result = await runProtocolAgent(agentInput);
    await recordAgentRun({ trialId, agent: "protocol", input: agentInput, started, result });
    await applyProtocol(trialId, result.output);
    return result.output;
  } catch (error) {
    await recordAgentRun({ trialId, agent: "protocol", input: agentInput, started, error });
    throw new HttpError(502, `Protocol Agent failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function applyProtocol(trialId: string, p: Protocol) {
  // Guarded: a redesign that was in flight when the user locked the protocol must not
  // replace the protocol the hash on the receipt was computed from.
  const { count } = await db.trial.updateMany({
    where: { id: trialId, lockedAt: null },
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
    },
  });
  if (count === 0) throw new HttpError(409, "Protocol was locked while the redesign ran; the locked protocol stands.");
}

/** Pre-registration: freeze the protocol and record its hash. */
export async function lockTrial(trialId: string) {
  const trial = await requireOwnedTrial(trialId);
  if (trial.lockedAt) return trial;
  if (!trial.protocol) throw new HttpError(400, "No protocol to lock.");
  return db.trial.update({
    where: { id: trialId },
    data: {
      lockedAt: new Date(),
      status: "active",
      protocolHash: canonicalHash({ protocol: trial.protocol, trialId: trial.id, startDate: trial.startDate.toISOString() }),
    },
  });
}

/** Runs the Verdict Agent. If the agent fails, the deterministic verdict is stored and the run is flagged. */
export async function produceVerdict(trialId: string) {
  const bundle = await loadTrialBundle(trialId);
  if (!bundle?.analysis) throw new HttpError(400, "Lock a protocol first.");
  const started = Date.now();
  let output: VerdictOutput;
  let runId: string;
  try {
    const result = await runVerdictAgent(bundle);
    output = result.output;
    runId = (await recordAgentRun({ trialId, agent: "verdict", input: { trialId, daysLogged: bundle.daysLogged }, started, result })).id;
  } catch (error) {
    output = deterministicVerdict(bundle);
    runId = (
      await recordAgentRun({ trialId, agent: "verdict", input: { trialId, daysLogged: bundle.daysLogged }, started, error, status: "overridden" })
    ).id;
  }
  const r = bundle.analysis;
  const { trajectory, ...stats } = r;
  return db.verdict.create({
    data: {
      trialId,
      agentRunId: runId,
      label: r.label, // always the computed label
      metric: `${bundle.trial.primaryConcern}/${bundle.trial.primaryMetric}`,
      effect: r.effect,
      ciLow: r.ciLow,
      ciHigh: r.ciHigh,
      nBaseline: r.nBaseline,
      nTreatment: r.nTreatment,
      daysRemaining: r.daysRemaining.overall,
      // Display the deterministic numeric headline. Agent phrasing is retained
      // in its logged output; simple text checks cannot verify every number it emits.
      headline: bundle.headline!,
      explanation: output.explanation,
      stats: { ...stats, trajectory, caveats: output.caveats, nextStep: output.next_step } as object,
    },
  });
}

export async function wipePhotos(trialId: string) {
  await requireOwnedTrial(trialId);
  return deleteTrialPhotos(trialId);
}

export async function deleteTrial(trialId: string) {
  await requireOwnedTrial(trialId);
  await db.trial.delete({ where: { id: trialId } });
}
