import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { youcam } from "@/lib/youcam";
import { ledgerSummary } from "@/lib/youcam/ledger-prisma";

/** Unit ledger summary. `?live=1` also asks YouCam for the real balance (a free call). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const summary = await ledgerSummary();
    let balance: number | null = null;
    if (req.nextUrl.searchParams.get("live") === "1" && !env().youcamMock) {
      balance = (await youcam().getCredits()).spendable;
    }
    return { mode: env().youcamMock ? "mock" : "live", budget: env().YOUCAM_UNIT_BUDGET, balance, ...summary };
  });
}
