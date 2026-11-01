import type { NextRequest } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { resolveCapture, submitCapture } from "@/lib/analysis/pipeline";
import { handle } from "@/lib/http";
import { HttpError, requireOwnedTrial } from "@/lib/owner";
import { MAX_FILE_BYTES, MIN_SHORT_SIDE } from "@/lib/youcam/costs";
import type { Tier } from "@/lib/youcam/concerns";
import { captureView } from "@/lib/capture-view";

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
export async function POST(req: NextRequest, ctx: RouteContext<"/api/trials/[id]/captures">) {
  return handle(async () => {
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
      face: Face.parse(JSON.parse(String(form.get("face") ?? "null"))),
      quality: z.record(z.string(), z.unknown()).parse(JSON.parse(String(form.get("quality") ?? "{}"))),
      localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(form.get("localDate")),
    });
    const resolved = capture.status === "analyzing" ? await resolveCapture(capture.id, { timeoutMs: 12_000 }) : capture;
    return captureView(resolved);
  });
}
