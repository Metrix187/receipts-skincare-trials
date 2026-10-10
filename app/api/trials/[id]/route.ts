import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { deleteTrial } from "@/lib/services";

/** Deletes the trial and everything in it: photos, scores, agent logs, verdicts. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/trials/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await deleteTrial(id);
    return { deleted: true };
  });
}
