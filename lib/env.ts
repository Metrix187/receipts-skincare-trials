import "server-only";
import { z } from "zod";

const flag = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  YOUCAM_API_KEY: z.string().optional().default(""),
  MOCK_YOUCAM: flag,
  YOUCAM_TIER: z.enum(["sd", "hd"]).optional().default("sd"),
  YOUCAM_UNIT_BUDGET: z.coerce.number().int().positive().optional().default(600),
  YOUCAM_BASE_URL: z.string().url().optional().default("https://yce-api-01.makeupar.com"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().default("medium"),
  MOCK_AGENTS: flag,
  PHOTO_ENCRYPTION_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema> & {
  /** True when YouCam calls must not leave the machine (explicit flag or no key). */
  youcamMock: boolean;
  /** True when agents run the deterministic local implementation. */
  agentsMock: boolean;
};

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  cached = {
    ...parsed,
    youcamMock: parsed.MOCK_YOUCAM || !parsed.YOUCAM_API_KEY,
    agentsMock: parsed.MOCK_AGENTS || !parsed.ANTHROPIC_API_KEY,
  };
  return cached;
}

/** Status for the settings page. Never exposes secret values. */
export function envStatus() {
  const e = env();
  const mask = (v: string) => (v ? `set (${v.length} chars)` : "not set");
  return {
    database: e.DATABASE_URL.startsWith("file:") ? "SQLite (local)" : "Postgres",
    youcamKey: mask(e.YOUCAM_API_KEY),
    youcamMode: e.youcamMock ? "mock" : "live",
    youcamMockReason: e.MOCK_YOUCAM ? "MOCK_YOUCAM=1" : !e.YOUCAM_API_KEY ? "no YOUCAM_API_KEY" : null,
    tier: e.YOUCAM_TIER,
    unitBudget: e.YOUCAM_UNIT_BUDGET,
    anthropicKey: mask(e.ANTHROPIC_API_KEY),
    agentMode: e.agentsMock ? "mock" : "live",
    model: e.ANTHROPIC_MODEL,
    photoEncryption: e.PHOTO_ENCRYPTION_KEY ? "AES-256-GCM key set" : "MISSING: run npm run setup",
  };
}
