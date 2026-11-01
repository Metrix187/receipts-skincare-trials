import sharp from "sharp";
import { z } from "zod";
import { resolveCapture, submitCapture } from "@/lib/analysis/pipeline";
import { captureView } from "@/lib/capture-view";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { HttpError, requireOwnedTrial } from "@/lib/owner";

// Public preview only. No personal image is accepted: the server generates a
// featureless synthetic image and uses the mock YouCam client and mock agents.
export async function POST(request: Request, ctx: RouteContext<"/api/trials/[id]/demo-capture">) {
  return handle(async () => {
    if (!env().RECEIPTS_PUBLIC_DEMO) throw new HttpError(404, "Not found");
    const trial = await requireOwnedTrial((await ctx.params).id);
    const body = z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(await request.json());
    const bytes = new Uint8Array(await sharp({ create: { width: 600, height: 750, channels: 3, background: "#c8a08c" } }).jpeg().toBuffer());
    const capture = await submitCapture(trial, {
      bytes, mime: "image/jpeg", width: 600, height: 750, localDate: body.localDate,
      face: { box: { x: 0.15, y: 0.22, w: 0.7, h: 0.56 }, midlineX: 0.5, roiVersion: 2 },
      quality: { detector: "public-demo-synthetic", luminance: 0.64, checks: { simulated: "pass" } },
    });
    return captureView(capture.status === "analyzing" ? await resolveCapture(capture.id, { timeoutMs: 12_000 }) : capture);
  });
}
