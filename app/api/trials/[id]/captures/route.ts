import type { NextRequest } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { resolveCapture, submitCapture } from "@/lib/analysis/pipeline";
import { handle } from "@/lib/http";
import { HttpError, requireOwnedTrial } from "@/lib/owner";
import { CalendarDate } from "@/lib/services";
import { MAX_FILE_BYTES, MIN_SHORT_SIDE } from "@/lib/youcam/costs";
import type { Tier } from "@/lib/youcam/concerns";
import { captureView } from "@/lib/capture-view";
import { env } from "@/lib/env";

export const maxDuration = 60;

const Face = z.object({
  box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }),
  midlineX: z.number().min(0).max(1),
  rollDeg: z.number().optional(),
  roiVersion: z.literal(2).optional(),
});

/**
 * Receives one pre-checked selfie (multipart: image, face, quality, localDate),
 * stores it encrypted, submits it to YouCam, and waits briefly for the result.
 */
/** Form fields carrying JSON: a malformed one is the client's mistake (400), not a crash (500). */
function parseJsonField(raw: FormDataEntryValue | null, name: string, fallback: string): unknown {
  try {
    return JSON.parse(String(raw ?? fallback));
  } catch {
    throw new HttpError(400, `Field "${name}" is not valid JSON.`);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/trials/[id]/captures">) {
  return handle(async () => {
    if (env().RECEIPTS_PUBLIC_DEMO) throw new HttpError(403, "The public demo only accepts its built-in synthetic sample; personal photos are disabled.");
    const { id } = await ctx.params;
    const trial = await requireOwnedTrial(id);
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new HttpError(400, "image is required");
    if (file.type !== "image/jpeg" && file.type !== "image/png") throw new HttpError(400, "image must be JPEG or PNG");
    if (file.size > MAX_FILE_BYTES) throw new HttpError(400, "image must be under 10 MB");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    const short = Math.min(meta.width ?? 0, meta.height ?? 0);
    const need = MIN_SHORT_SIDE[trial.tier as Tier];
    if (short < need) throw new HttpError(400, `Image is ${short}px on its short side; ${trial.tier.toUpperCase()} analysis needs ${need}px. Move closer or use a better camera.`);

    const capture = await submitCapture(trial, {
      bytes,
      mime: file.type,
      width: meta.width!,
      height: meta.height!,
      face: Face.parse(parseJsonField(form.get("face"), "face", "null")),
      quality: z.record(z.string(), z.unknown()).parse(parseJsonField(form.get("quality"), "quality", "{}")),
      localDate: CalendarDate.parse(form.get("localDate")),
    });
    const resolved = capture.status === "analyzing" ? await resolveCapture(capture.id, { timeoutMs: 12_000 }) : capture;
    return captureView(resolved);
  });
}
