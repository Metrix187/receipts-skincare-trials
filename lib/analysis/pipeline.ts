import "server-only";
import type { Trial } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { storePhoto } from "@/lib/photos";
import { dayIndexFor, phaseFor } from "@/lib/trial-data";
import { youcam, YouCamError, retakeGuidance } from "@/lib/youcam";
import { concern, type ConcernKey, type Tier } from "@/lib/youcam/concerns";
import { maskCoverageBySide, type FaceGeometry } from "./mask-sides";

export interface CaptureInput {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
  face: FaceGeometry;
  quality: Record<string, unknown>;
  /** The user's local calendar date, YYYY-MM-DD. */
  localDate: string;
}

export class CaptureRejected extends Error {}

const MAX_EXTENSION_DAYS = 28;

/** Stores the encrypted selfie and submits it to YouCam. Returns immediately after task creation. */
export async function submitCapture(trial: Trial, input: CaptureInput) {
  if (trial.status !== "active" || !trial.lockedAt) throw new CaptureRejected("Lock the protocol before capturing.");
  const dayIndex = dayIndexFor(trial.startDate, input.localDate);
  const planned = (trial.baselineDays ?? 0) + (trial.treatmentDays ?? 0);
  if (dayIndex < 0) throw new CaptureRejected("This trial hasn't started yet.");
  if (dayIndex >= planned + MAX_EXTENSION_DAYS) throw new CaptureRejected("This trial's capture window has closed.");

  const capture = await db.capture.create({
    data: {
      trialId: trial.id,
      dayIndex,
      phase: phaseFor(trial, dayIndex),
      status: "analyzing",
      quality: input.quality as object,
      face: input.face as unknown as object,
      mock: env().youcamMock,
    },
  });
  await storePhoto(capture.id, input.bytes, { mime: input.mime, width: input.width, height: input.height });

  try {
    const task = await youcam().submitSkinAnalysis({
      bytes: input.bytes,
      contentType: input.mime,
      fileName: `rcpt_${capture.id}.${input.mime === "image/png" ? "png" : "jpg"}`,
      concerns: (trial.concerns as ConcernKey[]) ?? [],
      tier: trial.tier as Tier,
      ledgerContext: { trialId: trial.id, captureId: capture.id },
    });
    return db.capture.update({
      where: { id: capture.id },
      data: { youcamFileId: task.fileId, youcamTaskId: task.taskId, ledgerId: task.ledgerId, units: task.units },
    });
  } catch (err) {
    return db.capture.update({
      where: { id: capture.id },
      data: {
        status: "error",
        errorCode: err instanceof YouCamError ? (err.code ?? err.kind) : "submit_failed",
        errorMessage: err instanceof Error ? err.message.slice(0, 300) : String(err),
      },
    });
  }
}

/**
 * Polls YouCam (bounded by timeoutMs so it fits a serverless request) and, on
 * success, writes measurements. Safe to call repeatedly.
 */
export async function resolveCapture(captureId: string, opts: { timeoutMs?: number } = {}) {
  const capture = await db.capture.findUnique({ where: { id: captureId }, include: { trial: true } });
  if (!capture) throw new Error("capture not found");
  if (capture.status !== "analyzing" || !capture.youcamTaskId || !capture.youcamFileId) return capture;
  const trial = capture.trial;

  let result;
  try {
    result = await youcam().resolveSkinAnalysis(
      { taskId: capture.youcamTaskId, fileId: capture.youcamFileId, ledgerId: capture.ledgerId, units: capture.units, tier: trial.tier as Tier },
      { timeoutMs: opts.timeoutMs ?? 20_000 },
    );
  } catch (err) {
    if (err instanceof YouCamError && err.kind === "timeout") return capture; // still running
    const code = err instanceof YouCamError ? (err.code ?? err.kind) : "analysis_failed";
    return db.capture.update({
      where: { id: captureId },
      data: { status: "error", errorCode: code, errorMessage: retakeGuidance(code), units: 0 },
    });
  }

  const rows: { concern: string; metric: string; side: string; region: string; value: number }[] = [];
  for (const s of result.scores) {
    if (s.uiScore != null) rows.push({ concern: s.concern, metric: "ui_score", side: "whole", region: s.region, value: s.uiScore });
    if (s.rawScore != null) rows.push({ concern: s.concern, metric: "raw_score", side: "whole", region: s.region, value: s.rawScore });
  }

  // Split-face: per-side coverage from each split-able concern's whole-face mask.
  const notes: string[] = [];
  let effectiveFace: FaceGeometry | null = null;
  if (trial.design === "split_face" && capture.face) {
    const face = { ...(capture.face as unknown as FaceGeometry) };
    // Existing trials must keep the same sampling rule throughout their series.
    // Old captures have no version marker and therefore use the original boxes.
    const first = await db.capture.findFirst({
      where: { trialId: trial.id, status: "success", counts: true, NOT: { id: captureId } },
      orderBy: { dayIndex: "asc" }, select: { face: true },
    });
    if (first) face.roiVersion = (first.face as unknown as FaceGeometry | null)?.roiVersion === 2 ? 2 : 1;
    effectiveFace = face;
    const targets = result.scores.filter(
      (s) => s.region === "whole" && s.maskUrls.length > 0 && concern(s.concern as ConcernKey).splitFaceOk,
    );
    await Promise.all(
      targets.map(async (s) => {
        try {
          const mask = await youcam().downloadMask(s.maskUrls[0]);
          const cov = await maskCoverageBySide(mask, face);
          for (const side of ["left", "right", "whole"] as const) {
            rows.push({ concern: s.concern, metric: "mask_coverage", side, region: "whole", value: cov[side] });
          }
        } catch (err) {
          notes.push(`mask ${s.concern}: ${String(err).slice(0, 120)}`);
        }
      }),
    );
  }

  return db.$transaction(async (tx) => {
    const alreadyCounted = await tx.capture.count({
      where: { trialId: trial.id, dayIndex: capture.dayIndex, counts: true, NOT: { id: captureId } },
    });
    await tx.measurement.createMany({ data: rows.map((r) => ({ ...r, trialId: trial.id, captureId })) });
    return tx.capture.update({
      where: { id: captureId },
      data: {
        status: "success",
        ...(effectiveFace ? { face: effectiveFace as unknown as object } : {}),
        counts: alreadyCounted === 0,
        overall: result.overall,
        skinAge: result.skinAge,
        youcamResult: { taskId: result.taskId, scores: result.scores, overall: result.overall, skinAge: result.skinAge } as object,
        errorMessage: notes.length ? notes.join("; ") : null,
      },
    });
  });
}
