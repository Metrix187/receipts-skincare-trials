import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { wipePhotos } from "@/lib/services";

/** One-click privacy wipe: deletes every stored selfie for the trial. Scores are kept. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/trials/[id]/photos">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return { deletedPhotos: await wipePhotos(id) };
  });
}
