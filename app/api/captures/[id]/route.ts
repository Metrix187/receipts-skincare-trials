import type { NextRequest } from "next/server";
import { resolveCapture } from "@/lib/analysis/pipeline";
import { captureView } from "@/lib/capture-view";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { HttpError, requireOwnedTrial } from "@/lib/owner";

export const maxDuration = 60;

/** Poll a capture. Each call waits up to ~15s on YouCam (polling is free). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/captures/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await db.capture.findUnique({ where: { id }, select: { trialId: true } });
    if (!c) throw new HttpError(404, "Capture not found");
    await requireOwnedTrial(c.trialId);
    return captureView(await resolveCapture(id, { timeoutMs: 15_000 }));
  });
}
