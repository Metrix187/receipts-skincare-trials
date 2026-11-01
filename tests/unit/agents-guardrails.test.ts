import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkVerdictText } from "@/lib/agents/verdict-agent";
import { parseClaimDays } from "@/lib/agents/protocol-agent";
import { maskCoverageBySide } from "@/lib/analysis/mask-sides";
import { ProtocolSchema, protocolIssues, type Protocol } from "@/lib/protocol";

const base: Protocol = {
  design: "split_face",
  design_rationale: "Product on one side, other side is the control.",
  treated_side: "left",
  primary_concern: "redness",
  primary_metric: "mask_coverage",
  secondary_concerns: ["texture"],
  metric_rationale: "The claim is about redness, so we measure the redness mask.",
  baseline_days: 5,
  treatment_days: 28,
  wash_in_days: 7,
  sesoi: 2,
  sesoi_rationale: "Smallest visible change.",
  capture_time: "08:00",
  capture_instructions: ["Same time daily", "Same light"],
  claim_days: 28,
  claim_testable: true,
  caveats: [],
  plain_summary: "Five baseline days, then four weeks on one side.",
};

describe("protocol rules", () => {
  it("accepts a valid split-face protocol", () => {
    expect(ProtocolSchema.safeParse(base).success).toBe(true);
    expect(protocolIssues(base, "leave_on_topical")).toEqual([]);
  });

  it("rejects split-face for oral products and eye-area concerns", () => {
    expect(protocolIssues(base, "oral").join(" ")).toMatch(/split_face is impossible/);
    expect(protocolIssues({ ...base, primary_concern: "dark_circle" }).join(" ")).toMatch(/eye-area/);
  });

  it("forces the metric that matches the design", () => {
    expect(protocolIssues({ ...base, primary_metric: "ui_score" }).join(" ")).toMatch(/mask_coverage/);
    const pp = { ...base, design: "pre_post" as const, treated_side: null, primary_metric: "mask_coverage" as const, baseline_days: 7 };
    expect(protocolIssues(pp).join(" ")).toMatch(/ui_score/);
  });

  it("requires enough analyzable treatment days after wash-in", () => {
    expect(protocolIssues({ ...base, treatment_days: 10, wash_in_days: 5 }).join(" ")).toMatch(/at least 7 analyzable/);
  });
});

describe("claim timeframe parsing", () => {
  it.each([
    ["reduces redness in 4 weeks", 28],
    ["visible results in 14 days", 14],
    ["after 2 months", 60],
    ["instantly brighter", null],
  ])("%s -> %s", (claim, days) => expect(parseClaimDays(claim)).toBe(days));
});

describe("verdict guardrails", () => {
  const ok = { label: "inconclusive", headline: "No detectable change in redness after 18 days; 12 more needed to rule out a small effect.", explanation: "We compared both sides of your face for 18 days." };

  it("passes an honest inconclusive verdict", () => {
    expect(checkVerdictText(ok, "inconclusive")).toEqual([]);
  });

  it("rejects a label that disagrees with the computed one", () => {
    expect(checkVerdictText({ ...ok, label: "improved" }, "inconclusive")[0]).toMatch(/must be "inconclusive"/);
  });

  it("rejects overclaiming language", () => {
    expect(checkVerdictText({ ...ok, headline: "Clinically proven to reduce redness in 18 days." }, "inconclusive").join(" ")).toMatch(/clinically|proven/i);
    expect(checkVerdictText({ ...ok, headline: "It works! Redness is down after 18 days." }, "inconclusive").join(" ")).toMatch(/overclaims/);
  });

  it("requires numbers in the headline", () => {
    expect(checkVerdictText({ ...ok, headline: "Not enough data yet, keep going." }, "inconclusive").join(" ")).toMatch(/number/);
  });
});

describe("mask split", () => {
  // 200x200 transparent mask with detections only on the IMAGE-left cheek.
  async function mask() {
    const W = 200;
    const px = new Uint8Array(W * W * 4);
    for (let y = 100; y < 170; y++) for (let x = 30; x < 90; x++) px[(y * W + x) * 4 + 3] = 255;
    return new Uint8Array(await sharp(Buffer.from(px), { raw: { width: W, height: W, channels: 4 } }).png().toBuffer());
  }
  const face = { box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, midlineX: 0.5 };

  it("maps image-left to the subject's RIGHT side (unmirrored photo)", async () => {
    const cov = await maskCoverageBySide(await mask(), face);
    expect(cov.channel).toBe("alpha");
    expect(cov.right).toBeGreaterThan(50);
    expect(cov.left).toBe(0);
  });

  it("reads luminance when the mask is opaque", async () => {
    const W = 100;
    const px = new Uint8Array(W * W * 3); // black, opaque
    for (let y = 50; y < 85; y++) for (let x = 55; x < 90; x++) px.fill(255, (y * W + x) * 3, (y * W + x) * 3 + 3);
    const png = new Uint8Array(await sharp(Buffer.from(px), { raw: { width: W, height: W, channels: 3 } }).png().toBuffer());
    const cov = await maskCoverageBySide(png, face);
    expect(cov.channel).toBe("luma");
    expect(cov.left).toBeGreaterThan(cov.right);
  });

  it("v2 excludes mask signals in the mouth and nose region", async () => {
    const W = 200;
    const px = new Uint8Array(W * W * 4);
    // Mark only the central mouth/nose area that the legacy boxes overlapped.
    for (let y = 130; y < 150; y++) for (let x = 75; x < 125; x++) px[(y * W + x) * 4 + 3] = 255;
    const png = new Uint8Array(await sharp(Buffer.from(px), { raw: { width: W, height: W, channels: 4 } }).png().toBuffer());
    const legacy = await maskCoverageBySide(png, face);
    const compact = await maskCoverageBySide(png, { ...face, roiVersion: 2 });
    expect(legacy.whole).toBeGreaterThan(0);
    expect(compact.whole).toBe(0);
  });
});
