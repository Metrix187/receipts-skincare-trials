import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { prismaLedger } from "@/lib/youcam/ledger-prisma";
import { CONCERNS, concern, type ConcernKey, type Tier } from "@/lib/youcam/concerns";
import { projectTrialUnits } from "@/lib/youcam/costs";
import { ProtocolSchema, protocolConcerns, protocolIssues, type Protocol, type ProductApplication } from "@/lib/protocol";
import { runLiveAgent, strictObject, ToolInputError, type AgentRunResult, type AgentTool, type TranscriptEntry } from "./runner";

export interface ProtocolAgentInput {
  productName: string;
  brand: string | null;
  claimText: string;
  application: ProductApplication;
  canApplyToHalfFace: "yes" | "no" | "unsure";
  startDate: string;
  notes: string | null;
  tier: Tier;
}

const SYSTEM = `You are the Protocol Agent in Receipts, an app that runs honest n=1 trials of skincare products using YouCam AI Skin Analysis on daily selfies.

Your job: design ONE pre-registered trial protocol for the user's product and claim, then call submit_protocol. The protocol is locked before any data exists, so nobody (including you) can move the goalposts later.

How to work:
1. Call list_skin_metrics to see what YouCam can measure.
2. Decide the design:
   - split_face: product on one randomly assigned side of the face only, other side is the control. The same photo may reduce shared noise, but lighting and other biases need not cancel. This experimental proxy is not clinically validated. Only possible for topical products the user can apply to half the face, and only for concerns whose masks are comparable cheek-to-cheek (splitFaceOk). If you choose it, call assign_treated_side and use exactly the side it returns. Never pick the side yourself.
   - pre_post: a baseline period without the product, then a treatment period. Use it for oral products, devices, wash-off products the user can't confine to one side, eye-area concerns, or when the user said they can't do half-face.
3. Pick the primary concern that most directly matches the claim. One primary concern only: that is the only one the verdict will test. Up to 3 secondary concerns are shown descriptively, never tested. Keep total concerns at 4 or fewer (the cheapest YouCam unit tier). Call estimate_trial_cost to confirm the unit budget.
4. Metric: split_face must use mask_coverage (mean detection-mask intensity in approximate cheek patches; lower is treated as better). This proxy is experimental and not clinically validated. pre_post must use ui_score (YouCam's 1-100 score, higher is better).
5. SESOI (smallest effect size of interest): propose a threshold in the metric's units. It is a provisional assumption, not a clinically validated threshold or an established measure of day-to-day noise; explain that limitation.
6. Durations: baseline >= 3 days for split_face, >= 5 for pre_post. treatment_days should cover the claim's stated timeframe (claim_days) when it is reasonable (cap 56). Use wash_in_days only if the claim implies a delayed effect, and explain it. Analyzable treatment days (treatment - wash-in) must be >= 7.
7. If the claim cannot be measured from a selfie (e.g. "boosts collagen", "repairs the barrier", "SPF 50"), set claim_testable=false, pick the closest visible proxy, and say plainly in caveats that the trial only tests the visible proxy.
8. Call check_protocol on your draft, fix every issue, then call submit_protocol.

Write rationales and plain_summary for a non-expert, in plain language, without hype. Never promise the trial will detect an effect. Be explicit about uncertainty and about this not being medical advice.`;

const PROTOCOL_JSON_SCHEMA = strictObject({
  design: { type: "string", enum: ["split_face", "pre_post"] },
  design_rationale: { type: "string", description: "Why this design, in plain language (2-3 sentences)." },
  treated_side: { anyOf: [{ type: "string", enum: ["left", "right"] }, { type: "null" }], description: "Exactly the side assign_treated_side returned (split_face), else null." },
  primary_concern: { type: "string", enum: CONCERNS.filter((c) => c.scored).map((c) => c.key) },
  primary_metric: { type: "string", enum: ["mask_coverage", "ui_score"] },
  secondary_concerns: { type: "array", items: { type: "string", enum: CONCERNS.filter((c) => c.scored).map((c) => c.key) }, description: "0-3 concerns, descriptive only." },
  metric_rationale: { type: "string", description: "Why this concern and metric match the claim." },
  baseline_days: { type: "integer", description: "3-14" },
  treatment_days: { type: "integer", description: "7-56" },
  wash_in_days: { type: "integer", description: "0-14; early treatment days excluded from the estimate." },
  sesoi: { type: "number", description: "Smallest effect size of interest, in metric units." },
  sesoi_rationale: { type: "string" },
  capture_time: { type: "string", description: "Daily capture time, 24h HH:MM." },
  capture_instructions: { type: "array", items: { type: "string" }, description: "2-6 short instructions for consistent selfies." },
  claim_days: { anyOf: [{ type: "integer" }, { type: "null" }], description: "Timeframe stated in the claim, in days, or null." },
  claim_testable: { type: "boolean" },
  caveats: { type: "array", items: { type: "string" }, description: "0-6 honest limitations." },
  plain_summary: { type: "string", description: "2-3 sentences the user will read first." },
});

function tools(input: ProtocolAgentInput, state: { side: "left" | "right" | null }): AgentTool[] {
  return [
    {
      name: "list_skin_metrics",
      description: "List the skin concerns YouCam AI Skin Analysis can score, what each measures, and whether it supports split-face comparison.",
      input_schema: strictObject({}),
      run: async () => ({
        concerns: CONCERNS.filter((c) => c.scored).map(({ key, label, measures, splitFaceOk }) => ({ key, label, measures, splitFaceOk })),
        metrics: {
          ui_score: "YouCam's 1-100 whole-face score for the concern; higher is better. Used for pre_post.",
          mask_coverage: "Experimental mean mask intensity in approximate cheek patches; lower is treated as better. Not a validated measure of area or clinical improvement.",
        },
      }),
    },
    {
      name: "estimate_trial_cost",
      description: "Estimate YouCam API units for the trial: one analysis per day, all concerns in one call.",
      input_schema: strictObject({
        concerns: { type: "array", items: { type: "string" }, description: "All concern keys to request (primary + secondary)." },
        days: { type: "integer", description: "baseline_days + treatment_days" },
      }),
      run: async (raw) => {
        const args = z.object({ concerns: z.array(z.string()).min(1).max(16), days: z.number().int().min(1).max(120) }).safeParse(raw);
        if (!args.success) throw new ToolInputError(args.error.issues.map((i) => i.message).join("; "));
        const p = projectTrialUnits({ tier: input.tier, concernCount: new Set(args.data.concerns).size, days: args.data.days });
        const budget = env().YOUCAM_UNIT_BUDGET;
        const committed = await prismaLedger.liveUnitsCommitted();
        return {
          tier: input.tier,
          ...p,
          note: p.unitsPerCall > 9 && input.tier === "sd" ? "More than 4 concerns moves to a pricier tier; consider dropping secondaries." : "Cheapest tier.",
          budget: { unitBudget: budget, liveUnitsAlreadyCommitted: committed, remainingAfterTrial: budget - committed - p.totalUnits },
        };
      },
    },
    {
      name: "assign_treated_side",
      description: "Randomly assign which side of the face gets the product (split_face only). Call once; the result is final.",
      input_schema: strictObject({}),
      run: async () => {
        state.side ??= randomInt(2) === 0 ? "left" : "right";
        return { treated_side: state.side, method: "server-side crypto.randomInt; side is the subject's anatomical side" };
      },
    },
    {
      name: "check_protocol",
      description: "Validate a draft protocol against the design rules without submitting it.",
      input_schema: PROTOCOL_JSON_SCHEMA,
      run: async (raw) => ({ issues: validate(raw, input, state).issues }),
    },
    {
      name: "submit_protocol",
      description: "Submit the final protocol. Fails with the list of issues if any rule is violated; fix them and resubmit.",
      input_schema: PROTOCOL_JSON_SCHEMA,
      terminal: true,
      run: async (raw) => {
        const { issues, protocol } = validate(raw, input, state);
        if (issues.length || !protocol) throw new ToolInputError(`Protocol rejected: ${issues.join(" ")}`);
        return protocol;
      },
    },
  ];
}

function validate(raw: unknown, input: ProtocolAgentInput, state: { side: "left" | "right" | null }) {
  const parsed = ProtocolSchema.safeParse(raw);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
  if (parsed.success) {
    issues.push(...protocolIssues(parsed.data, input.application).filter((x) => !issues.includes(x)));
    if (parsed.data.design === "split_face") {
      if (input.canApplyToHalfFace === "no") issues.push("The user said they can't apply the product to half the face; use pre_post.");
      if (!state.side) issues.push("Call assign_treated_side before submitting a split_face protocol.");
      else if (parsed.data.treated_side !== state.side) issues.push(`treated_side must be ${state.side} (randomly assigned).`);
    }
  }
  return { issues, protocol: parsed.success && issues.length === 0 ? parsed.data : null };
}

function promptFor(input: ProtocolAgentInput) {
  return `Design the trial protocol for this product.

${JSON.stringify(
    {
      product: input.productName,
      brand: input.brand,
      claim: input.claimText,
      how_it_is_used: input.application.replace(/_/g, " "),
      user_can_apply_to_half_face: input.canApplyToHalfFace,
      start_date: input.startDate,
      user_notes: input.notes,
      youcam_tier: input.tier,
    },
    null,
    2,
  )}

Finish by calling submit_protocol.`;
}

export async function runProtocolAgent(input: ProtocolAgentInput): Promise<AgentRunResult<Protocol>> {
  const state = { side: null as "left" | "right" | null };
  if (env().agentsMock) return mockProtocolAgent(input, state);
  return runLiveAgent<Protocol>({ system: SYSTEM, prompt: promptFor(input), tools: tools(input, state) });
}

// ---- Deterministic mock (no ANTHROPIC_API_KEY): same tools, rule-based choices ----

const KEYWORDS: [RegExp, ConcernKey][] = [
  [/red|rosacea|calm|sooth|irritat/i, "redness"],
  [/acne|breakout|blemish|pimple|spot treatment/i, "acne"],
  [/pore/i, "pore"],
  [/wrinkle|fine line|anti-?ag|retino/i, "wrinkle"],
  [/dark spot|pigment|melasma|even (skin )?tone|discolou?r/i, "age_spot"],
  [/oil|shine|sebum|matt/i, "oiliness"],
  [/hydrat|moistur|dry|plump/i, "moisture"],
  [/radian|glow|dull|bright/i, "radiance"],
  [/firm|lift|sag|elastic|collagen/i, "firmness"],
  [/dark circle|under-?eye/i, "dark_circle"],
  [/puff|eye bag/i, "eye_bag"],
  [/textur|smooth|rough|exfoli/i, "texture"],
];
const RELATED: Partial<Record<ConcernKey, ConcernKey[]>> = {
  redness: ["texture", "radiance"],
  acne: ["redness", "pore"],
  pore: ["oiliness", "texture"],
  wrinkle: ["texture", "firmness"],
  age_spot: ["radiance", "texture"],
  oiliness: ["pore", "acne"],
  moisture: ["texture", "radiance"],
  radiance: ["texture", "age_spot"],
  firmness: ["wrinkle"],
  texture: ["pore", "radiance"],
};
const UNMEASURABLE = /collagen|barrier|microbiome|spf|uv|cellular|dna|detox|ph\b/i;

export function parseClaimDays(claim: string): number | null {
  const m = claim.match(/(\d+)\s*(day|week|wk|month)s?/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit.startsWith("month") ? n * 30 : unit.startsWith("w") ? n * 7 : n;
}

async function mockProtocolAgent(input: ProtocolAgentInput, state: { side: "left" | "right" | null }): Promise<AgentRunResult<Protocol>> {
  const transcript: TranscriptEntry[] = [
    { kind: "user", text: promptFor(input) },
    { kind: "note", text: "Mock agent (no ANTHROPIC_API_KEY): deterministic rules, same tools and validation as the live agent." },
  ];
  const t = tools(input, state);
  const call = async (name: string, args: unknown) => {
    const id = `mock_${name}_${transcript.length}`;
    transcript.push({ kind: "tool_call", id, name, input: args });
    try {
      const out = await t.find((x) => x.name === name)!.run(args);
      transcript.push({ kind: "tool_result", id, name, output: out, isError: false });
      return out;
    } catch (err) {
      transcript.push({ kind: "tool_result", id, name, output: { error: String((err as Error).message) }, isError: true });
      throw err;
    }
  };

  await call("list_skin_metrics", {});
  const primary = KEYWORDS.find(([re]) => re.test(input.claimText))?.[1] ?? "texture";
  const claimDays = parseClaimDays(input.claimText);
  const topical = input.application === "leave_on_topical" || input.application === "wash_off_topical";
  const split = topical && input.canApplyToHalfFace !== "no" && concern(primary).splitFaceOk;
  const testable = !UNMEASURABLE.test(input.claimText);
  transcript.push({
    kind: "text",
    text: `The claim mentions ${concern(primary).label.toLowerCase()}, so that is the primary concern. ${
      split ? "It's a topical product that can go on one side, so split-face is possible." : "Split-face isn't possible here, so I'll use a baseline period followed by treatment."
    }`,
  });

  const secondary = (RELATED[primary] ?? []).filter((c) => c !== primary).slice(0, 2);
  // A longer baseline pins down normal day-to-day variation; it caps how precise the verdict can ever get.
  const baseline = 7;
  const treatment = Math.min(56, Math.max(14, claimDays ?? 28));
  await call("estimate_trial_cost", { concerns: [primary, ...secondary], days: baseline + treatment });
  if (split) await call("assign_treated_side", {});

  const metric = split ? "mask_coverage" : "ui_score";
  const draft: Protocol = {
    design: split ? "split_face" : "pre_post",
    design_rationale: split
      ? `You'll apply ${input.productName} to your ${state.side} side only and leave the other side as a built-in control. A shared photo can reduce some lighting and daily variation, but cannot eliminate bias.`
      : `${input.productName} affects your whole face, so there's no untreated side to compare against. We record ${baseline} baseline days without it, then compare the treatment period to that baseline.`,
    treated_side: split ? state.side : null,
    primary_concern: primary,
    primary_metric: metric,
    secondary_concerns: secondary,
    metric_rationale: split
      ? `The claim is about ${concern(primary).label.toLowerCase()}. We compare average YouCam mask intensity in approximate cheek patches. This is an experimental proxy, not a validated area measurement.`
      : `The claim is about ${concern(primary).label.toLowerCase()}, so we track YouCam's ${concern(primary).label.toLowerCase()} score (1-100, higher is better).`,
    baseline_days: baseline,
    treatment_days: treatment,
    wash_in_days: claimDays && claimDays >= 28 ? 7 : 0,
    sesoi: split ? 2 : 3,
    sesoi_rationale: split
      ? "A 2-point change is a provisional threshold in mask intensity, not a clinically validated or guaranteed visible difference."
      : "Three points is a provisional threshold on YouCam's 1–100 scale; its practical importance is not validated.",
    capture_time: "08:00",
    capture_instructions: [
      "Same time every morning, before applying anything.",
      "Face a window or the same lamp; no overhead-only light.",
      "Hair back, no makeup, neutral expression, look straight at the camera.",
      ...(split ? [`Apply the product to your ${state.side} side only, every day after the baseline days.`] : []),
    ],
    claim_days: claimDays,
    claim_testable: testable,
    caveats: [
      "AI skin scores are noisy; one good or bad day means little.",
      "This tests the product on you, not on people in general.",
      ...(testable ? [] : ["The claim describes something a selfie can't see; this trial only tests the closest visible proxy."]),
      "Not medical advice.",
    ],
    plain_summary: `${baseline} baseline days, then ${treatment} days of treatment. Primary question: does ${concern(primary).label.toLowerCase()} change by at least ${split ? "2 mask-intensity points" : "3 score points"}? Until the numbers can honestly support an answer, the verdict will say "not enough data".`,
  };

  const check = (await call("check_protocol", draft)) as { issues: string[] };
  if (check.issues.length) transcript.push({ kind: "note", text: `Mock draft had issues: ${check.issues.join(" ")}` });
  const output = (await call("submit_protocol", draft)) as Protocol;
  return { output, transcript, usage: { input: 0, output: 0 }, turns: 1, model: "mock-deterministic", mock: true };
}

export { protocolConcerns };
