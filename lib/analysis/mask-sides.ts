import "server-only";
import sharp from "sharp";

// Split-face measurement from YouCam's own detection masks.
//
// YouCam returns whole-face scores only, but each concern also comes with a mask
// image marking WHERE it detected the concern. One analysis call per day is enough
// to compare cheeks: measure mask coverage inside the left and right cheek regions,
// using the facial midline from the in-browser face detector.
//
//   coverage(side) = mean mask intensity over the side's cheek region, x 100
//
// For binary masks that is literally "% of the cheek flagged". Masks are read
// through alpha when it varies (raw-mask PNGs), else through luminance (masks drawn
// on black). Coordinates are normalized, so the mask may be at any resolution
// (YouCam resizes inputs above 2560px).
//
// Sides are ANATOMICAL (the subject's left/right). The uploaded photo is not
// mirrored, so the subject's right cheek is on the IMAGE's left.

export interface FaceGeometry {
  /** Face box in normalized image coordinates [0, 1]. */
  box: { x: number; y: number; w: number; h: number };
  /** Normalized x of the facial midline (eye midpoint / nose tip). */
  midlineX: number;
  rollDeg?: number;
  /** Version 2 uses compact elliptical upper-cheek sampling patches. */
  roiVersion?: 1 | 2;
}

export interface SideCoverage {
  left: number;
  right: number;
  whole: number;
  /** Which channel was read: "alpha" for raw masks, "luma" for opaque ones. */
  channel: "alpha" | "luma";
}

/** Cheek band: below the eyes, above the jaw, excluding a strip over the nose. */
export function cheekRegions(face: FaceGeometry) {
  const { box } = face;
  if (face.roiVersion === 2) {
    // Conservative upper-cheek patches: smaller than the face detector box, and
    // intentionally clear of the central nose and lower mouth/jaw. These are
    // geometric approximations, not validated skin segmentation.
    const top = box.y + box.h * 0.43;
    const bottom = box.y + box.h * 0.65;
    const center = face.midlineX;
    return {
      imageLeft: { x0: box.x + box.w * 0.16, x1: Math.min(box.x + box.w * 0.39, center - box.w * 0.11), y0: top, y1: bottom },
      imageRight: { x0: Math.max(box.x + box.w * 0.61, center + box.w * 0.11), x1: box.x + box.w * 0.84, y0: top, y1: bottom },
    };
  }
  const top = box.y + box.h * 0.42;
  const bottom = box.y + box.h * 0.88;
  const noseHalf = box.w * 0.07;
  return {
    imageLeft: { x0: box.x + box.w * 0.06, x1: face.midlineX - noseHalf, y0: top, y1: bottom },
    imageRight: { x0: face.midlineX + noseHalf, x1: box.x + box.w * 0.94, y0: top, y1: bottom },
  };
}

export async function maskCoverageBySide(mask: Uint8Array, face: FaceGeometry): Promise<SideCoverage> {
  const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;

  // Decide which channel encodes detection.
  let alphaMin = 255;
  let alphaMax = 0;
  for (let i = 3; i < data.length; i += channels * 7) {
    alphaMin = Math.min(alphaMin, data[i]);
    alphaMax = Math.max(alphaMax, data[i]);
  }
  const channel: SideCoverage["channel"] = alphaMax - alphaMin > 16 ? "alpha" : "luma";
  const intensity = (i: number) =>
    channel === "alpha" ? data[i + 3] / 255 : (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;

  const regionMean = (r: { x0: number; x1: number; y0: number; y1: number }) => {
    const x0 = clampPx(r.x0 * W, W);
    const x1 = clampPx(r.x1 * W, W);
    const y0 = clampPx(r.y0 * H, H);
    const y1 = clampPx(r.y1 * H, H);
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        // V2 samples an ellipse inside the bounding rectangle; do not include
        // its corners, which are more likely to contain hair or facial features.
        if (face.roiVersion === 2) {
          const dx = (x + 0.5 - (x0 + x1) / 2) / ((x1 - x0) / 2);
          const dy = (y + 0.5 - (y0 + y1) / 2) / ((y1 - y0) / 2);
          if (dx * dx + dy * dy > 1) continue;
        }
        sum += intensity((y * W + x) * channels);
        n++;
      }
    }
    return n ? (sum / n) * 100 : NaN;
  };

  const { imageLeft, imageRight } = cheekRegions(face);
  const imgL = regionMean(imageLeft);
  const imgR = regionMean(imageRight);
  return {
    // Unmirrored photo: image-left is the subject's right.
    left: round2(imgR),
    right: round2(imgL),
    whole: round2((imgL + imgR) / 2),
    channel,
  };
}

const clampPx = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
const round2 = (v: number) => Math.round(v * 100) / 100;
