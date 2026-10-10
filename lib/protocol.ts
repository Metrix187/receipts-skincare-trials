import { z } from "zod";
import { CONCERNS, concern, type ConcernKey } from "@/lib/youcam/concerns";

const concernKeys = CONCERNS.filter((c) => c.scored).map((c) => c.key) as [ConcernKey, ...ConcernKey[]];

export const PRODUCT_APPLICATION = ["leave_on_topical", "wash_off_topical", "oral", "device_or_procedure", "other"] as const;
export type ProductApplication = (typeof PRODUCT_APPLICATION)[number];

/** What the Protocol Agent must submit. Mirrored as the submit_protocol tool's JSON schema. */
export const ProtocolSchema = z
  .object({
    design: z.enum(["split_face", "pre_post"]),
    design_rationale: z.string().min(20),
    treated_side: z.enum(["left", "right"]).nullable(),
    primary_concern: z.enum(concernKeys),
    primary_metric: z.enum(["mask_coverage", "ui_score"]),
    secondary_concerns: z.array(z.enum(concernKeys)).max(3),
    metric_rationale: z.string().min(20),
    baseline_days: z.number().int().min(3).max(14),
    treatment_days: z.number().int().min(7).max(56),
    wash_in_days: z.number().int().min(0).max(14),
    sesoi: z.number().positive().max(30),
    sesoi_rationale: z.string().min(10),
    capture_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    capture_instructions: z.array(z.string()).min(2).max(6),
    claim_days: z.number().int().positive().nullable(),
    claim_testable: z.boolean(),
    caveats: z.array(z.string()).max(6),
    plain_summary: z.string().min(20),
  })
  .superRefine((p, ctx) => {
    for (const issue of protocolIssues(p)) ctx.addIssue({ code: "custom", message: issue });
  });

export type Protocol = z.infer<typeof ProtocolSchema>;

/** Design rules the agent must satisfy. Also exposed to it as a tool so it can self-check. */
export function protocolIssues(p: Omit<Protocol, never> | Record<string, unknown>, application?: ProductApplication): string[] {
  const q = p as Protocol;
  const issues: string[] = [];
  if (q.design === "split_face") {
    if (!q.treated_side) issues.push("split_face requires treated_side.");
    if (q.primary_metric !== "mask_coverage") {
      issues.push("split_face must use primary_metric mask_coverage (YouCam scores are whole-face; only masks can be split by side).");
    }
    if (q.primary_concern && !concern(q.primary_concern).splitFaceOk) {
      issues.push(`${q.primary_concern} is an eye-area/structural concern; its mask can't be compared cheek-to-cheek. Use pre_post.`);
    }
    if (application && application !== "leave_on_topical" && application !== "wash_off_topical") {
      issues.push(`A ${application.replace(/_/g, " ")} product reaches the whole face/body; split_face is impossible. Use pre_post.`);
    }
  } else {
    if (q.treated_side) issues.push("pre_post must have treated_side null.");
    if (q.primary_metric !== "ui_score") issues.push("pre_post must use primary_metric ui_score.");
    if (q.baseline_days != null && q.baseline_days < 5) issues.push("pre_post needs at least 5 baseline days to estimate normal day-to-day variation.");
  }
  if (q.secondary_concerns?.includes(q.primary_concern)) issues.push("secondary_concerns must not repeat the primary concern.");
  if (q.secondary_concerns && new Set(q.secondary_concerns).size !== q.secondary_concerns.length) issues.push("secondary_concerns has duplicates.");
  if (q.wash_in_days != null && q.treatment_days != null && q.treatment_days - q.wash_in_days < 7) {
    issues.push("treatment_days - wash_in_days must leave at least 7 analyzable days.");
  }
  if (q.primary_metric === "ui_score" && q.sesoi != null && (q.sesoi < 1 || q.sesoi > 15)) {
    issues.push("A ui_score SESOI should be between 1 and 15 points.");
  }
  if (q.primary_metric === "mask_coverage" && q.sesoi != null && (q.sesoi < 0.5 || q.sesoi > 15)) {
    issues.push("A mask_coverage SESOI should be between 0.5 and 15 percentage points.");
  }
  return issues;
}

/** Every concern sent to YouCam for this protocol (max 4 = cheapest unit tier). */
export function protocolConcerns(p: Pick<Protocol, "primary_concern" | "secondary_concerns">): ConcernKey[] {
  return [p.primary_concern, ...p.secondary_concerns.filter((c) => c !== p.primary_concern)].slice(0, 4);
}

/** Effects are always oriented so + = better; `better` says what + means in words. */
export const METRIC_META = {
  ui_score: { label: "YouCam score", unit: "pts", higherIsBetter: true, short: "score", better: "higher score", less: false },
  mask_coverage: { label: "Cheek area flagged (%)", unit: "pts", higherIsBetter: false, short: "% flagged", better: "less of the cheek flagged", less: true },
} as const;
