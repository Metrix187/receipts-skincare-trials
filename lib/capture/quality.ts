// Client-side capture consistency checks. All run in the browser on canvas pixels,
// BEFORE anything is uploaded, so bad photos never cost YouCam units.

export interface FaceDetection {
  /** pixels in the analyzed frame */
  box: { x: number; y: number; w: number; h: number };
  /** pixels: subject's right eye, left eye, nose tip (MediaPipe BlazeFace order) */
  rightEye: { x: number; y: number };
  leftEye: { x: number; y: number };
  nose: { x: number; y: number };
}

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

/** Rec. 709 luma in [0, 1]. */
export const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export interface RegionStats {
  mean: number;
  clippedHigh: number;
  clippedLow: number;
}

/** Luma stats over a rectangle of an RGBA buffer. */
export function regionStats(px: Uint8ClampedArray, width: number, rect: { x: number; y: number; w: number; h: number }): RegionStats {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(px.length / 4 / width, Math.ceil(rect.y + rect.h));
  let sum = 0;
  let hi = 0;
  let lo = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const l = luma(px[i], px[i + 1], px[i + 2]);
      sum += l;
      if (l > 0.97) hi++;
      if (l < 0.03) lo++;
      n++;
    }
  }
  return n ? { mean: sum / n, clippedHigh: hi / n, clippedLow: lo / n } : { mean: 0, clippedHigh: 0, clippedLow: 0 };
}

/** Variance of the 4-neighbour Laplacian on luma (focus measure), scaled x1000. */
export function sharpness(px: Uint8ClampedArray, width: number, rect: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.max(1, Math.floor(rect.x));
  const y0 = Math.max(1, Math.floor(rect.y));
  const height = px.length / 4 / width;
  const x1 = Math.min(width - 1, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height - 1, Math.ceil(rect.y + rect.h));
  const L = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return luma(px[i], px[i + 1], px[i + 2]);
  };
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = 4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1);
      s += v;
      s2 += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return (s2 / n - m * m) * 1000;
}

export function poseOf(f: FaceDetection) {
  const dx = f.leftEye.x - f.rightEye.x;
  const dy = f.leftEye.y - f.rightEye.y;
  const eyeDist = Math.hypot(dx, dy) || 1;
  // In an unmirrored photo the subject's left eye is on the image right, so dx > 0 when upright.
  const rollDeg = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI;
  const midX = (f.leftEye.x + f.rightEye.x) / 2;
  const yaw = (f.nose.x - midX) / eyeDist; // ~0 when facing the camera
  return { rollDeg, yaw, midlineX: (midX + f.nose.x) / 2 };
}

export interface EvaluateInput {
  faces: FaceDetection[];
  frame: { w: number; h: number };
  px: Uint8ClampedArray;
  /** short side the final crop will have, in source pixels */
  cropShortSide: number;
  minShortSide: number;
  design: "split_face" | "pre_post";
  minutesFromTarget: number | null;
  /** median face luma of this trial's earlier counted captures */
  referenceLuma: number | null;
}

export interface Evaluation {
  checks: Check[];
  canCapture: boolean;
  metrics: { luminance: number; leftRightLumaGap: number; sharpness: number; rollDeg: number; yaw: number; faceWidthFrac: number } | null;
}

export function evaluate(i: EvaluateInput): Evaluation {
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });

  if (i.faces.length === 0) {
    add("face", "Face", "fail", "No face found. Center your face in the outline.");
    return { checks, canCapture: false, metrics: null };
  }
  if (i.faces.length > 1) {
    add("face", "Face", "fail", "More than one face in frame.");
    return { checks, canCapture: false, metrics: null };
  }
  const f = i.faces[0];
  add("face", "Face", "pass", "One face found.");

  // Framing: face centered and big enough.
  const cx = (f.box.x + f.box.w / 2) / i.frame.w - 0.5;
  const cy = (f.box.y + f.box.h / 2) / i.frame.h - 0.5;
  const off = Math.max(Math.abs(cx), Math.abs(cy));
  const widthFrac = f.box.w / i.frame.w;
  if (off > 0.2) add("framing", "Framing", "fail", "Move your face into the outline.");
  else if (widthFrac < 0.22) add("framing", "Framing", "fail", "Move closer to the camera.");
  else if (widthFrac > 0.8) add("framing", "Framing", "fail", "Move a little further away.");
  else if (off > 0.1) add("framing", "Framing", "warn", "Almost centered.");
  else add("framing", "Framing", "pass", "Centered.");

  // Resolution of the crop we'll send (YouCam SD needs >= 480px short side, HD >= 1080px).
  if (i.cropShortSide < i.minShortSide) {
    add("resolution", "Resolution", "fail", `Face crop is ${Math.round(i.cropShortSide)}px; analysis needs ${i.minShortSide}px. Move closer or use a sharper camera.`);
  } else add("resolution", "Resolution", "pass", `${Math.round(i.cropShortSide)}px face crop.`);

  // Pose
  const pose = poseOf(f);
  const absRoll = Math.abs(pose.rollDeg);
  const absYaw = Math.abs(pose.yaw);
  if (absRoll > 12 || absYaw > 0.22) add("pose", "Pose", "fail", absRoll > 12 ? "Your head is tilted. Level it." : "Turn to face the camera straight on.");
  else if (absRoll > 7 || absYaw > 0.12) add("pose", "Pose", "warn", "Nearly straight. Look directly at the lens.");
  else add("pose", "Pose", "pass", "Facing the camera.");

  // Brightness + clipping on the face
  const face = regionStats(i.px, i.frame.w, f.box);
  if (face.mean < 0.22 || face.mean > 0.88) add("light", "Lighting", "fail", face.mean < 0.22 ? "Too dark. Face a window or a lamp." : "Overexposed. Step away from direct light.");
  else if (face.mean < 0.32 || face.mean > 0.78 || face.clippedHigh > 0.06) add("light", "Lighting", "warn", face.clippedHigh > 0.06 ? "Shiny highlights. Soften the light." : "Lighting is marginal.");
  else add("light", "Lighting", "pass", "Even exposure.");

  // Left/right evenness: one-sided light would bias a split-face comparison.
  const midX = pose.midlineX;
  const left = regionStats(i.px, i.frame.w, { x: f.box.x, y: f.box.y + f.box.h * 0.35, w: midX - f.box.x, h: f.box.h * 0.5 });
  const right = regionStats(i.px, i.frame.w, { x: midX, y: f.box.y + f.box.h * 0.35, w: f.box.x + f.box.w - midX, h: f.box.h * 0.5 });
  const gap = Math.abs(left.mean - right.mean) / Math.max(0.05, (left.mean + right.mean) / 2);
  const evenFail = i.design === "split_face" ? 0.25 : 0.4;
  if (gap > evenFail) add("evenness", "Even light", "fail", "One side of your face is much brighter. Face the light source.");
  else if (gap > 0.12) add("evenness", "Even light", "warn", "One side is brighter than the other.");
  else add("evenness", "Even light", "pass", "Both sides evenly lit.");

  // Focus
  const sharp = sharpness(i.px, i.frame.w, f.box);
  if (sharp < 0.15) add("focus", "Focus", "warn", "Image looks soft. Hold still or wipe the lens.");
  else add("focus", "Focus", "pass", "Sharp.");

  // Consistency with earlier days
  if (i.referenceLuma != null && i.referenceLuma > 0) {
    const d = (face.mean - i.referenceLuma) / i.referenceLuma;
    if (Math.abs(d) > 0.18) add("consistency", "Same as usual", "warn", `${d > 0 ? "Brighter" : "Darker"} than your usual photos by ${Math.round(Math.abs(d) * 100)}%. Use your usual spot.`);
    else add("consistency", "Same as usual", "pass", "Matches your earlier photos.");
  }

  // Time of day
  if (i.minutesFromTarget != null) {
    if (Math.abs(i.minutesFromTarget) > 120) add("time", "Time of day", "warn", `${Math.round(Math.abs(i.minutesFromTarget) / 60)}h from your usual time. Skin changes through the day.`);
    else add("time", "Time of day", "pass", "Close to your usual time.");
  }

  return {
    checks,
    canCapture: !checks.some((c) => c.status === "fail"),
    metrics: { luminance: round3(face.mean), leftRightLumaGap: round3(gap), sharpness: round3(sharp), rollDeg: round3(pose.rollDeg), yaw: round3(pose.yaw), faceWidthFrac: round3(widthFrac) },
  };
}

/**
 * Crop around the face so it fills ~65% of the width (YouCam rejects faces narrower
 * than 60% of the image), 4:5 portrait, clamped to the frame. Same framing every
 * day also helps consistency.
 */
export function cropAroundFace(f: FaceDetection, frame: { w: number; h: number }) {
  let w = f.box.w / 0.65;
  let h = w * 1.25;
  if (h > frame.h) {
    h = frame.h;
    w = h / 1.25;
  }
  if (w > frame.w) {
    w = frame.w;
    h = w * 1.25;
  }
  const cx = f.box.x + f.box.w / 2;
  const cy = f.box.y + f.box.h * 0.45;
  const x = Math.min(Math.max(0, cx - w / 2), frame.w - w);
  const y = Math.min(Math.max(0, cy - h / 2), frame.h - h);
  return { x, y, w, h };
}

/** Face geometry normalized to the crop (what the server uses for the side split). */
export function faceInCrop(f: FaceDetection, crop: { x: number; y: number; w: number; h: number }) {
  const { midlineX, rollDeg } = poseOf(f);
  return {
    box: {
      x: clamp01((f.box.x - crop.x) / crop.w),
      y: clamp01((f.box.y - crop.y) / crop.h),
      w: clamp01(f.box.w / crop.w),
      h: clamp01(f.box.h / crop.h),
    },
    midlineX: clamp01((midlineX - crop.x) / crop.w),
    rollDeg: round3(rollDeg),
  };
}

export function minutesFrom(target: string, now = new Date()) {
  const [h, m] = target.split(":").map(Number);
  let d = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
