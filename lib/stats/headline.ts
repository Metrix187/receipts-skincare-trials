import type { AnalysisResult, Design } from "./analyze";

const fmt = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(digits)}`;

/**
 * Deterministic one-liner for a computed verdict. The Verdict Agent may rephrase it,
 * but its label and numbers must match this (checked in lib/agents/verdict-agent.ts).
 * Effects are oriented + = better; `better` names what that means for the metric.
 */
export function headlineFor(
  r: AnalysisResult,
  ctx: { metricLabel: string; unit: string; design: Design; daysLogged: number; better?: string; lowerIsBetterArea?: boolean },
): string {
  const m = ctx.metricLabel.toLowerCase();
  const where = ctx.design === "split_face" ? " on the treated side" : "";
  // When the sentence already states the direction ("1.8 points less ..."), the CI
  // doesn't need to repeat what + means.
  const directional = ctx.lowerIsBetterArea && (r.label === "improved" || r.label === "worsened");
  const plus = ctx.better && !directional ? `, + = ${ctx.better}` : "";
  const ci = r.ciLow !== null && r.ciHigh !== null ? ` (95% CI ${fmt(r.ciLow)} to ${fmt(r.ciHigh)} ${ctx.unit}${plus})` : "";
  const more = r.daysRemaining.overall;
  const size = (e: number) =>
    ctx.lowerIsBetterArea
      ? `${Math.abs(e).toFixed(1)} points ${e >= 0 ? "less" : "more"} of the cheek flagged than the other side`
      : `${fmt(e)} ${ctx.unit}`;
  switch (r.label) {
    case "not_enough_data":
      return `Not enough data yet: ${r.nBaseline} baseline and ${r.nTreatment} treatment days logged (minimum ${r.minimums.baseline} + ${r.minimums.treatment}). ${r.daysRemaining.note}`;
    case "improved":
      return `${cap(m)} improved${where}: ${size(r.effect!)}${ci} after ${ctx.daysLogged} days.${
        r.effect! < r.sesoi ? ` That's smaller than the ${r.sesoi} ${ctx.unit} you said would matter.` : ""
      }`;
    case "worsened":
      return `${cap(m)} got worse${where}: ${size(r.effect!)}${ci} after ${ctx.daysLogged} days.`;
    case "no_meaningful_change":
      return `No meaningful change in ${m} after ${ctx.daysLogged} days: any effect is smaller than ±${r.sesoi} ${ctx.unit}${ci}.`;
    case "inconclusive":
      return more === null
        ? `No detectable change in ${m} after ${ctx.daysLogged} days, and the data are too noisy to settle it${ci}.`
        : `No detectable change in ${m} after ${ctx.daysLogged} days; ${more} more needed to rule out a small effect${ci}.`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const LABEL_TEXT: Record<AnalysisResult["label"], string> = {
  not_enough_data: "Not enough data",
  improved: "Improved",
  worsened: "Worsened",
  no_meaningful_change: "No meaningful change",
  inconclusive: "Inconclusive",
};
