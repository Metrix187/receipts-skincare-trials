import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { requireOwnedTrial } from "@/lib/owner";
import { produceVerdict } from "@/lib/services";

export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/trials/[id]/verdict">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await requireOwnedTrial(id);
    const v = await produceVerdict(id);
    return { id: v.id, label: v.label, headline: v.headline };
  });
}
