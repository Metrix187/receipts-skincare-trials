// In-browser face detection with MediaPipe BlazeFace (short range). The WASM runtime
// and model are served from our own /public, so no frame ever leaves the device
// for detection. NEXT_PUBLIC_FACE_DETECTOR=mock swaps in a fixed, centered face
// (used by the Playwright smoke test, where there's no real face).

import type { FaceDetection } from "./quality";

export interface Detector {
  kind: "mediapipe" | "mock";
  detect(source: HTMLVideoElement | HTMLCanvasElement, width: number, height: number): FaceDetection[];
}

let pending: Promise<Detector> | null = null;

export function loadDetector(): Promise<Detector> {
  pending ??= process.env.NEXT_PUBLIC_FACE_DETECTOR === "mock" ? Promise.resolve(mockDetector) : loadMediaPipe();
  return pending;
}

const mockDetector: Detector = {
  kind: "mock",
  detect(_source, w, h) {
    const bw = w * 0.42;
    const bh = bw * 1.25;
    const x = (w - bw) / 2;
    const y = (h - bh) / 2;
    return [{ box: { x, y, w: bw, h: bh }, rightEye: { x: x + bw * 0.3, y: y + bh * 0.38 }, leftEye: { x: x + bw * 0.7, y: y + bh * 0.38 }, nose: { x: x + bw * 0.5, y: y + bh * 0.55 } }];
  },
};

async function loadMediaPipe(): Promise<Detector> {
  const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite", delegate: "CPU" },
    runningMode: "VIDEO",
    minDetectionConfidence: 0.6,
  });
  let lastTs = 0;
  return {
    kind: "mediapipe",
    detect(source, w, h) {
      // VIDEO mode needs strictly increasing timestamps.
      lastTs = Math.max(lastTs + 1, performance.now());
      const res = detector.detectForVideo(source, lastTs);
      return res.detections
        .filter((d) => d.boundingBox && d.keypoints.length >= 3)
        .map((d) => {
          const b = d.boundingBox!;
          const k = d.keypoints;
          return {
            box: { x: b.originX, y: b.originY, w: b.width, h: b.height },
            rightEye: { x: k[0].x * w, y: k[0].y * h },
            leftEye: { x: k[1].x * w, y: k[1].y * h },
            nose: { x: k[2].x * w, y: k[2].y * h },
          };
        });
    },
  };
}
