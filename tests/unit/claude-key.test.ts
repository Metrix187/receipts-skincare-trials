import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), writeFile: vi.fn() }));
import { readFile, writeFile } from "node:fs/promises";
import { POST } from "@/app/api/settings/claude-key/route";

const savedKey = process.env.ANTHROPIC_API_KEY;
const savedNodeEnv = process.env.NODE_ENV;
function request(key: string, origin = "http://localhost:3000", url = "http://localhost:3000/api/settings/claude-key") {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ key }) });
}
describe("local Claude key setup", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NODE_ENV", "development"); });
  afterEach(() => { vi.stubEnv("NODE_ENV", savedNodeEnv); if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey; });
  it("preserves other settings and never returns the key", async () => {
    vi.mocked(readFile).mockResolvedValue("OTHER=retained\nANTHROPIC_API_KEY=old\n");
    const response = await POST(request("sk-ant-abcdefghijklmnop"));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("sk-ant-");
    expect(writeFile).toHaveBeenCalledWith(expect.any(String), "OTHER=retained\nANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop\n", expect.any(Object));
    expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-abcdefghijklmnop");
  });
  it("rejects malformed keys and cross-origin requests without saving", async () => {
    expect((await POST(request("invalid"))).status).toBe(400);
    expect((await POST(request("sk-ant-abcdefghijklmnop", "https://evil.example"))).status).toBe(403);
    expect((await POST(request("sk-ant-abcdefghijklmnop", "https://example.com", "https://example.com/api/settings/claude-key"))).status).toBe(403);
    expect(writeFile).not.toHaveBeenCalled();
  });
  it("rejects writes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request("sk-ant-abcdefghijklmnop"))).status).toBe(403);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
