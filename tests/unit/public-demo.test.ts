import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { POST as upload } from "@/app/api/trials/[id]/captures/route";
import { POST as demoCapture } from "@/app/api/trials/[id]/demo-capture/route";

describe("public demo safeguards", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("forces both providers to mock even if live settings and keys exist", () => {
    vi.stubEnv("DATABASE_URL", "file:./test.db");
    vi.stubEnv("RECEIPTS_PUBLIC_DEMO", "1");
    vi.stubEnv("MOCK_YOUCAM", "0");
    vi.stubEnv("MOCK_AGENTS", "0");
    vi.stubEnv("YOUCAM_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect(env().youcamMock).toBe(true);
    expect(env().agentsMock).toBe(true);
  });
  it("rejects personal-photo upload requests before reading them in public mode", async () => {
    vi.stubEnv("DATABASE_URL", "file:./test.db");
    vi.stubEnv("RECEIPTS_PUBLIC_DEMO", "1");
    const response = await upload(new Request("http://localhost/api/trials/example/captures", { method: "POST" }) as never, { params: Promise.resolve({ id: "example" }) });
    expect(response.status).toBe(403);
  });
  it("does not expose the synthetic capture endpoint outside public mode", async () => {
    vi.stubEnv("DATABASE_URL", "file:./test.db");
    vi.stubEnv("RECEIPTS_PUBLIC_DEMO", "0");
    const response = await demoCapture(new Request("http://localhost/api/trials/example/demo-capture", { method: "POST" }), { params: Promise.resolve({ id: "example" }) });
    expect(response.status).toBe(404);
  });
});
