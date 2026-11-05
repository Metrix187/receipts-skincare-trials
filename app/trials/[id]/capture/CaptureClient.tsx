"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";
import { localDateString } from "@/components/TodayCard";
import type { CaptureView } from "@/lib/capture-view";
import { loadDetector, type Detector } from "@/lib/capture/face-detector";
import { cropAroundFace, evaluate, faceInCrop, minutesFrom, type Evaluation, type FaceDetection } from "@/lib/capture/quality";

export interface CaptureProps {
  trialId: string;
  design: "split_face" | "pre_post";
  treatedSide: string | null;
  tier: string;
  minShortSide: number;
  unitsPerCall: number;
  mock: boolean;
  captureTime: string;
  referenceLuma: number | null;
  instruction: string;
}

type Phase = "starting" | "live" | "nocamera" | "review" | "analyzing" | "done";
const SMALL_W = 360;
const MAX_LONG_SIDE = 1600;

interface Snapshot {
  blob: Blob;
  url: string;
  evaluation: Evaluation;
  face: ReturnType<typeof faceInCrop>;
  width: number;
  height: number;
}

export function CaptureClient(p: CaptureProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const smallRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [live, setLive] = useState<Evaluation | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<CaptureView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectorKind, setDetectorKind] = useState<string>("loading");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Start detector + camera.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        detectorRef.current = await loadDetector();
        if (!cancelled) setDetectorKind(detectorRef.current.kind);
      } catch (e) {
        if (!cancelled) setError(`Face detector failed to load: ${String(e)}`);
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setPhase("nocamera");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setPhase("live");
      } catch {
        if (!cancelled) setPhase("nocamera");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [stopCamera]);

  /** Run detection + checks on a downscaled copy of `source`. */
  const analyze = useCallback(
    (source: HTMLVideoElement | HTMLCanvasElement, srcW: number, srcH: number) => {
      const det = detectorRef.current;
      if (!det || !srcW || !srcH) return null;
      const scale = SMALL_W / srcW;
      const sw = SMALL_W;
      const sh = Math.round(srcH * scale);
      const c = (smallRef.current ??= document.createElement("canvas"));
      c.width = sw;
      c.height = sh;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(source, 0, 0, sw, sh);
      const faces = det.detect(c, sw, sh);
      const px = ctx.getImageData(0, 0, sw, sh).data;
      const crop = faces[0] ? cropAroundFace(faces[0], { w: sw, h: sh }) : null;
      const evaluation = evaluate({
        faces,
        frame: { w: sw, h: sh },
        px,
        cropShortSide: crop ? Math.min(crop.w, crop.h) / scale : 0,
        minShortSide: p.minShortSide,
        design: p.design,
        minutesFromTarget: minutesFrom(p.captureTime),
        referenceLuma: p.referenceLuma,
      });
      return { faces, evaluation, scale };
    },
    [p.minShortSide, p.design, p.captureTime, p.referenceLuma],
  );

  // Live checks at ~4 Hz.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const r = analyze(v, v.videoWidth, v.videoHeight);
      if (r) setLive(r.evaluation);
    }, 250);
    return () => clearInterval(t);
  }, [phase, analyze]);

  /** Shared path for camera frames and uploaded files. */
  const takeFrom = useCallback(
    async (source: HTMLVideoElement | HTMLImageElement, w: number, h: number) => {
      const full = document.createElement("canvas");
      full.width = w;
      full.height = h;
      full.getContext("2d")!.drawImage(source, 0, 0, w, h); // unmirrored, full resolution
      const r = analyze(full, w, h);
      if (!r || !r.faces[0]) {
        setError("No face found in that photo. Try again facing the camera.");
        return;
      }
      const s = 1 / r.scale;
      const f0 = r.faces[0];
      const faceFull: FaceDetection = {
        box: { x: f0.box.x * s, y: f0.box.y * s, w: f0.box.w * s, h: f0.box.h * s },
        rightEye: { x: f0.rightEye.x * s, y: f0.rightEye.y * s },
        leftEye: { x: f0.leftEye.x * s, y: f0.leftEye.y * s },
        nose: { x: f0.nose.x * s, y: f0.nose.y * s },
      };
      const crop = cropAroundFace(faceFull, { w, h });
      const out = Math.min(1, MAX_LONG_SIDE / Math.max(crop.w, crop.h));
      const cw = Math.round(crop.w * out);
      const ch = Math.round(crop.h * out);
      const oc = document.createElement("canvas");
      oc.width = cw;
      oc.height = ch;
      oc.getContext("2d")!.drawImage(full, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
      const blob = await new Promise<Blob>((res, rej) => oc.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.92));
      setSnap({ blob, url: URL.createObjectURL(blob), evaluation: r.evaluation, face: faceInCrop(faceFull, crop), width: cw, height: ch });
      setError(null);
      setPhase("review");
    },
    [analyze],
  );

  function shoot() {
    const v = videoRef.current;
    if (v) takeFrom(v, v.videoWidth, v.videoHeight).catch(() => setError("Couldn't capture that frame. Try again."));
  }

  async function onFile(file: File) {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try {
      await img.decode();
      await takeFrom(img, img.naturalWidth, img.naturalHeight);
    } catch {
      // HEIC/corrupt files: the accept attribute is only advisory, and decode() rejects
      setError("That image couldn't be read. Use a JPEG or PNG photo.");
    } finally {
      URL.revokeObjectURL(img.src);
    }
  }

  async function submit() {
    if (!snap) return;
    setPhase("analyzing");
    setError(null);
    stopCamera();
    const fd = new FormData();
    fd.set("image", new File([snap.blob], "selfie.jpg", { type: "image/jpeg" }));
    fd.set("face", JSON.stringify(snap.face));
    fd.set(
      "quality",
      JSON.stringify({
        ...snap.evaluation.metrics,
        minutesFromTarget: minutesFrom(p.captureTime),
        checks: Object.fromEntries(snap.evaluation.checks.map((c) => [c.id, c.status])),
        detector: detectorKind,
      }),
    );
    fd.set("localDate", localDateString());
    try {
      let res = await fetch(`/api/trials/${p.trialId}/captures`, { method: "POST", body: fd });
      let body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      for (let i = 0; body.status === "analyzing" && i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        res = await fetch(`/api/captures/${body.id}`);
        body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Polling failed");
      }
      setResult(body as CaptureView);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("review");
    }
  }

  function retake() {
    if (snap) URL.revokeObjectURL(snap.url);
    setSnap(null);
    setResult(null);
    setError(null);
    if (streamRef.current) setPhase("live");
    else if (!navigator.mediaDevices?.getUserMedia) setPhase("nocamera");
    else location.reload(); // camera was stopped for the upload; restart it cleanly
  }

  const checks = phase === "review" ? snap?.evaluation : live;
  const costLabel = p.mock ? "mock: 0 units" : `${p.unitsPerCall} YouCam units`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{p.instruction}</p>

      {(phase === "starting" || phase === "live") && (
        <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-3xl bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
          {/* Face outline guide */}
          <svg viewBox="0 0 100 133" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <mask id="hole">
                <rect width="100" height="133" fill="white" />
                <ellipse cx="50" cy="62" rx="29" ry="40" fill="black" />
              </mask>
            </defs>
            <rect width="100" height="133" fill="rgb(0 0 0 / 0.35)" mask="url(#hole)" />
            <ellipse cx="50" cy="62" rx="29" ry="40" fill="none" stroke={live?.canCapture ? "#4cc24c" : "#ffffff"} strokeWidth="0.8" strokeDasharray={live?.canCapture ? "0" : "2 2"} />
            <line x1="50" y1="30" x2="50" y2="96" stroke="white" strokeOpacity="0.25" strokeWidth="0.4" />
          </svg>
          {phase === "starting" && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting camera…</div>}
        </div>
      )}

      {phase === "nocamera" && (
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
          No camera available (or permission denied). You can upload a photo taken under the same conditions instead.
        </div>
      )}

      {phase === "review" && snap && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img src={snap.url} alt="Your captured photo" className="mx-auto w-full max-w-xs rounded-3xl" />
      )}

      {checks && phase !== "done" && phase !== "analyzing" && (
        <ul className="grid grid-cols-2 gap-2 text-sm" aria-live="polite" data-testid="checks">
          {checks.checks.map((c) => (
            <li key={c.id} className={`rounded-xl px-3 py-2 ${c.status === "pass" ? "bg-good-bg" : c.status === "warn" ? "bg-warn-bg" : "bg-crit-bg"}`}>
              <div className={`flex items-center gap-1.5 font-medium ${c.status === "pass" ? "text-good" : c.status === "warn" ? "text-warn" : "text-crit"}`}>
                <span aria-hidden>{c.status === "pass" ? "✓" : c.status === "warn" ? "!" : "✕"}</span>
                {c.label}
              </div>
              <div className="text-xs text-ink-2">{c.detail}</div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-crit" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {phase === "live" && (
          <button type="button" className={btn.primary} onClick={shoot} disabled={!live?.canCapture} data-testid="shoot">
            Take photo
          </button>
        )}
        {(phase === "live" || phase === "nocamera" || phase === "starting") && (
          <label className={`${btn.secondary} cursor-pointer`}>
            Upload a photo instead
            <input type="file" accept="image/jpeg,image/png" className="sr-only" data-testid="upload" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
        )}
        {phase === "review" && (
          <>
            <button type="button" className={btn.primary} onClick={submit} disabled={!snap?.evaluation.canCapture} data-testid="analyze">
              Analyze ({costLabel})
            </button>
            <button type="button" className={btn.secondary} onClick={retake}>Retake</button>
          </>
        )}
      </div>

      {phase === "review" && !snap?.evaluation.canCapture && (
        <p className="text-sm text-crit">This photo fails a check above, so it won&apos;t be sent (no units spent). Retake it.</p>
      )}

      {phase === "analyzing" && (
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm" role="status" data-testid="analyzing">
          Uploading and running YouCam AI Skin Analysis… usually a few seconds.
        </div>
      )}

      {phase === "done" && result && (
        <div className={`rounded-2xl p-4 text-sm ${result.status === "success" ? "bg-good-bg" : "bg-crit-bg"}`} data-testid="capture-result">
          {result.status === "success" ? (
            <>
              <div className="font-medium text-good">✓ Day {result.dayIndex} logged{result.mock ? " (mock analysis)" : ""}</div>
              <p className="mt-1 text-ink-2">
                {result.counts
                  ? "This photo counts toward your trial."
                  : "You'd already logged today. Only the first photo of each day counts, so this one is saved but not analyzed in the verdict."}
              </p>
            </>
          ) : result.status === "error" ? (
            <>
              <div className="font-medium text-crit">Analysis failed: no units charged</div>
              <p className="mt-1 text-ink-2">{result.error?.message}</p>
            </>
          ) : (
            <p className="text-ink-2">Still analyzing. Check back on the trial page in a minute.</p>
          )}
          <div className="mt-3 flex gap-3">
            <Link href={`/trials/${p.trialId}`} className={btn.primary} data-testid="back-to-trial">Back to trial</Link>
            {result.status === "error" && <button type="button" className={btn.secondary} onClick={() => location.reload()}>Retake</button>}
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        Checks run on your device before anything is uploaded. The photo is cropped to your face, encrypted at rest, and
        sent only to YouCam. Detector: {detectorKind}.
      </p>
    </div>
  );
}
