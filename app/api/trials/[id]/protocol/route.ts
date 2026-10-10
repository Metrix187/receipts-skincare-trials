import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { HttpError, requireOwnedTrial } from "@/lib/owner";
import { designProtocol, NewTrialSchema } from "@/lib/services";

export const maxDuration = 120;

/** Re-runs the Protocol Agent on an unlocked draft, with the original inputs. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/trials/[id]/protocol">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const trial = await requireOwnedTrial(id);
    if (trial.lockedAt) throw new HttpError(409, "Protocol is locked.");
    const last = await db.agentRun.findFirst({ where: { trialId: id, agent: "protocol" }, orderBy: { createdAt: "desc" } });
    const input = NewTrialSchema.parse(last?.input ?? {});
    return { protocol: await designProtocol(id, input) };
  });
}
