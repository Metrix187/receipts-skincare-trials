import { describe, expect, it } from "vitest";
import { cropAroundFace, evaluate, faceInCrop, minutesFrom, poseOf, type FaceDetection } from "@/lib/capture/quality";

const W = 360;
const H = 480;

/** RGBA frame; `fill(x, y)` returns an [r, g, b] color. */
function frame(fill: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * W + x) * 4;
      px.set([r, g, b, 255], i);
    }
  return px;
}

const face: FaceDetection = {
  box: { x: 100, y: 120, w: 160, h: 200 },
  rightEye: { x: 148, y: 196 },
  leftEye: { x: 212, y: 196 },
  nose: { x: 180, y: 230 },
};
const skin = (x: number, y: number): [number, number, number] => {
  const g = ((x * 7 + y * 13) % 11) - 5;
  return [200 + g, 160 + g, 140 + g];
};
const base = { frame: { w: W, h: H }, cropShortSide: 900, minShortSide: 480, design: "split_face" as const, minutesFromTarget: 10, referenceLuma: null };

const status = (e: ReturnType<typeof evaluate>, id: string) => e.checks.find((c) => c.id === id)?.status;

describe("capture checks", () => {
  it("passes a centered, evenly lit, level face", () => {
    const e = evaluate({ ...base, faces: [face], px: frame(skin) });
    expect(e.canCapture).toBe(true);
    for (const id of ["face", "framing", "resolution", "pose", "light", "evenness", "time"]) expect(status(e, id)).toBe("pass");
  });

  it("blocks no face or several faces", () => {
    expect(evaluate({ ...base, faces: [], px: frame(skin) }).canCapture).toBe(false);
    expect(evaluate({ ...base, faces: [face, face], px: frame(skin) }).canCapture).toBe(false);
  });

  it("blocks a dark photo before any units are spent", () => {
    const e = evaluate({ ...base, faces: [face], px: frame(() => [30, 25, 20]) });
    expect(status(e, "light")).toBe("fail");
    expect(e.canCapture).toBe(false);
  });

  it("blocks one-sided lighting for split-face (it would bias the comparison)", () => {
    const e = evaluate({ ...base, faces: [face], px: frame((x, y) => (x < 180 ? skin(x, y) : [90, 70, 60])) });
    expect(status(e, "evenness")).toBe("fail");
  });

  it("blocks a crop below the tier's minimum resolution", () => {
    const e = evaluate({ ...base, cropShortSide: 400, faces: [face], px: frame(skin) });
    expect(status(e, "resolution")).toBe("fail");
  });

  it("flags a tilted head", () => {
    const tilted = { ...face, leftEye: { x: 212, y: 230 } };
    expect(Math.abs(poseOf(tilted).rollDeg)).toBeGreaterThan(20);
    expect(status(evaluate({ ...base, faces: [tilted], px: frame(skin) }), "pose")).toBe("fail");
  });

  it("warns (doesn't block) when brightness drifts from earlier days or time is off", () => {
    const e = evaluate({ ...base, referenceLuma: 0.4, minutesFromTarget: 300, faces: [face], px: frame(skin) });
    expect(status(e, "consistency")).toBe("warn");
    expect(status(e, "time")).toBe("warn");
    expect(e.canCapture).toBe(true);
  });
});

describe("crop", () => {
  it("makes the face fill ~70% of the crop width (YouCam needs > 60%)", () => {
    const crop = cropAroundFace(face, { w: W, h: H });
    expect(face.box.w / crop.w).toBeCloseTo(0.7, 2);
    expect(crop.h / crop.w).toBeCloseTo(1.25, 2);
    const g = faceInCrop(face, crop);
    expect(g.midlineX).toBeGreaterThan(0.4);
    expect(g.midlineX).toBeLessThan(0.6);
  });

  it("time difference wraps around midnight", () => {
    const d = new Date(2026, 9, 10, 0, 30);
    expect(minutesFrom("23:45", d)).toBe(45);
    expect(minutesFrom("08:00", new Date(2026, 9, 10, 7, 0))).toBe(-60);
  });
});
