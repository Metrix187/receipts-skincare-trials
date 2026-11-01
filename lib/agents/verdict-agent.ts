import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { METRIC_META } from "@/lib/protocol";
import { LABEL_TEXT, mean, type AnalysisResult, type VerdictLabel } from "@/lib/stats";
import { seriesFrom, type TrialBundle } from "@/lib/trial-data";
import { concern, type ConcernKey } from "@/lib/youcam/concerns";
import { runLiveAgent, strictObject, ToolInputError, type AgentRunResult, type AgentTool, type TranscriptEntry } from "./runner";

export interface VerdictOutput {
  label: VerdictLabel;
  headline: string;
  explanation: string;
  caveats: string[];
  next_step: string;
}

const SYSTEM = `You are the Verdict Agent in Receipts. A user is running a pre-registered n=1 trial of a skincare product, measured with YouCam AI Skin Analysis on daily selfies. You write the verdict they will read and share.

Hard rules:
- The statistics are already decided. Call run_preregistered_analysis: it runs the locked analysis (the one primary metric, the locked SESOI, the locked wash-in). You cannot change the analysis, pick a different metric, drop days, or test secondary concerns. Secondary concerns are descriptive only, never evidence.
- Your label MUST equal the computed label. Your numbers must match the tool output (round to 1 decimal).
- If interim is true, your headline MUST say "interim" and must not imply a final verdict. A forecast of additional days is only an estimate; never promise it will rule out an effect.
- Split-face mask intensity in geometric cheek patches is an experimental proxy, not a validated measure of cheek area or clinical improvement. Always mention this limitation.
- If the label is not_enough_data, say so plainly and say how many more days are needed. If it is inconclusive, say "no detectable change", not "it doesn't work", and say how many more days would settle it (or that more days can't, if the tool says the target is unreachable).
- Never overclaim. Banned: "proven", "clinically", "guaranteed", "definitely", "cure", "miracle". A CI excluding zero is not proof of a product effect. State whether an estimate is smaller than the SESOI without claiming that it is real.
- Check data quality (check_data_quality) and mention anything that could bias the result, e.g. lighting drifting between phases, missed days, or mock data.
- headline: one blunt sentence (<= 200 chars) with the key number(s) and days. Never promise that a number of extra days will rule out an effect.
- explanation: 2-4 short sentences in plain language: what was compared, the estimate and its 95% interval, and what that does and doesn't mean.

Work: get_protocol, check_data_quality, run_preregistered_analysis, optionally get_daily_series / describe_secondary, then call submit_verdict.`;

const BANNED = /\b(proven|proves|clinically|guarantee[ds]?|definitely|cures?|miracle|100%)\b/i;
const OVERCLAIM_WHEN_UNSURE = /\b(works|worked|effective|clearly (improved|reduced|helped))\b/i;

export function checkVerdictText(v: { label: string; headline: string; explanation: string }, computed: VerdictLabel): string[] {
  const issues: string[] = [];
  if (v.label !== computed) issues.push(`label must be "${computed}" (computed by the locked analysis), not "${v.label}".`);
  if (v.headline.length > 220) issues.push("headline must be at most ~200 characters.");
  if (!/\d/.test(v.headline)) issues.push("headline must include the key number(s) and the number of days.");
  for (const text of [v.headline, v.explanation]) {
    const m = text.match(BANNED);
    if (m) issues.push(`Overclaiming word "${m[0]}" is not allowed.`);
  }
  if (computed !== "improved" && computed !== "worsened") {
    const m = v.headline.match(OVERCLAIM_WHEN_UNSURE);
    if (m) issues.push(`"${m[0]}" overclaims for a ${computed} result.`);
  }
  return issues;
}

function qualityReport(b: TrialBundle) {
  const issues: string[] = [];
  const counted = b.captures;
  if (b.trial.design === "split_face") issues.push("Cheek-patch mask intensity is an experimental proxy, not a validated skin measurement.");
  issues.push("Model-based intervals are approximate; repeated daily looks are exploratory.");
  const lastDay = counted.length ? Math.max(...counted.map((c) => c.dayIndex)) : -1;
  const missed = lastDay >= 0 ? lastDay + 1 - counted.length : 0;
  if (missed > 0) issues.push(`${missed} missed day(s) between day 0 and day ${lastDay}.`);
  const failed = b.allCaptures.filter((c) => c.status === "error").length;
  if (failed) issues.push(`${failed} capture(s) failed analysis and were retaken (no units charged).`);
  const lum = (phase: string) => {
    const xs = counted.filter((c) => c.phase === phase).map((c) => Number((c.quality as { luminance?: number } | null)?.luminance)).filter(Number.isFinite);
    return xs.length ? mean(xs) : null;
  };
  const lb = lum("baseline");
  const lt = lum("treatment");
  if (lb && lt && Math.abs(lt - lb) / lb > 0.12) {
    issues.push(`Average photo brightness shifted ${Math.round(((lt - lb) / lb) * 100)}% between baseline and treatment; lighting may bias a pre/post comparison${b.trial.design === "split_face" ? " (split-face cancels most of this)" : ""}.`);
  }
  const drift = counted.map((c) => Number((c.quality as { minutesFromTarget?: number } | null)?.minutesFromTarget)).filter(Number.isFinite);
  const late = drift.filter((m) => Math.abs(m) > 120).length;
  if (late) issues.push(`${late} capture(s) were more than 2h from the planned capture time.`);
  const synthetic = counted.some((c) => (c.quality as { detector?: string } | null)?.detector === "demo-seed");
  if (synthetic) issues.push("These are synthetic demo data generated for illustration, not real measurements.");
  else if (counted.some((c) => c.mock)) issues.push("Some or all results are MOCK YouCam data (MOCK_YOUCAM=1), not real skin analysis.");
  return { countedDays: counted.length, missedDays: missed, failedCaptures: failed, issues };
}

function compactAnalysis(r: AnalysisResult) {
  const { trajectory, ...rest } = r;
  return { ...rest, trajectoryPoints: trajectory.length };
}

function tools(b: TrialBundle): AgentTool[] {
  const r = b.analysis!;
  return [
    {
      name: "get_protocol",
      description: "The locked, pre-registered protocol (design, primary concern/metric, SESOI, durations) and its hash.",
      input_schema: strictObject({}),
      run: async () => ({ protocol: b.protocol, protocolHash: b.trial.protocolHash, lockedAt: b.trial.lockedAt, product: b.trial.productName, claim: b.trial.claimText }),
    },
    {
      name: "check_data_quality",
      description: "Missed days, failed captures, lighting drift between phases, capture-time drift, and whether data is mock.",
      input_schema: strictObject({}),
      run: async () => qualityReport(b),
    },
    {
      name: "run_preregistered_analysis",
      description: "Run the locked primary analysis. Returns the computed label, effect, 95% CI, days remaining, the method, and a reference headline. Takes no parameters: the analysis can't be changed.",
      input_schema: strictObject({}),
      run: async () => ({
        primary: `${b.trial.primaryConcern} / ${b.trial.primaryMetric}`,
        unit: METRIC_META[b.trial.primaryMetric as keyof typeof METRIC_META].unit,
        orientation: `positive effect = improvement (+ = ${METRIC_META[b.trial.primaryMetric as keyof typeof METRIC_META].better})`,
        daysLogged: b.daysLogged,
        ...compactAnalysis(r),
        referenceHeadline: b.headline,
        labelMeaning: LABEL_TEXT[r.label],
      }),
    },
    {
      name: "get_daily_series",
      description: "Day-by-day values for one concern/metric (descriptive; for context only).",
      input_schema: strictObject({
        concern: { type: "string" },
        metric: { type: "string", enum: ["ui_score", "mask_coverage"] },
      }),
      run: async (raw) => {
        const a = z.object({ concern: z.string(), metric: z.enum(["ui_score", "mask_coverage"]) }).safeParse(raw);
        if (!a.success) throw new ToolInputError("concern and metric are required");
        return { days: seriesFrom(b.trial, b.captures, a.data) };
      },
    },
    {
      name: "describe_secondary",
      description: "Descriptive phase means for a secondary concern's ui_score. NOT a test: never use it as evidence.",
      input_schema: strictObject({ concern: { type: "string" } }),
      run: async (raw) => {
        const a = z.object({ concern: z.string() }).safeParse(raw);
        if (!a.success) throw new ToolInputError("concern is required");
        const days = seriesFrom(b.trial, b.captures, { concern: a.data.concern, metric: "ui_score" });
        const m = (p: string) => {
          const xs = days.filter((d) => d.phase === p && d.value !== undefined).map((d) => d.value!);
          return xs.length ? Math.round(mean(xs) * 10) / 10 : null;
        };
        return { concern: a.data.concern, baselineMean: m("baseline"), treatmentMean: m("treatment"), note: "Descriptive only. Not tested, no interval." };
      },
    },
    {
      name: "submit_verdict",
      description: "Submit the final verdict. Rejected if the label differs from the computed one or the text overclaims.",
      input_schema: strictObject({
        label: { type: "string", enum: ["not_enough_data", "improved", "worsened", "no_meaningful_change", "inconclusive"] },
        headline: { type: "string" },
        explanation: { type: "string" },
        caveats: { type: "array", items: { type: "string" } },
        next_step: { type: "string", description: "One concrete thing the user should do next." },
      }),
      terminal: true,
      run: async (raw) => {
        const v = z
          .object({
            label: z.enum(["not_enough_data", "improved", "worsened", "no_meaningful_change", "inconclusive"]),
            headline: z.string().min(10),
            explanation: z.string().min(20),
            caveats: z.array(z.string()).max(6),
            next_step: z.string().min(5),
          })
          .safeParse(raw);
        if (!v.success) throw new ToolInputError(v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        const issues = checkVerdictText(v.data, r.label);
        if (r.interim && r.effect !== null && !/\binterim\b/i.test(v.data.headline)) issues.push("The headline must call this an interim estimate.");
        if (/\b(will|needed to) (rule out|prove|settle)\b/i.test(`${v.data.headline} ${v.data.explanation}`)) issues.push("Additional days cannot be guaranteed to settle the question.");
        if (issues.length) throw new ToolInputError(`Verdict rejected: ${issues.join(" ")}`);
        return v.data satisfies VerdictOutput;
      },
    },
  ];
}

export function deterministicVerdict(b: TrialBundle): VerdictOutput {
  const r = b.analysis!;
  const meta = METRIC_META[b.trial.primaryMetric as keyof typeof METRIC_META];
  const c = concern(b.trial.primaryConcern as ConcernKey).label.toLowerCase();
  const q = qualityReport(b);
  const compared =
    b.trial.design === "split_face"
      ? `We compared average YouCam ${c} mask intensity in approximate cheek patches on your treated (${b.trial.treatedSide}) side and untreated side, before and after you started.`
      : `We compared your YouCam ${c} score during treatment with your ${r.nBaseline}-day baseline.`;
  const est =
    r.effect === null
      ? `So far there are ${r.nBaseline} baseline and ${r.nTreatment} treatment days, below the ${r.minimums.baseline} + ${r.minimums.treatment} minimum for an honest estimate.`
      : `The estimated change is ${fmt(r.effect)} ${meta.unit} (+ = ${meta.better}), with a 95% interval from ${fmt(r.ciLow!)} to ${fmt(r.ciHigh!)}.`;
  const meaning: Record<VerdictLabel, string> = {
    not_enough_data: "Any number shown now would mostly be noise.",
    improved: r.effect! >= r.sesoi ? "The model-based interval is above zero; measurement error and other changes could still explain the result." : `The interval is above zero, but the estimate is smaller than the ${r.sesoi} ${meta.unit} threshold.`,
    worsened: "The whole interval is below zero: the treated measurements got worse.",
    no_meaningful_change: `The interval sits inside ±${r.sesoi} ${meta.unit}, so any effect is smaller than what you said would matter.`,
    inconclusive: r.interim ? "This is an exploratory look before the planned endpoint; do not treat it as a final result." : "The interval does not give a conclusive answer at the chosen threshold.",
  };
  return {
    label: r.label,
    headline: b.headline!,
    explanation: [compared, est, meaning[r.label]].join(" "),
    caveats: [...q.issues, "One person, one product, AI-estimated skin scores: not medical advice."].slice(0, 6),
    next_step:
      r.label === "not_enough_data" || r.label === "inconclusive"
        ? r.daysRemaining.overall != null
          ? `Keep capturing daily for about ${r.daysRemaining.overall} more day(s), same time and lighting.`
          : "More treatment days won't settle this. Consider re-running with a longer baseline and steadier lighting."
        : "Decide whether the result is worth the price. The receipt is ready to share.",
  };
}

const fmt = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`;

export async function runVerdictAgent(b: TrialBundle): Promise<AgentRunResult<VerdictOutput>> {
  if (!b.analysis) throw new Error("Trial has no locked protocol to analyze.");
  const prompt = `Write the verdict for trial "${b.trial.productName}" (claim: "${b.trial.claimText}"). ${b.daysLogged} day(s) of valid captures so far. Finish by calling submit_verdict.`;
  if (env().agentsMock) return mockVerdictAgent(b, prompt);
  return runLiveAgent<VerdictOutput>({ system: SYSTEM, prompt, tools: tools(b) });
}

async function mockVerdictAgent(b: TrialBundle, prompt: string): Promise<AgentRunResult<VerdictOutput>> {
  const transcript: TranscriptEntry[] = [
    { kind: "user", text: prompt },
    { kind: "note", text: "Mock agent (no ANTHROPIC_API_KEY): deterministic template, same tools and the same guardrails as the live agent." },
  ];
  const t = tools(b);
  const call = async (name: string, args: unknown) => {
    const id = `mock_${name}_${transcript.length}`;
    transcript.push({ kind: "tool_call", id, name, input: args });
    const out = await t.find((x) => x.name === name)!.run(args);
    transcript.push({ kind: "tool_result", id, name, output: out, isError: false });
    return out;
  };
  await call("get_protocol", {});
  await call("check_data_quality", {});
  await call("run_preregistered_analysis", {});
  for (const s of b.protocol?.secondary_concerns ?? []) await call("describe_secondary", { concern: s });
  const output = (await call("submit_verdict", deterministicVerdict(b))) as VerdictOutput;
  return { output, transcript, usage: { input: 0, output: 0 }, turns: 1, model: "mock-deterministic", mock: true };
}
