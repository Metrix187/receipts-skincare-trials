import type { NextRequest } from "next/server";
import { handle } from "@/lib/http";
import { lockTrial } from "@/lib/services";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/trials/[id]/lock">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const trial = await lockTrial(id);
    return { lockedAt: trial.lockedAt, protocolHash: trial.protocolHash };
  });
}
