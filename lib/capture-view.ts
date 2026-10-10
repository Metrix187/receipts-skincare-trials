import type { Capture } from "@prisma/client";
import { retakeGuidance } from "@/lib/youcam/errors";

/** What the client needs to know about a capture (no photo, no task internals). */
export function captureView(c: Capture) {
  return {
    id: c.id,
    status: c.status as "analyzing" | "success" | "error",
    dayIndex: c.dayIndex,
    phase: c.phase,
    counts: c.counts,
    units: c.units,
    mock: c.mock,
    overall: c.overall,
    error: c.status === "error" ? { code: c.errorCode, message: c.errorMessage ?? retakeGuidance(c.errorCode) } : null,
  };
}

export type CaptureView = ReturnType<typeof captureView>;
