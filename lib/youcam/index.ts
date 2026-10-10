import "server-only";
import { env } from "@/lib/env";
import { YouCamClient } from "./client";
import { prismaLedger } from "./ledger-prisma";
import { createMockFetch } from "./mock";

let client: YouCamClient | null = null;

/** The app's YouCam client. MOCK_YOUCAM=1 (or no key) swaps in the mock transport. */
export function youcam(): YouCamClient {
  if (client) return client;
  const e = env();
  client = new YouCamClient({
    apiKey: e.youcamMock ? "mock-key" : e.YOUCAM_API_KEY,
    baseUrl: e.YOUCAM_BASE_URL,
    fetch: e.youcamMock ? createMockFetch({ baseUrl: e.YOUCAM_BASE_URL }) : undefined,
    ledger: prismaLedger,
    mock: e.youcamMock,
    unitBudget: e.YOUCAM_UNIT_BUDGET,
    onEvent: (ev) => {
      if (ev.type !== "poll") console.info("[youcam]", JSON.stringify(ev));
    },
  });
  return client;
}

export { YouCamClient } from "./client";
export { YouCamError, retakeGuidance } from "./errors";
