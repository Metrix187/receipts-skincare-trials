// Catalog of YouCam AI Skin Analysis concerns (v2.1), from the official OpenAPI
// spec (docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.yaml) and the
// YouCam-API/skills skin-analysis-expert reference.
//
// ui_score: integer 1-100, HIGHER IS BETTER (fewer visible pores, more hydration...).
// raw_score: float 1-100, model output; direction may differ, so we store it but
// never use it for verdicts.

export type Tier = "sd" | "hd";

export type ConcernKey =
  | "redness"
  | "acne"
  | "pore"
  | "texture"
  | "wrinkle"
  | "age_spot"
  | "oiliness"
  | "moisture"
  | "radiance"
  | "firmness"
  | "dark_circle"
  | "eye_bag"
  | "tear_trough"
  | "droopy_upper_eyelid"
  | "droopy_lower_eyelid"
  | "skin_type";

export interface ConcernInfo {
  key: ConcernKey;
  label: string;
  sd: string;
  hd: string;
  /** What the score measures, in plain language (fed to the Protocol Agent). */
  measures: string;
  /**
   * Whether the concern's detection mask is spatially meaningful across the cheeks,
   * which is what split-face comparisons need. Eye-area concerns are excluded
   * because each eye is a tiny region dominated by alignment noise.
   */
  splitFaceOk: boolean;
  /** Whether it yields a numeric ui_score (skin_type is categorical). */
  scored: boolean;
}

export const CONCERNS: readonly ConcernInfo[] = [
  { key: "redness", label: "Redness", sd: "redness", hd: "hd_redness", measures: "Visible redness / erythema across the face.", splitFaceOk: true, scored: true },
  { key: "acne", label: "Acne", sd: "acne", hd: "hd_acne", measures: "Count and extent of visible acne lesions.", splitFaceOk: true, scored: true },
  { key: "pore", label: "Pores", sd: "pore", hd: "hd_pore", measures: "Visibility and size of pores (HD adds forehead/nose/cheek regions).", splitFaceOk: true, scored: true },
  { key: "texture", label: "Texture", sd: "texture", hd: "hd_texture", measures: "Surface roughness / unevenness.", splitFaceOk: true, scored: true },
  { key: "wrinkle", label: "Wrinkles", sd: "wrinkle", hd: "hd_wrinkle", measures: "Fine lines and wrinkles (HD adds forehead, glabellar, crow's feet, nasolabial...).", splitFaceOk: true, scored: true },
  { key: "age_spot", label: "Spots", sd: "age_spot", hd: "hd_age_spot", measures: "Age spots and hyperpigmentation.", splitFaceOk: true, scored: true },
  { key: "oiliness", label: "Oiliness", sd: "oiliness", hd: "hd_oiliness", measures: "Shine / sebum level.", splitFaceOk: true, scored: true },
  { key: "moisture", label: "Hydration", sd: "moisture", hd: "hd_moisture", measures: "Apparent skin hydration.", splitFaceOk: true, scored: true },
  { key: "radiance", label: "Radiance", sd: "radiance", hd: "hd_radiance", measures: "Brightness / glow; sensitive to lighting.", splitFaceOk: true, scored: true },
  { key: "firmness", label: "Firmness", sd: "firmness", hd: "hd_firmness", measures: "Apparent firmness / elasticity (sagging).", splitFaceOk: false, scored: true },
  { key: "dark_circle", label: "Dark circles", sd: "dark_circle_v2", hd: "hd_dark_circle", measures: "Under-eye darkness.", splitFaceOk: false, scored: true },
  { key: "eye_bag", label: "Eye bags", sd: "eye_bag", hd: "hd_eye_bag", measures: "Under-eye puffiness.", splitFaceOk: false, scored: true },
  { key: "tear_trough", label: "Tear trough", sd: "tear_trough", hd: "hd_tear_trough", measures: "Hollowness under the eyes.", splitFaceOk: false, scored: true },
  { key: "droopy_upper_eyelid", label: "Upper eyelid droop", sd: "droopy_upper_eyelid", hd: "hd_droopy_upper_eyelid", measures: "Upper eyelid sagging.", splitFaceOk: false, scored: true },
  { key: "droopy_lower_eyelid", label: "Lower eyelid droop", sd: "droopy_lower_eyelid", hd: "hd_droopy_lower_eyelid", measures: "Lower eyelid sagging.", splitFaceOk: false, scored: true },
  { key: "skin_type", label: "Skin type", sd: "skin_type", hd: "hd_skin_type", measures: "Categorical skin type (oily/dry/combination/normal).", splitFaceOk: false, scored: false },
] as const;

const byKey = new Map(CONCERNS.map((c) => [c.key, c]));
const byAction = new Map<string, ConcernInfo>();
for (const c of CONCERNS) {
  byAction.set(c.sd, c);
  byAction.set(c.hd, c);
}

export function concern(key: ConcernKey): ConcernInfo {
  const c = byKey.get(key);
  if (!c) throw new Error(`Unknown concern ${key}`);
  return c;
}

export function isConcernKey(v: string): v is ConcernKey {
  return byKey.has(v as ConcernKey);
}

/** dst_actions value for a concern at a tier. */
export function actionFor(key: ConcernKey, tier: Tier): string {
  return tier === "hd" ? concern(key).hd : concern(key).sd;
}

/** Maps an API `type` (e.g. "hd_redness", "dark_circle_v2") back to our key. */
export function concernFromAction(action: string): ConcernInfo | undefined {
  return byAction.get(action);
}

export function isHdAction(action: string): boolean {
  return action.startsWith("hd_");
}
